import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureBranch } from './branch.js';
import { generateId, isValidId } from './id.js';
import { appendIndexRecord } from './index-log.js';
import {
  ConcurrentWriteError,
  EntryNotFoundError,
  GitCommandError,
  IdCollisionError,
} from './errors.js';
import {
  CARN_BRANCH,
  CARN_REF,
  DEFAULT_IDENTITY,
  acquireWorktree,
  gitExec,
  hasOrigin,
  identityEnv,
  purgeStaleCarnWorktrees,
  revParse,
  type GitIdentity,
  type WorktreeLease,
} from './worktree.js';

// Permissive shape for ST-2. ST-3 swaps in Zod schemas and tightens the surface.
export type Entry = { id: string } & Record<string, unknown>;
export type EntryDraft = Omit<Record<string, unknown>, 'id'>;

export interface AddEntryOptions {
  id?: string;
  identity?: GitIdentity;
  /** Skip the auto-fetch+rebase retry. Tests use this to assert raw push failure. */
  retryOnConflict?: boolean;
}

export interface ListEntriesOptions {
  /** Default: `'in-flight'`. */
  status?: 'in-flight' | 'closed' | 'all';
}

const IN_FLIGHT_DIR = 'in-flight';
const CLOSED_DIR = 'closed';

interface WorktreeContext {
  lease: WorktreeLease;
  identity: GitIdentity;
  env: NodeJS.ProcessEnv;
}

async function withWorktree<T>(
  repoRoot: string,
  identity: GitIdentity,
  fn: (ctx: WorktreeContext) => Promise<T>,
): Promise<T> {
  await ensureBranch(repoRoot, { identity });
  const lease = await acquireWorktree(repoRoot);
  const env = identityEnv(identity);
  try {
    return await fn({ lease, identity, env });
  } finally {
    await lease.release();
  }
}

function entryPath(worktree: string, status: 'in-flight' | 'closed', id: string): string {
  return join(worktree, status, `${id}.json`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function findEntryFile(
  worktree: string,
  id: string,
): Promise<{ status: 'in-flight' | 'closed'; path: string } | null> {
  const inflight = entryPath(worktree, 'in-flight', id);
  if (existsSync(inflight)) return { status: 'in-flight', path: inflight };
  const closed = entryPath(worktree, 'closed', id);
  if (existsSync(closed)) return { status: 'closed', path: closed };
  return null;
}

async function workingTreeIsClean(worktree: string): Promise<boolean> {
  const res = await gitExec(worktree, ['status', '--porcelain']);
  return res.stdout.trim().length === 0;
}

async function stageAndCommit(
  worktree: string,
  env: NodeJS.ProcessEnv,
  message: string,
): Promise<void> {
  await gitExec(worktree, ['add', '-A']);
  await gitExec(worktree, ['commit', '-m', message], { env });
}

const warnedNoOrigin = new Set<string>();
function warnOnceNoOrigin(repoRoot: string): void {
  if (warnedNoOrigin.has(repoRoot)) return;
  warnedNoOrigin.add(repoRoot);
  // Surfacing this once per process is what the spec asks for: "no origin → push
  // is a warning no-op, not an error." Silent no-ops bite later when the user
  // adds a remote and discovers carn history nobody else can see.
  process.stderr.write(
    `carn: no 'origin' remote configured for ${repoRoot}; entries are local-only until you add one.\n`,
  );
}

/** Test-only: clear the warn memo so a test can re-trigger the warning. */
export function _resetNoOriginWarnMemoForTests(): void {
  warnedNoOrigin.clear();
}

function isConflictPushFailure(stderr: string): boolean {
  return /non-fast-forward|rejected|\bfetch first\b/i.test(stderr);
}

async function pushAndUpdateLocalRef(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  const head = (await gitExec(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!head) throw new Error('worktree HEAD is empty after commit');

  if (await hasOrigin(repoRoot)) {
    const push = await gitExec(
      repoRoot,
      ['push', 'origin', `${head}:${CARN_REF}`],
      { allowFailure: true },
    );
    if (push.code !== 0) {
      const stderr = push.stderr || push.stdout;
      // ConcurrentWriteError is scoped specifically to non-fast-forwards — the
      // only push failure whose remedy is fetch+rebase+retry. Everything else
      // (auth, network, refspec malformed) bubbles up as the underlying
      // GitCommandError so the caller's retry path doesn't do wasted work and
      // the error message reflects the actual cause.
      if (isConflictPushFailure(stderr)) {
        throw new ConcurrentWriteError(stderr.trim());
      }
      throw new GitCommandError(
        ['push', 'origin', `${head}:${CARN_REF}`],
        push.code,
        stderr,
      );
    }
  } else {
    warnOnceNoOrigin(repoRoot);
  }

  await gitExec(repoRoot, ['update-ref', CARN_REF, head], { allowFailure: true });
}

async function fetchAndResetWorktree(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  if (await hasOrigin(repoRoot)) {
    await gitExec(
      repoRoot,
      ['fetch', 'origin', `${CARN_BRANCH}:${CARN_REF}`],
      { allowFailure: true },
    );
  }
  await gitExec(worktreePath, ['reset', '--hard', CARN_REF]);
  await gitExec(worktreePath, ['clean', '-fdx']);
}

async function commitAndPushWithRetry(
  repoRoot: string,
  ctx: WorktreeContext,
  message: string,
  applyChanges: () => Promise<void>,
  retryOnConflict = true,
): Promise<void> {
  await applyChanges();
  // applyChanges may decide there is nothing to write (e.g. closeEntry on an
  // entry that was already closed). Skip commit+push in that case so callers
  // don't see a `nothing to commit` GitCommandError on idempotent no-ops.
  if (await workingTreeIsClean(ctx.lease.path)) return;
  await stageAndCommit(ctx.lease.path, ctx.env, message);
  try {
    await pushAndUpdateLocalRef(repoRoot, ctx.lease.path);
    return;
  } catch (err) {
    if (!(err instanceof ConcurrentWriteError) || !retryOnConflict) throw err;
    // Rebase: reset the worktree to the new tip, re-apply changes, commit, push.
    await fetchAndResetWorktree(repoRoot, ctx.lease.path);
    await applyChanges();
    if (await workingTreeIsClean(ctx.lease.path)) return;
    await stageAndCommit(ctx.lease.path, ctx.env, message);
    await pushAndUpdateLocalRef(repoRoot, ctx.lease.path);
  }
}

export async function addEntry(
  repoRoot: string,
  draft: EntryDraft,
  opts: AddEntryOptions = {},
): Promise<Entry> {
  await purgeStaleCarnWorktrees(repoRoot);
  const identity = opts.identity ?? DEFAULT_IDENTITY;
  const retryOnConflict = opts.retryOnConflict !== false;

  if (opts.id !== undefined && !isValidId(opts.id)) {
    throw new Error(`Invalid carn entry id: ${String(opts.id)}`);
  }

  return await withWorktree(repoRoot, identity, async (ctx) => {
    const id = opts.id ?? generateId();
    const filePath = entryPath(ctx.lease.path, 'in-flight', id);
    const entry: Entry = { ...(draft as Record<string, unknown>), id };

    await commitAndPushWithRetry(
      repoRoot,
      ctx,
      `carn: add ${id}`,
      async () => {
        if (existsSync(filePath)) {
          throw new IdCollisionError(id);
        }
        if (existsSync(entryPath(ctx.lease.path, 'closed', id))) {
          throw new IdCollisionError(id);
        }
        await writeJson(filePath, entry);
        await appendIndexRecord(ctx.lease.path, {
          op: 'add',
          id,
          at: new Date().toISOString(),
        });
      },
      retryOnConflict,
    );

    return entry;
  });
}

export async function getEntry(
  repoRoot: string,
  id: string,
): Promise<Entry | null> {
  if (!isValidId(id)) return null;
  await purgeStaleCarnWorktrees(repoRoot);
  const exists = await revParse(repoRoot, CARN_REF);
  if (!exists) return null;

  return await withWorktree(repoRoot, DEFAULT_IDENTITY, async (ctx) => {
    const found = await findEntryFile(ctx.lease.path, id);
    if (!found) return null;
    const data = (await readJson(found.path)) as Entry;
    return data;
  });
}

export async function listEntries(
  repoRoot: string,
  opts: ListEntriesOptions = {},
): Promise<Entry[]> {
  await purgeStaleCarnWorktrees(repoRoot);
  const exists = await revParse(repoRoot, CARN_REF);
  if (!exists) return [];
  const status = opts.status ?? 'in-flight';

  return await withWorktree(repoRoot, DEFAULT_IDENTITY, async (ctx) => {
    const dirs: Array<'in-flight' | 'closed'> =
      status === 'all' ? ['in-flight', 'closed'] : [status];
    const out: Entry[] = [];
    const { readdir } = await import('node:fs/promises');
    for (const d of dirs) {
      const dir = join(ctx.lease.path, d);
      if (!existsSync(dir)) continue;
      const names = await readdir(dir);
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const entry = (await readJson(join(dir, name))) as Entry;
        out.push(entry);
      }
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  });
}

export async function updateEntry(
  repoRoot: string,
  id: string,
  patch: Record<string, unknown>,
  opts: AddEntryOptions = {},
): Promise<Entry> {
  if (!isValidId(id)) throw new EntryNotFoundError(id);
  await purgeStaleCarnWorktrees(repoRoot);
  const identity = opts.identity ?? DEFAULT_IDENTITY;
  const retryOnConflict = opts.retryOnConflict !== false;

  return await withWorktree(repoRoot, identity, async (ctx) => {
    let updated: Entry | null = null;
    await commitAndPushWithRetry(
      repoRoot,
      ctx,
      `carn: update ${id}`,
      async () => {
        const found = await findEntryFile(ctx.lease.path, id);
        if (!found) throw new EntryNotFoundError(id);
        if (found.status === 'closed') {
          throw new Error(`Cannot update closed entry: ${id}`);
        }
        const current = (await readJson(found.path)) as Entry;
        const next: Entry = { ...current, ...patch, id };
        await writeJson(found.path, next);
        await appendIndexRecord(ctx.lease.path, {
          op: 'update',
          id,
          at: new Date().toISOString(),
        });
        updated = next;
      },
      retryOnConflict,
    );
    if (!updated) throw new Error('updateEntry produced no entry — invariant violated');
    return updated;
  });
}

export async function closeEntry(
  repoRoot: string,
  id: string,
  opts: AddEntryOptions = {},
): Promise<Entry> {
  if (!isValidId(id)) throw new EntryNotFoundError(id);
  await purgeStaleCarnWorktrees(repoRoot);
  const identity = opts.identity ?? DEFAULT_IDENTITY;
  const retryOnConflict = opts.retryOnConflict !== false;

  return await withWorktree(repoRoot, identity, async (ctx) => {
    let closed: Entry | null = null;
    await commitAndPushWithRetry(
      repoRoot,
      ctx,
      `carn: close ${id}`,
      async () => {
        const found = await findEntryFile(ctx.lease.path, id);
        if (!found) throw new EntryNotFoundError(id);
        if (found.status === 'closed') {
          closed = (await readJson(found.path)) as Entry;
          return;
        }
        const fromRel = join(IN_FLIGHT_DIR, `${id}.json`);
        const toRel = join(CLOSED_DIR, `${id}.json`);
        await mkdir(join(ctx.lease.path, CLOSED_DIR), { recursive: true });
        // `git mv` keeps git's rename detection happy so the diff stays small.
        await gitExec(ctx.lease.path, ['mv', fromRel, toRel]);
        const data = (await readJson(join(ctx.lease.path, toRel))) as Entry;
        await appendIndexRecord(ctx.lease.path, {
          op: 'close',
          id,
          at: new Date().toISOString(),
        });
        closed = data;
      },
      retryOnConflict,
    );
    if (!closed) throw new Error('closeEntry produced no entry — invariant violated');
    return closed;
  });
}

