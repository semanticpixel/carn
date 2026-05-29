import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Capture the working-tree-affecting git state of `cwd` as a single
 * string for byte-identical before/after assertions. Used by storage
 * tests to prove that carn operations never mutate the user's working
 * tree — a regression in that invariant would surface as a diff in
 * this snapshot.
 */
export async function gitStatusSnapshot(cwd: string): Promise<string> {
  const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  const status = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd });
  const branch = await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd });
  return [
    `head:${head.stdout.trim()}`,
    `branch:${branch.stdout.trim()}`,
    `status:${status.stdout}`,
  ].join('\n');
}
