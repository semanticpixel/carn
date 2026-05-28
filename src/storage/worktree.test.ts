import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CARN_REF,
  _resetPurgeMemoForTests,
  acquireWorktree,
  assertGitRepo,
  gitExec,
  hasOrigin,
  purgeStaleCarnWorktrees,
  revParse,
} from './worktree.js';
import { ensureBranch } from './branch.js';
import { NotAGitRepoError } from './errors.js';
import { makeBareRepo, makeSandbox } from './_test-utils.js';

const execFileAsync = promisify(execFile);

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn()));
  cleanups = [];
  _resetPurgeMemoForTests();
});

describe('assertGitRepo', () => {
  it('throws NotAGitRepoError on a non-existent path', async () => {
    await expect(assertGitRepo('/definitely/not/a/real/path/abc123')).rejects.toBeInstanceOf(
      NotAGitRepoError,
    );
  });

  it('throws NotAGitRepoError on a plain directory that is not a git repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carn-nonrepo-'));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));
    await expect(assertGitRepo(dir)).rejects.toBeInstanceOf(NotAGitRepoError);
  });
});

describe('hasOrigin', () => {
  it('returns true when origin is configured', async () => {
    const sbx = await makeSandbox(1);
    cleanups.push(sbx.cleanup);
    expect(await hasOrigin(sbx.clones[0]!)).toBe(true);
  });

  it('returns false on a standalone repo with no remote', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    expect(await hasOrigin(sbx.root)).toBe(false);
  });
});

describe('acquireWorktree', () => {
  it('returns a lease whose release() removes both the git registration and the tmpdir', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await ensureBranch(sbx.root);
    const lease = await acquireWorktree(sbx.root);
    expect(existsSync(lease.path)).toBe(true);

    const listed = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).toContain(lease.path);

    await lease.release();
    expect(existsSync(lease.path)).toBe(false);
    const listedAfter = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listedAfter).not.toContain(lease.path);
  });

  it('cleans up the tmpdir if `git worktree add` fails (e.g. branch ref missing)', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    // Deliberately skip ensureBranch — refs/heads/carn does not exist yet, so
    // `git worktree add --detach <dir> refs/heads/carn` will fail.
    await expect(acquireWorktree(sbx.root)).rejects.toThrow();

    // No `carn-wt-*` directory should be left behind in the system tmpdir
    // for this repo's failed acquisition. We can't enumerate the whole
    // tmpdir reliably, but we can confirm no worktree registrations leaked.
    const listed = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).not.toMatch(/carn-wt-/);
  });
});

describe('purgeStaleCarnWorktrees', () => {
  it('removes a worktree that holds refs/heads/carn (orphan from a prior crash)', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await ensureBranch(sbx.root);

    // Simulate a leftover worktree that *does* claim the branch (the no-go path
    // our happy code avoids). Use `git worktree add <dir> carn` without --detach
    // so it owns refs/heads/carn.
    const stale = await mkdtemp(join(tmpdir(), 'carn-stale-'));
    // worktree add wants the dir to not exist or be empty — fresh mkdtemp is empty, fine.
    await gitExec(sbx.root, ['worktree', 'add', stale, 'carn']);
    cleanups.push(async () => rm(stale, { recursive: true, force: true }));

    _resetPurgeMemoForTests();
    await purgeStaleCarnWorktrees(sbx.root);

    const listed = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).not.toContain(stale);
  });

  it('leaves an unrelated detached worktree alone', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await ensureBranch(sbx.root);

    // A detached worktree NOT on carn — e.g. detached at main.
    const head = (await gitExec(sbx.root, ['rev-parse', 'HEAD'])).stdout.trim();
    const sibling = await mkdtemp(join(tmpdir(), 'carn-sibling-'));
    await rm(sibling, { recursive: true, force: true }); // worktree add needs nonexistent path
    await gitExec(sbx.root, ['worktree', 'add', '--detach', sibling, head]);
    cleanups.push(async () => {
      await gitExec(sbx.root, ['worktree', 'remove', '--force', sibling], { allowFailure: true });
    });

    _resetPurgeMemoForTests();
    await purgeStaleCarnWorktrees(sbx.root);

    const listed = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).toContain(sibling);
  });

  it('is memoized per repoRoot — a second call is a no-op (live concurrent worktrees survive)', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await ensureBranch(sbx.root);

    _resetPurgeMemoForTests();
    await purgeStaleCarnWorktrees(sbx.root);

    // Now acquire a *live* worktree (our happy path: detached on CARN_REF).
    const lease = await acquireWorktree(sbx.root);
    cleanups.push(async () => lease.release());

    // Second purge in the same process must NOT touch this live worktree.
    await purgeStaleCarnWorktrees(sbx.root);

    const listed = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).toContain(lease.path);
  });

  it('removes prunable worktrees (their directory disappeared out from under git)', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await ensureBranch(sbx.root);

    // Create then nuke the directory directly so git's tracking sees it as prunable.
    const head = (await gitExec(sbx.root, ['rev-parse', 'HEAD'])).stdout.trim();
    const ghost = await mkdtemp(join(tmpdir(), 'carn-ghost-'));
    await rm(ghost, { recursive: true, force: true });
    await gitExec(sbx.root, ['worktree', 'add', '--detach', ghost, head]);
    await rm(ghost, { recursive: true, force: true });

    _resetPurgeMemoForTests();
    await purgeStaleCarnWorktrees(sbx.root);

    const listed = (await gitExec(sbx.root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(listed).not.toContain(ghost);
  });
});

describe('revParse', () => {
  it('returns the SHA when the ref exists, null when it does not', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    expect(await revParse(sbx.root, CARN_REF)).toBeNull();
    await ensureBranch(sbx.root);
    const sha = await revParse(sbx.root, CARN_REF);
    expect(sha).toMatch(/^[a-f0-9]{40}$/);
  });
});
