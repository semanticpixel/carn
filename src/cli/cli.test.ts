import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtureRepo, runCli, type FixtureRepo } from './_test-utils.js';

describe('carn CLI — end-to-end', () => {
  let repo: FixtureRepo;

  beforeEach(async () => {
    repo = await makeFixtureRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  it('`carn --help` lists every command', async () => {
    const r = await runCli(repo.root, ['--help']);
    expect(r.code).toBe(0);
    for (const c of ['init', 'add', 'list', 'show', 'close', 'query']) {
      expect(r.stdout).toContain(c);
    }
  });

  it('`carn --version` prints a version string', async () => {
    const r = await runCli(repo.root, ['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('unknown command exits 1 with a "did you mean" hint', async () => {
    const r = await runCli(repo.root, ['ad']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("did you mean 'add'");
  });

  it('`carn init` creates the carn branch and is idempotent', async () => {
    const r1 = await runCli(repo.root, ['init', '--json']);
    expect(r1.code).toBe(0);
    const parsed1 = JSON.parse(r1.stdout);
    expect(parsed1.branch).toBe('carn');
    expect(typeof parsed1.sha).toBe('string');

    const r2 = await runCli(repo.root, ['init', '--json']);
    expect(r2.code).toBe(0);
    expect(JSON.parse(r2.stdout).sha).toBe(parsed1.sha);
  });

  it('`carn add` → `list` → `show` → `close` happy path', async () => {
    await runCli(repo.root, ['init']);

    const addRes = await runCli(repo.root, [
      'add',
      'no new typecasts',
      '--type',
      'forbid-pattern',
      '--constraint',
      'no `as Foo`',
      '--paths',
      'src/**/*.ts',
      '--ttl',
      '7d',
      '--json',
    ]);
    expect(addRes.code).toBe(0);
    const { entry } = JSON.parse(addRes.stdout);
    expect(entry.id).toMatch(/^[a-z2-9]{8}$/);
    expect(entry.type).toBe('forbid-pattern');
    expect(entry.constraint).toBe('no `as Foo`');
    expect(entry.author).toBe('cli@test.local');
    expect(entry.ttl).toBe('7d');

    const listRes = await runCli(repo.root, ['list', '--json']);
    expect(listRes.code).toBe(0);
    const listed = JSON.parse(listRes.stdout).entries;
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(entry.id);

    const showRes = await runCli(repo.root, ['show', entry.id, '--json']);
    expect(showRes.code).toBe(0);
    expect(JSON.parse(showRes.stdout).entry.id).toBe(entry.id);

    // Fuzzy-prefix lookup.
    const prefixRes = await runCli(repo.root, ['show', entry.id.slice(0, 4), '--json']);
    expect(prefixRes.code).toBe(0);
    expect(JSON.parse(prefixRes.stdout).entry.id).toBe(entry.id);

    const closeRes = await runCli(repo.root, ['close', entry.id, '--json']);
    expect(closeRes.code).toBe(0);
    expect(JSON.parse(closeRes.stdout).entry.closed_at).not.toBeNull();

    // After close, default `list` is empty (in-flight only).
    const afterClose = await runCli(repo.root, ['list', '--json']);
    expect(JSON.parse(afterClose.stdout).entries).toHaveLength(0);
    // --closed sees the closed one.
    const closedList = await runCli(repo.root, ['list', '--closed', '--json']);
    expect(JSON.parse(closedList.stdout).entries).toHaveLength(1);
  });

  it('`carn add` reads description from stdin when positional is omitted', async () => {
    await runCli(repo.root, ['init']);
    const r = await runCli(
      repo.root,
      ['add', '--type', 'coordinate', '--reason', 'mid-refactor', '--json'],
      { stdin: 'piped multi\nline description' },
    );
    expect(r.code).toBe(0);
    const { entry } = JSON.parse(r.stdout);
    expect(entry.description).toBe('piped multi\nline description');
  });

  it('`carn add` errors on missing --constraint for forbid-pattern', async () => {
    await runCli(repo.root, ['init']);
    const r = await runCli(repo.root, [
      'add',
      'note',
      '--type',
      'forbid-pattern',
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--constraint');
  });

  it('`carn query --paths` returns only path-overlapping entries', async () => {
    await runCli(repo.root, ['init']);

    const adds = [
      ['add', 'auth note', '--type', 'forbid-pattern', '--constraint', 'x', '--paths', 'src/auth/**'],
      ['add', 'billing note', '--type', 'forbid-pattern', '--constraint', 'y', '--paths', 'src/billing/**'],
      ['add', 'repo-wide', '--type', 'coordinate', '--reason', 'z'],
    ];
    for (const a of adds) {
      const r = await runCli(repo.root, a);
      expect(r.code).toBe(0);
    }

    const q = await runCli(repo.root, [
      'query',
      '--paths',
      'src/auth/login.ts',
      '--json',
    ]);
    expect(q.code).toBe(0);
    const got = JSON.parse(q.stdout).entries;
    // Auth-scoped + repo-wide should match; billing should not.
    expect(got).toHaveLength(2);
    const types = got.map((e: { description: string }) => e.description).sort();
    expect(types).toEqual(['auth note', 'repo-wide']);
  });

  it('`carn query` errors when --paths is missing', async () => {
    await runCli(repo.root, ['init']);
    const r = await runCli(repo.root, ['query']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--paths');
  });

  it('`carn show <missing>` exits 1', async () => {
    await runCli(repo.root, ['init']);
    const r = await runCli(repo.root, ['show', 'zzzzzzzz']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no entry');
  });

  it('`carn close --merged-sha` stamps metadata.merged_sha', async () => {
    await runCli(repo.root, ['init']);
    const addRes = await runCli(repo.root, [
      'add',
      'temp note',
      '--type',
      'forbid-pattern',
      '--constraint',
      'x',
      '--json',
    ]);
    const id = JSON.parse(addRes.stdout).entry.id;
    const closeRes = await runCli(repo.root, [
      'close',
      id,
      '--merged-sha',
      'deadbeefcafe',
      '--json',
    ]);
    expect(closeRes.code).toBe(0);
    const closed = JSON.parse(closeRes.stdout).entry;
    expect(closed.metadata.merged_sha).toBe('deadbeefcafe');
  });

  it('NO_COLOR=1 list output has no ANSI escapes', async () => {
    await runCli(repo.root, ['init']);
    await runCli(repo.root, [
      'add',
      'plain output',
      '--type',
      'forbid-pattern',
      '--constraint',
      'x',
    ]);
    const r = await runCli(repo.root, ['list'], { env: { NO_COLOR: '1' } });
    // eslint-disable-next-line no-control-regex
    expect(r.stdout).not.toMatch(/\[/);
    expect(r.stdout).toContain('plain output');
  });

  it('errors with exit 1 when git user.email is unset', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('git', ['config', '--unset', 'user.email'], { cwd: repo.root });

    // Override HOME / disable system config so git can't fall back to the
    // developer's global ~/.gitconfig. Without this, the test passes locally
    // for anyone without a global user.email but fails for everyone else.
    const r = await runCli(
      repo.root,
      ['add', 'note', '--type', 'forbid-pattern', '--constraint', 'x'],
      { env: { HOME: '/var/empty', GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: '/var/empty' } },
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('user.email');
  });
});
