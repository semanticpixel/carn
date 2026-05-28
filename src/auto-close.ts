import { closeEntry, listEntries } from './storage/entry.js';
import { gitExec, hasOrigin, type GitIdentity } from './storage/worktree.js';
import type { Entry } from './types.js';

export interface AutoCloseOptions {
  /** Git identity used for the close commits. Falls back to the storage layer's DEFAULT_IDENTITY. */
  identity?: GitIdentity;
  /**
   * Explicit base ref. Default: autodetect via `git remote show origin`
   * (HEAD branch). Falls back to `main` then `master` if unavailable.
   */
  baseRef?: string;
  /**
   * Override `now()` for tests. Used to stamp closed_at consistently if we
   * grow that path; currently the storage layer owns the timestamp.
   */
  now?: () => Date;
}

export interface AutoCloseResult {
  /** Entries that were closed in this run. */
  closed: Entry[];
  /**
   * Entries with `metadata.merged_sha` whose SHA is *not* yet an ancestor
   * of the base (PR hasn't merged into the default branch yet). Surfacing
   * these helps debugging the "I closed but nothing happened" case.
   */
  pending: Entry[];
  /** The base ref the scan resolved against. */
  baseRef: string;
}

/**
 * Resolve the base ref. Order: explicit option → `origin/<HEAD>` from
 * `git remote show origin` → `origin/main` → `origin/master` → `main` →
 * `master`. The remote variants are checked first because that's what the
 * skill's PR-merge SHAs actually land on.
 */
async function resolveBaseRef(
  repoRoot: string,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) return explicit;

  if (await hasOrigin(repoRoot)) {
    const probe = await gitExec(repoRoot, ['remote', 'show', 'origin'], {
      allowFailure: true,
    });
    if (probe.code === 0) {
      const match = probe.stdout.match(/HEAD branch:\s*(\S+)/);
      if (match) {
        const remoteRef = `origin/${match[1]}`;
        if (await refExists(repoRoot, remoteRef)) return remoteRef;
      }
    }
    for (const candidate of ['origin/main', 'origin/master']) {
      if (await refExists(repoRoot, candidate)) return candidate;
    }
  }
  for (const candidate of ['main', 'master']) {
    if (await refExists(repoRoot, candidate)) return candidate;
  }
  throw new Error(
    'autoCloseMergedEntries: could not resolve default branch (tried origin/main, origin/master, main, master). Pass baseRef explicitly.',
  );
}

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  const res = await gitExec(
    repoRoot,
    ['rev-parse', '--verify', '--quiet', ref],
    { allowFailure: true },
  );
  return res.code === 0 && res.stdout.trim().length > 0;
}

/**
 * Is `sha` reachable from `baseRef`? Uses `git merge-base --is-ancestor`,
 * which is a plumbing-level "yes/no" with no merge-conflict surface.
 */
async function shaIsAncestorOfBase(
  repoRoot: string,
  sha: string,
  baseRef: string,
): Promise<boolean> {
  const res = await gitExec(
    repoRoot,
    ['merge-base', '--is-ancestor', sha, baseRef],
    { allowFailure: true },
  );
  return res.code === 0;
}

function extractMergedSha(entry: Entry): string | null {
  const raw = entry.metadata['merged_sha'];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

/**
 * Close all in-flight entries whose `metadata.merged_sha` is now an
 * ancestor of the default branch. Idempotent — a second run finds no
 * candidates because closed entries no longer appear in `listEntries`'s
 * default filter.
 *
 * This is the engine behind `carn close --auto-merged`. ST-9's doctor
 * calls it internally too, so the bare repo-state side-effects (close
 * commits + index updates) are the same as a manual `carn close`.
 */
export async function autoCloseMergedEntries(
  repoRoot: string,
  opts: AutoCloseOptions = {},
): Promise<AutoCloseResult> {
  const baseRef = await resolveBaseRef(repoRoot, opts.baseRef);
  const inflight = await listEntries(repoRoot, { status: 'in-flight' });

  const closed: Entry[] = [];
  const pending: Entry[] = [];

  for (const entry of inflight) {
    const sha = extractMergedSha(entry);
    if (sha === null) continue;
    const isAncestor = await shaIsAncestorOfBase(repoRoot, sha, baseRef);
    if (isAncestor) {
      const closedEntry = await closeEntry(repoRoot, entry.id, {
        identity: opts.identity,
      });
      closed.push(closedEntry);
    } else {
      pending.push(entry);
    }
  }

  return { closed, pending, baseRef };
}
