import { afterEach, describe, expect, it } from 'vitest';
import { ensureBranch } from './branch.js';
import { CARN_REF, gitExec, revParse } from './worktree.js';
import { NotAGitRepoError } from './errors.js';
import { makeBareRepo, makeSandbox, gitStatusSnapshot } from './_test-utils.js';

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn()));
  cleanups = [];
});

describe('ensureBranch', () => {
  it('creates an orphan carn branch on a fresh standalone repo', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);

    const before = await gitStatusSnapshot(sbx.root);
    const sha = await ensureBranch(sbx.root);
    const after = await gitStatusSnapshot(sbx.root);

    expect(sha).toMatch(/^[a-f0-9]{7,}$/);
    expect(await revParse(sbx.root, CARN_REF)).toBe(sha);
    // The user's checked-out branch and worktree must be byte-identical before/after.
    expect(before).toBe(after);

    // The orphan commit has no parents and an empty tree.
    const parents = await gitExec(sbx.root, ['rev-list', '--parents', '-n', '1', sha]);
    expect(parents.stdout.trim().split(/\s+/).length).toBe(1);
    const ls = await gitExec(sbx.root, ['ls-tree', sha]);
    expect(ls.stdout.trim()).toBe('');
  });

  it('is idempotent — second call returns the same sha', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    const a = await ensureBranch(sbx.root);
    const b = await ensureBranch(sbx.root);
    expect(a).toBe(b);
  });

  it('rejects a non-git directory with NotAGitRepoError', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'carn-nogit-'));
    cleanups.push(async () => {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    });
    await expect(ensureBranch(dir)).rejects.toBeInstanceOf(NotAGitRepoError);
  });

  it('picks up an existing origin/carn instead of creating a new orphan', async () => {
    const sbx = await makeSandbox(2);
    cleanups.push(sbx.cleanup);
    const [a, b] = sbx.clones as [string, string];

    const shaA = await ensureBranch(a);
    // Push it so origin has carn, then ensure clone B fetches the same one.
    await gitExec(a, ['push', 'origin', `${CARN_REF}:${CARN_REF}`]);
    const shaB = await ensureBranch(b);
    expect(shaB).toBe(shaA);
  });
});
