import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { GitCommandError, NotAGitRepoError } from './errors.js';

const execFileAsync = promisify(execFile);

export const CARN_BRANCH = 'carn';
export const CARN_REF = `refs/heads/${CARN_BRANCH}`;

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitOptions {
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function gitExec(
  cwd: string,
  args: readonly string[],
  opts: GitOptions = {},
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    const code = typeof e.code === 'number' ? e.code : 1;
    const stderr = e.stderr ?? '';
    const stdout = e.stdout ?? '';
    if (opts.allowFailure) {
      return { stdout, stderr, code };
    }
    throw new GitCommandError(args, code, stderr || stdout);
  }
}

export async function gitExecWithStdin(
  cwd: string,
  args: readonly string[],
  stdin: string,
  opts: GitOptions = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const env = opts.env ? { ...process.env, ...opts.env } : process.env;
    const child = spawn('git', [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    // `git mktree </dev/null` (and similar) consumes no input and may close
    // stdin before our `write` flushes. On Linux that surfaces as EPIPE; left
    // unhandled it crashes the process even though the exit code is 0. Treat
    // EPIPE as benign — the child's exit code is the authoritative signal.
    child.stdin.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
        reject(err);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const result: GitResult = { stdout, stderr, code: code ?? 0 };
      if (result.code !== 0 && !opts.allowFailure) {
        reject(new GitCommandError(args, result.code, result.stderr || result.stdout));
        return;
      }
      resolve(result);
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function assertGitRepo(repoRoot: string): Promise<void> {
  if (!existsSync(repoRoot)) {
    throw new NotAGitRepoError(repoRoot);
  }
  const res = await gitExec(repoRoot, ['rev-parse', '--git-dir'], { allowFailure: true });
  if (res.code !== 0) {
    throw new NotAGitRepoError(repoRoot);
  }
}

export async function hasOrigin(repoRoot: string): Promise<boolean> {
  const res = await gitExec(repoRoot, ['remote', 'get-url', 'origin'], { allowFailure: true });
  return res.code === 0 && res.stdout.trim().length > 0;
}

export async function revParse(
  cwd: string,
  ref: string,
): Promise<string | null> {
  const res = await gitExec(cwd, ['rev-parse', '--verify', '--quiet', ref], {
    allowFailure: true,
  });
  if (res.code !== 0) return null;
  const sha = res.stdout.trim();
  return sha.length > 0 ? sha : null;
}

export interface WorktreeLease {
  path: string;
  release: () => Promise<void>;
}

interface PorcelainWorktree {
  path: string;
  branch: string | null;
  detached: boolean;
  prunable: boolean;
}

async function listWorktrees(repoRoot: string): Promise<PorcelainWorktree[]> {
  const { stdout } = await gitExec(repoRoot, ['worktree', 'list', '--porcelain']);
  const out: PorcelainWorktree[] = [];
  let current: PorcelainWorktree | null = null;
  for (const raw of stdout.split('\n')) {
    if (raw.startsWith('worktree ')) {
      if (current) out.push(current);
      current = {
        path: raw.slice('worktree '.length).trim(),
        branch: null,
        detached: false,
        prunable: false,
      };
    } else if (raw.startsWith('branch ')) {
      if (current) current.branch = raw.slice('branch '.length).trim();
    } else if (raw === 'detached') {
      if (current) current.detached = true;
    } else if (raw.startsWith('prunable')) {
      if (current) current.prunable = true;
    } else if (raw === '') {
      if (current) out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

const purgedRepos = new Set<string>();

/**
 * Remove orphaned worktrees on the carn branch — e.g. a previous process that
 * crashed before `release()` ran. Idempotent per-process: only sweeps each
 * repoRoot once, so concurrent callers' live worktrees are never targeted.
 *
 * Targets: worktrees that git itself flagged `prunable` (their directory is
 * gone), OR worktrees that claim `refs/heads/carn` as their checked-out branch
 * — which our happy path never does (we always `--detach`), so any match is
 * leftover state.
 */
export async function purgeStaleCarnWorktrees(repoRoot: string): Promise<void> {
  if (purgedRepos.has(repoRoot)) return;
  purgedRepos.add(repoRoot);
  await assertGitRepo(repoRoot);
  const worktrees = await listWorktrees(repoRoot);
  for (const wt of worktrees) {
    if (wt.path === repoRoot) continue;
    if (wt.prunable || wt.branch === CARN_REF) {
      await gitExec(repoRoot, ['worktree', 'remove', '--force', wt.path], { allowFailure: true });
    }
  }
  await gitExec(repoRoot, ['worktree', 'prune'], { allowFailure: true });
}

/** Test-only: clear the per-process purge memo so a test can re-trigger a sweep. */
export function _resetPurgeMemoForTests(): void {
  purgedRepos.clear();
}

export async function acquireWorktree(repoRoot: string): Promise<WorktreeLease> {
  await assertGitRepo(repoRoot);
  const dir = await mkdtemp(join(tmpdir(), 'carn-wt-'));
  // --detach + ref so we hold carn's tip without claiming the branch — multiple
  // sibling worktrees can therefore coexist at the same tip, which is what makes
  // concurrent addEntry / closeEntry work without locking.
  const res = await gitExec(
    repoRoot,
    ['worktree', 'add', '--detach', dir, CARN_REF],
    { allowFailure: true },
  );
  if (res.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new GitCommandError(
      ['worktree', 'add', '--detach', dir, CARN_REF],
      res.code,
      res.stderr,
    );
  }
  let released = false;
  return {
    path: dir,
    release: async () => {
      if (released) return;
      released = true;
      await gitExec(repoRoot, ['worktree', 'remove', '--force', dir], { allowFailure: true });
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export interface GitIdentity {
  name: string;
  email: string;
}

export const DEFAULT_IDENTITY: GitIdentity = {
  name: 'carn',
  email: 'carn@local',
};

export function identityEnv(identity: GitIdentity = DEFAULT_IDENTITY): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}
