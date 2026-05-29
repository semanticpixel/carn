import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ensureBranch } from './storage/branch.js';
import {
  CARN_BRANCH,
  CARN_REF,
  acquireWorktree,
  gitExec,
  hasOrigin,
  identityEnv,
  revParse,
  DEFAULT_IDENTITY,
  type GitIdentity,
} from './storage/worktree.js';
import { appendIndexRecord, readIndexLog, INDEX_LOG_PATH } from './storage/index-log.js';
import { EntrySchema, type Entry } from './types.js';
import { isExpired } from './ttl.js';

export type Severity = 'info' | 'warn' | 'error';

/**
 * One row in the doctor report. Structured (not a plain string) so `--json`
 * output round-trips cleanly and downstream tooling can filter on `code`.
 *
 * `fixable` reflects whether `--fix` *would* attempt a remedy in principle.
 * `fixed` is set when this particular run actually applied that remedy.
 * Keeping the two separate means a default (read-only) run still tells
 * the user which findings could have been fixed.
 */
export interface DoctorCheck {
  severity: Severity;
  code: string;
  message: string;
  entry_id?: string;
  fixable: boolean;
  fixed?: boolean;
}

export type ExitTier = 'ok' | 'warn' | 'error';

export interface DoctorReport {
  /** True when no findings were produced. */
  ok: boolean;
  checks: DoctorCheck[];
  /**
   * Highest severity seen. Drives the CLI exit code:
   *   `ok` → 0, `warn` → 1, `error` → 2.
   * `info` findings (e.g. mergeable entries) do not raise the tier — they
   * are reportable but not actionable on their own.
   */
  exit_tier: ExitTier;
}

export interface DoctorOptions {
  fix?: boolean;
  /** Threshold for the "no updates" warn. Default: 30 days. */
  staleAfterDays?: number;
  identity?: GitIdentity;
  /** Override clock for deterministic tests. */
  now?: () => Date;
}

const DEFAULT_STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PorcelainWorktree {
  path: string;
  branch: string | null;
  prunable: boolean;
}

async function listWorktrees(repoRoot: string): Promise<PorcelainWorktree[]> {
  const { stdout } = await gitExec(repoRoot, ['worktree', 'list', '--porcelain']);
  const out: PorcelainWorktree[] = [];
  let current: PorcelainWorktree | null = null;
  for (const raw of stdout.split('\n')) {
    if (raw.startsWith('worktree ')) {
      if (current) out.push(current);
      current = { path: raw.slice('worktree '.length).trim(), branch: null, prunable: false };
    } else if (raw.startsWith('branch ') && current) {
      current.branch = raw.slice('branch '.length).trim();
    } else if (raw.startsWith('prunable') && current) {
      current.prunable = true;
    } else if (raw === '' && current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

function exitTierFor(checks: DoctorCheck[]): ExitTier {
  if (checks.some((c) => c.severity === 'error')) return 'error';
  if (checks.some((c) => c.severity === 'warn')) return 'warn';
  return 'ok';
}

/**
 * Health check. Read-only by default; pass `fix: true` to apply the
 * auto-fixable subset (orphaned worktrees, branch drift behind origin,
 * index regeneration). The function never throws on routine findings —
 * everything reportable becomes a `DoctorCheck`. It does throw if the
 * repo itself is unusable (no git, no carn branch creation possible).
 */
export async function runDoctor(
  repoRoot: string,
  opts: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const fix = Boolean(opts.fix);
  const now = opts.now ? opts.now() : new Date();
  const staleDays = opts.staleAfterDays ?? DEFAULT_STALE_DAYS;
  const identity = opts.identity ?? DEFAULT_IDENTITY;

  await ensureBranch(repoRoot, { identity });

  await checkOrphanedWorktrees(repoRoot, checks, fix);
  await checkBranchDrift(repoRoot, checks, fix);

  // Acquire a fresh worktree *after* the drift fix so the disk inspection
  // sees the post-fetch tip rather than a stale snapshot.
  const lease = await acquireWorktree(repoRoot);
  try {
    const entries = await checkDiskEntries(lease.path, checks, now, staleDays);
    await checkMergeable(repoRoot, entries, checks, fix, identity);
    await checkIndexMismatch(repoRoot, lease.path, entries, checks, fix, identity);
  } finally {
    await lease.release();
  }

  const exit_tier = exitTierFor(checks);
  return { ok: checks.length === 0, checks, exit_tier };
}

async function checkOrphanedWorktrees(
  repoRoot: string,
  checks: DoctorCheck[],
  fix: boolean,
): Promise<void> {
  const worktrees = await listWorktrees(repoRoot);
  for (const wt of worktrees) {
    if (wt.path === repoRoot) continue;
    const isOrphan = wt.prunable || wt.branch === CARN_REF;
    if (!isOrphan) continue;
    const check: DoctorCheck = {
      severity: 'warn',
      code: 'orphaned-worktree',
      message: `orphaned carn worktree: ${wt.path}${wt.prunable ? ' (prunable)' : ''}`,
      fixable: true,
    };
    if (fix) {
      const res = await gitExec(
        repoRoot,
        ['worktree', 'remove', '--force', wt.path],
        { allowFailure: true },
      );
      if (res.code === 0) check.fixed = true;
    }
    checks.push(check);
  }
  if (fix) {
    // Best-effort prune — clears git's internal worktree index of stale
    // entries that `worktree remove` may have left behind.
    await gitExec(repoRoot, ['worktree', 'prune'], { allowFailure: true });
  }
}

async function checkBranchDrift(
  repoRoot: string,
  checks: DoctorCheck[],
  fix: boolean,
): Promise<void> {
  if (!(await hasOrigin(repoRoot))) return;

  // Fetch the remote tip into a tracking ref without touching the local
  // `carn` branch — we read both and decide.
  const trackingRef = `refs/remotes/origin/${CARN_BRANCH}`;
  await gitExec(
    repoRoot,
    ['fetch', 'origin', `${CARN_BRANCH}:${trackingRef}`],
    { allowFailure: true },
  );

  const local = await revParse(repoRoot, CARN_REF);
  const remote = await revParse(repoRoot, trackingRef);
  if (!remote || !local || local === remote) return;

  // Is the local tip a strict ancestor of remote? If so we can fast-forward
  // safely. If not, the branches have diverged and a human must reconcile.
  const ancestor = await gitExec(
    repoRoot,
    ['merge-base', '--is-ancestor', local, remote],
    { allowFailure: true },
  );

  if (ancestor.code === 0) {
    const check: DoctorCheck = {
      severity: 'error',
      code: 'branch-drift-behind',
      message: `local carn (${local.slice(0, 12)}) is behind origin/${CARN_BRANCH} (${remote.slice(0, 12)})`,
      fixable: true,
    };
    if (fix) {
      const upd = await gitExec(
        repoRoot,
        ['update-ref', CARN_REF, remote, local],
        { allowFailure: true },
      );
      if (upd.code === 0) check.fixed = true;
    }
    checks.push(check);
    return;
  }

  // Either remote is an ancestor of local (we are ahead — push, not error)
  // or they diverged (genuine conflict).
  const remoteAncestor = await gitExec(
    repoRoot,
    ['merge-base', '--is-ancestor', remote, local],
    { allowFailure: true },
  );
  if (remoteAncestor.code === 0) {
    // Local is ahead of origin — surfaces as info, not error. The next
    // CRUD push will flush it.
    checks.push({
      severity: 'info',
      code: 'branch-drift-ahead',
      message: `local carn is ${local.slice(0, 12)} but origin/${CARN_BRANCH} is ${remote.slice(0, 12)} — next push will sync`,
      fixable: false,
    });
    return;
  }

  checks.push({
    severity: 'error',
    code: 'branch-drift-diverged',
    message: `local carn (${local.slice(0, 12)}) and origin/${CARN_BRANCH} (${remote.slice(0, 12)}) have diverged — fix manually`,
    fixable: false,
  });
}

interface DiskEntry {
  /** in-flight or closed JSON parsed against EntrySchema. */
  entry: Entry;
  status: 'in-flight' | 'closed';
}

async function readDir(worktreePath: string, sub: 'in-flight' | 'closed'): Promise<string[]> {
  const dir = join(worktreePath, sub);
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith('.json'));
}

async function checkDiskEntries(
  worktreePath: string,
  checks: DoctorCheck[],
  now: Date,
  staleDays: number,
): Promise<DiskEntry[]> {
  const accepted: DiskEntry[] = [];
  for (const status of ['in-flight', 'closed'] as const) {
    const files = await readDir(worktreePath, status);
    for (const name of files) {
      const id = name.replace(/\.json$/, '');
      const full = join(worktreePath, status, name);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(full, 'utf8'));
      } catch (err) {
        checks.push({
          severity: 'error',
          code: 'entry-unparseable-json',
          message: `${status}/${name}: ${err instanceof Error ? err.message : String(err)}`,
          entry_id: id,
          fixable: false,
        });
        continue;
      }
      const parsed = EntrySchema.safeParse(raw);
      if (!parsed.success) {
        checks.push({
          severity: 'error',
          code: 'schema-violation',
          message: `${status}/${name}: ${formatZodIssues(parsed.error)}`,
          entry_id: id,
          fixable: false,
        });
        continue;
      }
      accepted.push({ entry: parsed.data, status });
    }
  }

  for (const { entry, status } of accepted) {
    if (status === 'closed') continue;
    if (isExpired(entry, now)) {
      checks.push({
        severity: 'warn',
        code: 'ttl-expired',
        message: `${entry.id} (${entry.type}): ttl ${entry.ttl} expired`,
        entry_id: entry.id,
        fixable: false,
      });
    }
    const updated = Date.parse(entry.updated_at);
    if (!Number.isNaN(updated)) {
      const ageDays = (now.getTime() - updated) / MS_PER_DAY;
      if (ageDays >= staleDays) {
        checks.push({
          severity: 'warn',
          code: 'stale-no-updates',
          message: `${entry.id} (${entry.type}): no updates in ${Math.floor(ageDays)}d`,
          entry_id: entry.id,
          fixable: false,
        });
      }
    }
  }

  return accepted;
}

async function checkMergeable(
  repoRoot: string,
  entries: DiskEntry[],
  checks: DoctorCheck[],
  fix: boolean,
  identity: GitIdentity,
): Promise<void> {
  // Find candidates without taking on auto-close.ts's base-ref resolution
  // here — defer to that module for the actual close work so a single
  // codepath owns the ancestor probe and the in-flight → closed move.
  const candidates = entries.filter(
    (d) =>
      d.status === 'in-flight' &&
      typeof d.entry.metadata['merged_sha'] === 'string' &&
      (d.entry.metadata['merged_sha'] as string).length > 0,
  );
  if (candidates.length === 0) return;

  if (!fix) {
    // Report-only path: probe ancestry directly so the report names the
    // mergeable entries without performing the close.
    const baseRef = await resolveDefaultBase(repoRoot);
    if (!baseRef) return;
    for (const { entry } of candidates) {
      const sha = entry.metadata['merged_sha'] as string;
      const probe = await gitExec(
        repoRoot,
        ['merge-base', '--is-ancestor', sha, baseRef],
        { allowFailure: true },
      );
      if (probe.code === 0) {
        checks.push({
          severity: 'info',
          code: 'mergeable',
          message: `${entry.id}: merged_sha ${sha.slice(0, 12)} is ancestor of ${baseRef} — run \`carn close --auto-merged\` or \`carn doctor --fix\``,
          entry_id: entry.id,
          fixable: true,
        });
      }
    }
    return;
  }

  // Fix path: defer to autoCloseMergedEntries so the close goes through
  // the same commit-and-push path as the CLI's `--auto-merged` flag.
  // Import lazily so the read-only doctor never pulls in close machinery.
  const { autoCloseMergedEntries } = await import('./auto-close.js');
  const result = await autoCloseMergedEntries(repoRoot, { identity });
  for (const closed of result.closed) {
    checks.push({
      severity: 'info',
      code: 'mergeable',
      message: `${closed.id}: merged_sha is ancestor of ${result.baseRef} — closed by --fix`,
      entry_id: closed.id,
      fixable: true,
      fixed: true,
    });
  }
}

async function resolveDefaultBase(repoRoot: string): Promise<string | null> {
  if (await hasOrigin(repoRoot)) {
    const probe = await gitExec(
      repoRoot,
      ['symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD'],
      { allowFailure: true },
    );
    if (probe.code === 0) {
      const ref = probe.stdout.trim();
      if (ref && (await revParse(repoRoot, ref))) return ref;
    }
    for (const candidate of ['origin/main', 'origin/master']) {
      if (await revParse(repoRoot, candidate)) return candidate;
    }
  }
  for (const candidate of ['main', 'master']) {
    if (await revParse(repoRoot, candidate)) return candidate;
  }
  return null;
}

async function checkIndexMismatch(
  repoRoot: string,
  worktreePath: string,
  entries: DiskEntry[],
  checks: DoctorCheck[],
  fix: boolean,
  identity: GitIdentity,
): Promise<void> {
  const records = await readIndexLog(worktreePath);
  const idsWithAdd = new Set<string>();
  const idsWithClose = new Set<string>();
  for (const r of records) {
    if (r.op === 'add') idsWithAdd.add(r.id);
    if (r.op === 'close') idsWithClose.add(r.id);
  }

  const missingAdd: DiskEntry[] = [];
  const missingClose: DiskEntry[] = [];
  for (const d of entries) {
    if (!idsWithAdd.has(d.entry.id)) missingAdd.push(d);
    if (d.status === 'closed' && !idsWithClose.has(d.entry.id)) missingClose.push(d);
  }

  const onDiskIds = new Set(entries.map((d) => d.entry.id));
  const phantomAdds: string[] = [];
  for (const id of idsWithAdd) {
    if (!onDiskIds.has(id)) phantomAdds.push(id);
  }

  if (missingAdd.length === 0 && missingClose.length === 0 && phantomAdds.length === 0) return;

  const summary = [
    missingAdd.length > 0 ? `${missingAdd.length} entries missing 'add' records` : null,
    missingClose.length > 0 ? `${missingClose.length} closed entries missing 'close' records` : null,
    phantomAdds.length > 0 ? `${phantomAdds.length} 'add' records reference deleted entries` : null,
  ]
    .filter(Boolean)
    .join('; ');

  const check: DoctorCheck = {
    severity: 'warn',
    code: 'index-mismatch',
    message: `.carn/index.jsonl out of sync with disk — ${summary}`,
    fixable: true,
  };

  if (fix && (missingAdd.length > 0 || missingClose.length > 0)) {
    // Append missing records so the log catches up to disk. Phantom adds
    // are forensic — we never delete from the append-only log.
    for (const d of missingAdd) {
      await appendIndexRecord(worktreePath, {
        op: 'add',
        id: d.entry.id,
        at: d.entry.created_at,
      });
    }
    for (const d of missingClose) {
      await appendIndexRecord(worktreePath, {
        op: 'close',
        id: d.entry.id,
        at: d.entry.closed_at ?? d.entry.updated_at,
      });
    }
    // Stage + commit the regenerated index inside the worktree, then push.
    const env = identityEnv(identity);
    const stage = await gitExec(worktreePath, ['add', INDEX_LOG_PATH], { allowFailure: true });
    if (stage.code === 0) {
      const commit = await gitExec(
        worktreePath,
        ['commit', '-m', 'carn doctor: rebuild index'],
        { env, allowFailure: true },
      );
      if (commit.code === 0) {
        const head = (await gitExec(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
        if (head) {
          await gitExec(repoRoot, ['update-ref', CARN_REF, head], { allowFailure: true });
          if (await hasOrigin(repoRoot)) {
            await gitExec(
              repoRoot,
              ['push', 'origin', `${head}:${CARN_REF}`],
              { allowFailure: true },
            );
          }
          check.fixed = true;
        }
      }
    }
  }

  checks.push(check);
}

function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}
