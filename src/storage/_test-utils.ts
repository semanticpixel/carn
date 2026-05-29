import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetPurgeMemoForTests } from './worktree.js';

const execFileAsync = promisify(execFile);

export interface Sandbox {
  root: string;
  bare: string;
  cleanup: () => Promise<void>;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@local',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@local',
    },
  });
}

/**
 * Make a sandbox with one bare repo (acts as origin) and `n` sibling clones.
 * Each clone has a single committed file on `main` so it's a real repo, not
 * just an empty `git init`.
 */
export async function makeSandbox(n = 1): Promise<Sandbox & { clones: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'carn-sbx-'));
  const bare = join(root, 'origin.git');
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare]);

  const seed = join(root, 'seed');
  await execFileAsync('git', ['clone', bare, seed]);
  await execFileAsync('node', ['-e', "require('fs').writeFileSync('README.md','seed\\n')"], { cwd: seed });
  await git(seed, 'add', '.');
  await git(seed, 'commit', '-m', 'seed');
  await git(seed, 'push', 'origin', 'main');

  const clones: string[] = [];
  for (let i = 0; i < n; i++) {
    const dir = join(root, `clone-${i}`);
    await execFileAsync('git', ['clone', bare, dir]);
    await git(dir, 'config', 'user.name', 'test');
    await git(dir, 'config', 'user.email', 'test@local');
    clones.push(dir);
  }

  const cleanup = async () => {
    _resetPurgeMemoForTests();
    await rm(root, { recursive: true, force: true });
  };

  return { root, bare, clones, cleanup };
}

/** A standalone repo (no remote) for tests that assert no-origin behavior. */
export async function makeBareRepo(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'carn-noremote-'));
  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git(root, 'config', 'user.name', 'test');
  await git(root, 'config', 'user.email', 'test@local');
  // Initial commit so HEAD is valid.
  const fs = await import('node:fs/promises');
  await fs.writeFile(join(root, 'README.md'), 'standalone\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'init');
  return {
    root,
    bare: '',
    cleanup: async () => {
      _resetPurgeMemoForTests();
      await rm(root, { recursive: true, force: true });
    },
  };
}

// Re-exported from the canonical home so storage-test imports keep working.
// New tests should import from `src/test-utils/git-snapshot.js` directly.
export { gitStatusSnapshot } from '../test-utils/git-snapshot.js';
