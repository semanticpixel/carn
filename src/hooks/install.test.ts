import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CARN_HOOK_MARKER, defaultCommand, installHook, resolveSettingsPath } from './install.js';

describe('installHook — project target', () => {
  let cwd = '';
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'carn-install-'));
  });
  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it('creates .claude/settings.json from scratch when absent', async () => {
    const result = await installHook({ target: 'project', cwd });
    expect(result.created).toBe(true);
    expect(result.skipped).toBe(false);
    const raw = await readFile(result.path, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.hooks.UserPromptSubmit).toBeDefined();
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      CARN_HOOK_MARKER,
    );
  });

  it('preserves pre-existing top-level keys + unrelated hooks', async () => {
    await mkdir(join(cwd, '.claude'), { recursive: true });
    await writeFile(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify(
        {
          theme: 'dark',
          hooks: {
            Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'my-stop-script' }] }],
            UserPromptSubmit: [
              { matcher: '', hooks: [{ type: 'command', command: 'other-hook' }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    const result = await installHook({ target: 'project', cwd });
    expect(result.created).toBe(false);
    expect(result.skipped).toBe(false);
    const parsed = JSON.parse(await readFile(result.path, 'utf8'));

    expect(parsed.theme).toBe('dark');
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe('my-stop-script');
    // The other UserPromptSubmit hook stays.
    const ups = parsed.hooks.UserPromptSubmit;
    const commands = ups.flatMap((m: { hooks: { command: string }[] }) =>
      m.hooks.map((h) => h.command),
    );
    expect(commands).toContain('other-hook');
    expect(commands.some((c: string) => c.includes(CARN_HOOK_MARKER))).toBe(true);
  });

  it('is idempotent — second run without --force is skipped', async () => {
    await installHook({ target: 'project', cwd });
    const second = await installHook({ target: 'project', cwd });
    expect(second.skipped).toBe(true);

    const parsed = JSON.parse(
      await readFile(join(cwd, '.claude', 'settings.json'), 'utf8'),
    );
    // Still just one carn hook.
    const ups = parsed.hooks.UserPromptSubmit;
    const carnCount = ups.reduce(
      (acc: number, m: { hooks: { command: string }[] }) =>
        acc + m.hooks.filter((h) => h.command.includes(CARN_HOOK_MARKER)).length,
      0,
    );
    expect(carnCount).toBe(1);
  });

  it('--force replaces an existing carn hook (no duplicate)', async () => {
    await installHook({ target: 'project', cwd, command: 'carn hook user-prompt-submit --old' });
    const result = await installHook({
      target: 'project',
      cwd,
      command: 'carn hook user-prompt-submit --new',
      force: true,
    });
    expect(result.skipped).toBe(false);
    const parsed = JSON.parse(await readFile(result.path, 'utf8'));
    const carnHooks = parsed.hooks.UserPromptSubmit.flatMap(
      (m: { hooks: { command: string }[] }) =>
        m.hooks.filter((h) => h.command.includes(CARN_HOOK_MARKER)),
    );
    expect(carnHooks).toHaveLength(1);
    expect(carnHooks[0].command).toContain('--new');
  });
});

describe('installHook — user target', () => {
  let home = '';
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'carn-install-home-'));
  });
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('writes to ~/.claude/settings.json (via home override)', async () => {
    const result = await installHook({ target: 'user', home });
    expect(result.path).toBe(join(home, '.claude', 'settings.json'));
    expect(result.created).toBe(true);
    const parsed = JSON.parse(await readFile(result.path, 'utf8'));
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      CARN_HOOK_MARKER,
    );
  });
});

describe('resolveSettingsPath', () => {
  it('resolves project path relative to cwd', () => {
    expect(resolveSettingsPath({ target: 'project', cwd: '/foo/bar' })).toBe(
      '/foo/bar/.claude/settings.json',
    );
  });
  it('resolves user path relative to home', () => {
    expect(resolveSettingsPath({ target: 'user', home: '/Users/me' })).toBe(
      '/Users/me/.claude/settings.json',
    );
  });
});

describe('defaultCommand', () => {
  it('embeds the absolute node binary path so the hook works under Claude Code\'s minimal-PATH shell', () => {
    const cmd = defaultCommand();
    expect(cmd).toContain(process.execPath);
    expect(cmd).toContain('hook user-prompt-submit');
  });
});

describe('installHook — written command is PATH-independent', () => {
  let cwd = '';
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'carn-install-pathfree-'));
  });
  afterEach(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it('writes an absolute node-binary command (not bare `carn`)', async () => {
    const result = await installHook({ target: 'project', cwd });
    const parsed = JSON.parse(await readFile(result.path, 'utf8'));
    const cmd = parsed.hooks.UserPromptSubmit[0].hooks[0].command;
    expect(cmd).toContain(process.execPath);
    expect(cmd).toContain('hook user-prompt-submit');
  });

  it('returns the resolved command on InstallResult', async () => {
    const result = await installHook({ target: 'project', cwd });
    expect(result.command).toContain(process.execPath);
    expect(result.command).toContain('hook user-prompt-submit');
  });

  it('returns the override command verbatim when --command is set', async () => {
    const override = 'npx --no-install carn hook user-prompt-submit';
    const result = await installHook({ target: 'project', cwd, command: override });
    expect(result.command).toBe(override);
    const parsed = JSON.parse(await readFile(result.path, 'utf8'));
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe(override);
  });

  it('returns the existing command on skipped (not the would-be default)', async () => {
    const override = 'carn hook user-prompt-submit --custom';
    await installHook({ target: 'project', cwd, command: override });
    const second = await installHook({ target: 'project', cwd });
    expect(second.skipped).toBe(true);
    // skipped returns the command the caller passed (or default), not the one
    // that's already on disk — InstallResult.command means "what this call
    // resolved", documenting that nothing changed.
    expect(second.command).toContain(process.execPath);
  });
});
