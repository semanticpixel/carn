import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addEntry, listEntries, updateEntry } from './storage/entry.js';
import { makeSandbox } from './storage/_test-utils.js';
import { autoCloseMergedEntries } from './auto-close.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@local',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@local',
    },
  });
  return stdout.trim();
}

async function commitOnMain(cwd: string, body: string): Promise<string> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${cwd}/touch-${Date.now()}-${Math.random()}.txt`, body);
  await git(cwd, 'add', '.');
  await git(cwd, 'commit', '-m', body);
  const head = await git(cwd, 'rev-parse', 'HEAD');
  await git(cwd, 'push', 'origin', 'main');
  return head;
}

describe('autoCloseMergedEntries', () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(() => {
    cleanup = null;
  });
  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('closes entries whose merged_sha is an ancestor of origin/main', async () => {
    const sandbox = await makeSandbox(1);
    cleanup = sandbox.cleanup;
    const repo = sandbox.clones[0]!;

    const sha = await commitOnMain(repo, 'release commit');
    // Update the local main + fetch so origin/main is up to date.
    await git(repo, 'fetch', 'origin');

    const merged = await addEntry(repo, {
      type: 'coordinate',
      description: 'merged work',
      reason: 'shipped',
    });
    await updateEntry(repo, merged.id, { metadata: { merged_sha: sha } });

    const unmerged = await addEntry(repo, {
      type: 'coordinate',
      description: 'still in flight',
      reason: 'open PR',
    });
    await updateEntry(repo, unmerged.id, {
      metadata: { merged_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    });

    const noSha = await addEntry(repo, {
      type: 'coordinate',
      description: 'never had a sha',
      reason: 'manual close pending',
    });

    const result = await autoCloseMergedEntries(repo);
    expect(result.baseRef).toMatch(/^origin\/(main|master)$/);
    expect(result.closed.map((e) => e.id)).toEqual([merged.id]);
    expect(result.pending.map((e) => e.id)).toEqual([unmerged.id]);

    const inflightAfter = await listEntries(repo, { status: 'in-flight' });
    const inflightIds = inflightAfter.map((e) => e.id).sort();
    expect(inflightIds).toEqual([noSha.id, unmerged.id].sort());

    const closedAfter = await listEntries(repo, { status: 'closed' });
    expect(closedAfter.map((e) => e.id)).toEqual([merged.id]);
  });

  it('is idempotent — a second run closes nothing', async () => {
    const sandbox = await makeSandbox(1);
    cleanup = sandbox.cleanup;
    const repo = sandbox.clones[0]!;
    const sha = await commitOnMain(repo, 'release commit 2');
    await git(repo, 'fetch', 'origin');

    const entry = await addEntry(repo, {
      type: 'coordinate',
      description: 'closes once',
      reason: 'r',
    });
    await updateEntry(repo, entry.id, { metadata: { merged_sha: sha } });

    const first = await autoCloseMergedEntries(repo);
    expect(first.closed).toHaveLength(1);

    const second = await autoCloseMergedEntries(repo);
    expect(second.closed).toHaveLength(0);
    expect(second.pending).toHaveLength(0);
  });

  it('respects an explicit baseRef override', async () => {
    const sandbox = await makeSandbox(1);
    cleanup = sandbox.cleanup;
    const repo = sandbox.clones[0]!;
    const sha = await commitOnMain(repo, 'on a branch');
    // Tag the commit so we have a non-default ref to point at.
    await git(repo, 'tag', 'release-tag', sha);

    const entry = await addEntry(repo, {
      type: 'coordinate',
      description: 'tag scope',
      reason: 'r',
    });
    await updateEntry(repo, entry.id, { metadata: { merged_sha: sha } });

    const result = await autoCloseMergedEntries(repo, { baseRef: 'release-tag' });
    expect(result.baseRef).toBe('release-tag');
    expect(result.closed.map((e) => e.id)).toEqual([entry.id]);
  });
});
