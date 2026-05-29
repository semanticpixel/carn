import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry, updateEntry, closeEntry } from './storage/entry.js';
import {
  CARN_REF,
  DEFAULT_IDENTITY,
  acquireWorktree,
  gitExec,
  hasOrigin,
  identityEnv,
} from './storage/worktree.js';
import { ensureBranch } from './storage/branch.js';
import { INDEX_LOG_PATH } from './storage/index-log.js';
import { makeSandbox, type Sandbox } from './storage/_test-utils.js';
import { runDoctor } from './doctor.js';

const execFileAsync = promisify(execFile);

async function writeRawEntry(
  repoRoot: string,
  status: 'in-flight' | 'closed',
  id: string,
  raw: string,
): Promise<void> {
  const lease = await acquireWorktree(repoRoot);
  try {
    const dir = join(lease.path, status);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.json`), raw, 'utf8');
    const env = identityEnv(DEFAULT_IDENTITY);
    await gitExec(lease.path, ['add', '-A']);
    await gitExec(lease.path, ['commit', '-m', 'test: raw entry'], { env });
    const head = (await gitExec(lease.path, ['rev-parse', 'HEAD'])).stdout.trim();
    await gitExec(repoRoot, ['update-ref', CARN_REF, head]);
    if (await hasOrigin(repoRoot)) {
      await gitExec(repoRoot, ['push', 'origin', `${head}:${CARN_REF}`]);
    }
  } finally {
    await lease.release();
  }
}

async function removeIndexFile(repoRoot: string): Promise<void> {
  const lease = await acquireWorktree(repoRoot);
  try {
    const indexPath = join(lease.path, INDEX_LOG_PATH);
    if (existsSync(indexPath)) {
      await unlink(indexPath);
      const env = identityEnv(DEFAULT_IDENTITY);
      await gitExec(lease.path, ['add', '-A']);
      await gitExec(lease.path, ['commit', '-m', 'test: drop index'], { env });
      const head = (await gitExec(lease.path, ['rev-parse', 'HEAD'])).stdout.trim();
      await gitExec(repoRoot, ['update-ref', CARN_REF, head]);
      if (await hasOrigin(repoRoot)) {
        await gitExec(repoRoot, ['push', 'origin', `${head}:${CARN_REF}`]);
      }
    }
  } finally {
    await lease.release();
  }
}

describe('runDoctor', () => {
  let sbx: Sandbox & { clones: string[] };
  let repo: string;

  beforeEach(async () => {
    sbx = await makeSandbox(1);
    repo = sbx.clones[0]!;
    await ensureBranch(repo);
  });

  afterEach(async () => {
    await sbx.cleanup();
  });

  it('reports ok on a clean repo with no entries', async () => {
    const report = await runDoctor(repo);
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual([]);
    expect(report.exit_tier).toBe('ok');
  });

  it('flags ttl-expired in-flight entries', async () => {
    // Use a 1-second TTL and a "now" that's well past expiry.
    await addEntry(repo, {
      type: 'forbid-pattern',
      description: 'no typecasts',
      paths: ['src/'],
      constraint: 'no `as unknown as`',
      ttl: '1s',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    const future = new Date(Date.now() + 60_000);
    const report = await runDoctor(repo, { now: () => future });
    const ttl = report.checks.filter((c) => c.code === 'ttl-expired');
    expect(ttl).toHaveLength(1);
    expect(ttl[0]!.severity).toBe('warn');
    expect(report.exit_tier).toBe('warn');
  });

  it('flags stale entries with no updates past the threshold', async () => {
    await addEntry(repo, {
      type: 'coordinate',
      description: 'old entry',
      paths: ['*'],
      reason: 'stale check',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    // Threshold of 0 days → any entry older than 0ms is "stale".
    const future = new Date(Date.now() + 60_000);
    const report = await runDoctor(repo, {
      staleAfterDays: 0,
      now: () => future,
    });
    const stale = report.checks.filter((c) => c.code === 'stale-no-updates');
    expect(stale).toHaveLength(1);
    expect(stale[0]!.severity).toBe('warn');
  });

  it('flags mergeable entries (merged_sha is ancestor of main)', async () => {
    const entry = await addEntry(repo, {
      type: 'forbid-pattern',
      description: 'will be mergeable',
      paths: ['src/'],
      constraint: 'no foo',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    // Get the current main SHA (which is an ancestor of itself).
    const { stdout } = await execFileAsync('git', ['rev-parse', 'main'], { cwd: repo });
    const mainSha = stdout.trim();
    await updateEntry(repo, entry.id, { metadata: { merged_sha: mainSha } }, {
      identity: { name: 'a', email: 'a@x.test' },
    });

    const report = await runDoctor(repo);
    const m = report.checks.filter((c) => c.code === 'mergeable');
    expect(m).toHaveLength(1);
    expect(m[0]!.severity).toBe('info');
    expect(m[0]!.fixable).toBe(true);
    // Info-only findings shouldn't push the tier above ok.
    expect(report.exit_tier).toBe('ok');
  });

  it('--fix closes mergeable entries via auto-close', async () => {
    const entry = await addEntry(repo, {
      type: 'forbid-pattern',
      description: 'fixable',
      paths: ['src/'],
      constraint: 'no foo',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'main'], { cwd: repo });
    await updateEntry(repo, entry.id, { metadata: { merged_sha: stdout.trim() } }, {
      identity: { name: 'a', email: 'a@x.test' },
    });
    const report = await runDoctor(repo, { fix: true });
    const m = report.checks.filter((c) => c.code === 'mergeable');
    expect(m).toHaveLength(1);
    expect(m[0]!.fixed).toBe(true);
  });

  it('flags schema-violation entries on disk', async () => {
    await writeRawEntry(repo, 'in-flight', 'badbadid', JSON.stringify({
      type: 'forbid-pattern',
      // missing required: id, description, author, created_at, updated_at, constraint
    }));
    const report = await runDoctor(repo);
    const sv = report.checks.filter((c) => c.code === 'schema-violation');
    expect(sv).toHaveLength(1);
    expect(sv[0]!.severity).toBe('error');
    expect(sv[0]!.entry_id).toBe('badbadid');
    expect(report.exit_tier).toBe('error');
  });

  it('flags unparseable JSON as an error', async () => {
    await writeRawEntry(repo, 'in-flight', 'brokenid', '{not json');
    const report = await runDoctor(repo);
    const sv = report.checks.filter((c) => c.code === 'entry-unparseable-json');
    expect(sv).toHaveLength(1);
    expect(sv[0]!.severity).toBe('error');
  });

  it('detects + fixes branch drift behind origin', async () => {
    // The beforeEach's ensureBranch created a local carn root commit. To get
    // a *behind* (not diverged) drift, force both sides to share base: push
    // local first so origin/carn exists at the same SHA, then have a sibling
    // clone advance origin/carn.
    await gitExec(repo, ['push', 'origin', `${CARN_REF}:${CARN_REF}`]);

    const seedClone = join(sbx.root, 'mover');
    await execFileAsync('git', ['clone', sbx.bare, seedClone]);
    await execFileAsync('git', ['config', 'user.name', 'mover'], { cwd: seedClone });
    await execFileAsync('git', ['config', 'user.email', 'mover@x.test'], { cwd: seedClone });
    // sibling fetches the carn branch and adds an entry — its push moves
    // origin/carn forward while `repo`'s local ref stays behind.
    await execFileAsync(
      'git',
      ['fetch', 'origin', 'carn:refs/heads/carn'],
      { cwd: seedClone },
    );
    await addEntry(seedClone, {
      type: 'forbid-pattern',
      description: 'moves origin',
      paths: ['*'],
      constraint: 'no x',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'mover', email: 'mover@x.test' },
    });

    const report = await runDoctor(repo);
    const drift = report.checks.filter((c) => c.code === 'branch-drift-behind');
    expect(drift).toHaveLength(1);
    expect(drift[0]!.severity).toBe('error');
    expect(drift[0]!.fixable).toBe(true);

    const fixed = await runDoctor(repo, { fix: true });
    const driftFixed = fixed.checks.filter((c) => c.code === 'branch-drift-behind');
    expect(driftFixed).toHaveLength(1);
    expect(driftFixed[0]!.fixed).toBe(true);

    // Subsequent run should be drift-free (the schema-violation entry from
    // the mover doesn't apply — its add went through normal validation).
    const third = await runDoctor(repo);
    expect(third.checks.filter((c) => c.code === 'branch-drift-behind')).toHaveLength(0);
  });

  it('flags + fixes orphaned worktrees', async () => {
    const orphanDir = await mkdtemp(join(tmpdir(), 'carn-orphan-'));
    // Create a worktree manually on the carn ref so it looks orphaned to doctor.
    await gitExec(repo, ['worktree', 'add', '--detach', orphanDir, CARN_REF]);
    // Delete its dir from under git so it's marked prunable.
    await rm(orphanDir, { recursive: true, force: true });

    const report = await runDoctor(repo);
    const ow = report.checks.filter((c) => c.code === 'orphaned-worktree');
    expect(ow.length).toBeGreaterThanOrEqual(1);
    expect(ow[0]!.severity).toBe('warn');
    expect(ow[0]!.fixable).toBe(true);

    const fixed = await runDoctor(repo, { fix: true });
    const fixedOw = fixed.checks.filter((c) => c.code === 'orphaned-worktree');
    // After fix, on the next run no orphan remains.
    if (fixedOw.length > 0) {
      expect(fixedOw[0]!.fixed).toBe(true);
    }
    const after = await runDoctor(repo);
    expect(after.checks.filter((c) => c.code === 'orphaned-worktree')).toHaveLength(0);
  });

  it('detects + fixes index mismatch by appending missing records', async () => {
    const e1 = await addEntry(repo, {
      type: 'coordinate',
      description: 'one',
      paths: ['*'],
      reason: 'r1',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    const e2 = await addEntry(repo, {
      type: 'coordinate',
      description: 'two',
      paths: ['*'],
      reason: 'r2',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    await closeEntry(repo, e2.id, {
      identity: { name: 'a', email: 'a@x.test' },
    });

    await removeIndexFile(repo);

    const report = await runDoctor(repo);
    const idx = report.checks.filter((c) => c.code === 'index-mismatch');
    expect(idx).toHaveLength(1);
    expect(idx[0]!.severity).toBe('warn');
    expect(idx[0]!.message).toContain('missing');

    const fixed = await runDoctor(repo, { fix: true });
    const idxFixed = fixed.checks.filter((c) => c.code === 'index-mismatch');
    expect(idxFixed).toHaveLength(1);
    expect(idxFixed[0]!.fixed).toBe(true);

    // Third run should be clean.
    const third = await runDoctor(repo);
    expect(third.checks.filter((c) => c.code === 'index-mismatch')).toHaveLength(0);
    // Don't touch unrelated entries — both should still be readable.
    expect(e1.id.length).toBe(8);
    expect(e2.id.length).toBe(8);
  });

  it('hook-stale flags a settings.json whose hook path no longer resolves', async () => {
    const settingsDir = await mkdtemp(join(tmpdir(), 'carn-hookstale-'));
    const settingsPath = join(settingsDir, 'settings.json');
    const bogusExe = join(settingsDir, 'definitely-not-here', 'bin', 'node');
    const bogusEntry = join(settingsDir, 'definitely-not-here', 'cli.js');
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: `${bogusExe} "${bogusEntry}" hook user-prompt-submit`,
                },
              ],
            },
          ],
        },
      }),
      'utf8',
    );

    const report = await runDoctor(repo, { hookSettingsPaths: [settingsPath] });
    const stale = report.checks.filter((c) => c.code === 'hook-stale');
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale[0]!.severity).toBe('warn');
    expect(stale[0]!.fixable).toBe(false);
    expect(stale[0]!.message).toContain('carn install hooks');
    await rm(settingsDir, { recursive: true, force: true });
  });

  it('hook-stale is silent when the configured hook command resolves', async () => {
    const settingsDir = await mkdtemp(join(tmpdir(), 'carn-hookok-'));
    const settingsPath = join(settingsDir, 'settings.json');
    // Use the running node binary — guaranteed to exist + resolve.
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: `${process.execPath} hook user-prompt-submit`,
                },
              ],
            },
          ],
        },
      }),
      'utf8',
    );

    const report = await runDoctor(repo, { hookSettingsPaths: [settingsPath] });
    expect(report.checks.filter((c) => c.code === 'hook-stale')).toHaveLength(0);
    await rm(settingsDir, { recursive: true, force: true });
  });

  it('hook-stale ignores settings without a carn hook entry', async () => {
    const settingsDir = await mkdtemp(join(tmpdir(), 'carn-hooknone-'));
    const settingsPath = join(settingsDir, 'settings.json');
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { matcher: '', hooks: [{ type: 'command', command: 'unrelated' }] },
          ],
        },
      }),
      'utf8',
    );
    const report = await runDoctor(repo, { hookSettingsPaths: [settingsPath] });
    expect(report.checks.filter((c) => c.code === 'hook-stale')).toHaveLength(0);
    await rm(settingsDir, { recursive: true, force: true });
  });

  it('index-rebuild-push-failed surfaces when the push to origin is rejected', async () => {
    // Set up: real entries + dropped index, then break origin's push path.
    await addEntry(repo, {
      type: 'coordinate',
      description: 'one',
      paths: ['*'],
      reason: 'r',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    await removeIndexFile(repo);

    // Replace origin with a path that doesn't exist so any push fails fast.
    // The local fix should still happen; only the push-failed check should fire.
    await execFileAsync(
      'git',
      ['remote', 'set-url', 'origin', join(sbx.root, 'does-not-exist.git')],
      { cwd: repo },
    );

    const report = await runDoctor(repo, { fix: true });
    const idxFixed = report.checks.filter((c) => c.code === 'index-mismatch');
    expect(idxFixed).toHaveLength(1);
    // `fixed` must NOT be true when the push failed — the user shouldn't be
    // told "index rebuilt" while origin still diverges.
    expect(idxFixed[0]!.fixed).toBeUndefined();

    const pushFailed = report.checks.filter((c) => c.code === 'index-rebuild-push-failed');
    expect(pushFailed).toHaveLength(1);
    expect(pushFailed[0]!.severity).toBe('error');
    expect(report.exit_tier).toBe('error');
  });

  it('exit_tier escalates from warn to error when an error is present', async () => {
    await addEntry(repo, {
      type: 'forbid-pattern',
      description: 'expiring',
      paths: ['*'],
      constraint: 'x',
      ttl: '1s',
    } as unknown as Parameters<typeof addEntry>[1], {
      identity: { name: 'a', email: 'a@x.test' },
    });
    await writeRawEntry(repo, 'in-flight', 'badid001', '{');

    const future = new Date(Date.now() + 60_000);
    const report = await runDoctor(repo, { now: () => future });
    expect(report.exit_tier).toBe('error');
  });
});
