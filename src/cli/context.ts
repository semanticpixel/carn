import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitIdentity } from '../storage/worktree.js';

const execFileAsync = promisify(execFile);

export class CliError extends Error {
  /** Exit code: 1 = user error, 2 = system error. */
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/**
 * Resolve the repo root via `git rev-parse --show-toplevel`. Surfaces a
 * user-facing error when not inside a git repo — calling carn from a tmp
 * dir with no parent repo is a common foot-gun.
 */
export async function resolveRepoRoot(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    const root = stdout.trim();
    if (!root) throw new CliError('git rev-parse --show-toplevel returned no path', 2);
    return root;
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(
      `not a git repository (run \`carn\` from inside a repo): ${cwd}`,
      1,
    );
  }
}

/**
 * Read `git config user.email` (+ user.name) from the repo. The spec says
 * "fail loudly if unset" — provenance is load-bearing for ST-9 doctor and
 * for the dogfood case where multiple humans run carn in the same repo.
 */
export async function resolveIdentity(repoRoot: string): Promise<GitIdentity> {
  const email = await readConfig(repoRoot, 'user.email');
  if (!email) {
    throw new CliError(
      'git config `user.email` is not set. Run `git config user.email "you@example.com"` and retry.',
      1,
    );
  }
  const name = (await readConfig(repoRoot, 'user.name')) ?? email;
  return { name, email };
}

async function readConfig(repoRoot: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', key], {
      cwd: repoRoot,
    });
    const v = stdout.trim();
    return v.length === 0 ? null : v;
  } catch {
    return null;
  }
}
