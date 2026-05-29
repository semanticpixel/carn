import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureBranch } from '../storage/branch.js';
import { addEntry } from '../storage/entry.js';
import { _resetPurgeMemoForTests } from '../storage/worktree.js';
import type { EntryDraft } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Options for {@link makeFixtureRepo}. Keep this surface tight — the
 * point of the helper is to remove boilerplate from individual tests,
 * not to grow a configuration soup. New tests that need a different
 * setup should add a dedicated factory rather than another flag here.
 */
export interface FixtureRepoOptions {
  /** Initialise the `carn` branch as part of setup. Default: false. */
  withCarn?: boolean;
  /**
   * Entries to seed via `addEntry` (which goes through the full
   * storage path — worktree commit, push to bare origin, index log).
   * Implies `withCarn: true`. Default: none.
   */
  withEntries?: ReadonlyArray<EntryDraft>;
  /**
   * Identity used for the seed `addEntry` calls + the git config in
   * the working clone. Default: `cli-test <cli@test.local>`. Matches
   * the historical CLI fixture defaults so tests that mix this helper
   * with the CLI `_test-utils` see the same author string.
   */
  identity?: { name: string; email: string };
}

export interface FixtureRepo {
  /** The working clone — a normal git repo pointing at `bare` as origin. */
  root: string;
  /** The bare repo serving as origin. */
  bare: string;
  cleanup: () => Promise<void>;
}

const DEFAULT_IDENTITY = { name: 'cli-test', email: 'cli@test.local' };

async function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, ...env },
  });
}

/**
 * Build a fully-wired tmp repo for tests: a working clone + a bare
 * origin so push/fetch round-trips succeed end-to-end. Optionally
 * initialises the carn branch and seeds it with entries.
 *
 * One helper, many tests — that's the pre-decided shape from ST-10's
 * spec. Calls existing storage primitives (`ensureBranch`, `addEntry`)
 * so seed data goes through the same code paths production does;
 * tests can't accidentally exercise a synthetic happy path that
 * skips invariants the real CRUD enforces.
 */
export async function makeFixtureRepo(
  opts: FixtureRepoOptions = {},
): Promise<FixtureRepo> {
  const identity = opts.identity ?? DEFAULT_IDENTITY;
  const env = {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };

  const root = await mkdtemp(join(tmpdir(), 'carn-fixture-'));
  const bare = join(root, 'origin.git');
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare]);

  const work = join(root, 'work');
  await execFileAsync('git', ['clone', bare, work]);
  await git(work, env, 'config', 'user.name', identity.name);
  await git(work, env, 'config', 'user.email', identity.email);
  await writeFile(join(work, 'README.md'), 'fixture\n');
  await git(work, env, 'add', '.');
  await git(work, env, 'commit', '-m', 'seed');
  await git(work, env, 'push', 'origin', 'main');

  const wantCarn = opts.withCarn === true || (opts.withEntries?.length ?? 0) > 0;
  if (wantCarn) {
    await ensureBranch(work, { identity });
  }
  for (const draft of opts.withEntries ?? []) {
    await addEntry(work, draft, { identity });
  }

  const cleanup = async () => {
    _resetPurgeMemoForTests();
    await rm(root, { recursive: true, force: true });
  };

  return { root: work, bare, cleanup };
}
