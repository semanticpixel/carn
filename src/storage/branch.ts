import {
  CARN_BRANCH,
  CARN_REF,
  assertGitRepo,
  gitExec,
  gitExecWithStdin,
  hasOrigin,
  identityEnv,
  revParse,
  type GitIdentity,
} from './worktree.js';

export interface EnsureBranchOptions {
  identity?: GitIdentity;
  fetchFromOrigin?: boolean;
}

/**
 * Make sure `refs/heads/carn` exists locally. Idempotent.
 *
 * Resolution order (first success wins):
 *   1. Local ref already present.
 *   2. `origin/carn` exists — fetch it and create the local ref to match.
 *   3. Synthesise an orphan root commit (empty tree) and point the ref at it.
 *      No worktree involved; pure plumbing so we never touch the user's index.
 */
export async function ensureBranch(
  repoRoot: string,
  opts: EnsureBranchOptions = {},
): Promise<string> {
  await assertGitRepo(repoRoot);

  const existing = await revParse(repoRoot, CARN_REF);
  if (existing) return existing;

  const fetchFromOrigin = opts.fetchFromOrigin !== false;
  if (fetchFromOrigin && (await hasOrigin(repoRoot))) {
    const fetch = await gitExec(
      repoRoot,
      ['fetch', 'origin', `${CARN_BRANCH}:${CARN_REF}`],
      { allowFailure: true },
    );
    if (fetch.code === 0) {
      const sha = await revParse(repoRoot, CARN_REF);
      if (sha) return sha;
    }
  }

  const env = identityEnv(opts.identity);
  const treeRes = await gitExecWithStdin(repoRoot, ['mktree'], '', { env });
  const tree = treeRes.stdout.trim();
  if (!tree) {
    throw new Error('git mktree produced no output while creating empty tree');
  }

  const commitRes = await gitExecWithStdin(
    repoRoot,
    ['commit-tree', tree, '-m', 'carn: root'],
    '',
    { env },
  );
  const commit = commitRes.stdout.trim();
  if (!commit) {
    throw new Error('git commit-tree produced no output while creating root commit');
  }

  await gitExec(repoRoot, ['update-ref', CARN_REF, commit], { env });
  return commit;
}
