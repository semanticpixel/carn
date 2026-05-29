import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Shape of a single hook entry inside `.claude/settings.json`. Claude
 * Code reads hooks as `{ <event>: { matchers: [...] } }` — we only
 * touch `UserPromptSubmit`. Anything else in the file is preserved
 * verbatim so we don't clobber the user's other hook configs.
 */
export interface ClaudeSettings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InstallOptions {
  /** Where to write. Default: `<cwd>/.claude/settings.json`. */
  target: 'project' | 'user';
  /** Override the cwd / home dir (tests). */
  cwd?: string;
  home?: string;
  /** Overwrite an existing carn hook if true; warn-only otherwise. */
  force?: boolean;
  /** Override the carn binary path written into the hook command. */
  command?: string;
}

export interface InstallResult {
  /** Path that was written. */
  path: string;
  /** Whether the file was created from scratch (no prior settings.json). */
  created: boolean;
  /** Whether the carn hook was already present and skipped. */
  skipped: boolean;
}

/**
 * Substring used to recognise carn's UserPromptSubmit hook within an
 * existing `settings.json`. Intentionally narrow to the subcommand suffix
 * so both the legacy `carn hook user-prompt-submit` form and the new
 * absolute-path form (`<node> <entry> hook user-prompt-submit`) match.
 */
export const CARN_HOOK_MARKER = 'hook user-prompt-submit';

/**
 * Lock the absolute path at install time. `carn` may not be on the shell's
 * PATH when Claude Code spawns the hook — on macOS especially, GUI-spawned
 * shells get a stripped `launchd` PATH (`/usr/bin:/bin:/usr/sbin:/sbin`)
 * that doesn't include npm-global / homebrew / cargo bins. Surfaced as
 * `/bin/sh: carn: command not found` in real-Claude smoke even with carn
 * on the user's terminal PATH.
 *
 * Using `process.execPath` (the node binary currently running this install)
 * plus the path to the CLI entry (`process.argv[1]`) gives a portable,
 * PATH-independent command that works in both pre-publish (`node
 * dist/cli.js`) and post-publish (`node <npm-prefix>/lib/node_modules/carn/
 * dist/cli.js`) invocations. `JSON.stringify` quotes the path so spaces
 * don't break shell tokenisation.
 */
export function defaultCommand(): string {
  const entry = process.argv[1];
  if (!entry) return CARN_HOOK_MARKER;
  return `${process.execPath} ${JSON.stringify(entry)} hook user-prompt-submit`;
}

export function resolveSettingsPath(opts: InstallOptions): string {
  if (opts.target === 'user') {
    return join(opts.home ?? homedir(), '.claude', 'settings.json');
  }
  return join(opts.cwd ?? process.cwd(), '.claude', 'settings.json');
}

interface HookMatcher {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

interface UserPromptSubmitHooks {
  UserPromptSubmit?: HookMatcher[];
}

function hooksObject(settings: ClaudeSettings): UserPromptSubmitHooks {
  if (settings.hooks && typeof settings.hooks === 'object') {
    return settings.hooks as UserPromptSubmitHooks;
  }
  return {};
}

function carnAlreadyConfigured(hooks: UserPromptSubmitHooks): boolean {
  const matchers = hooks.UserPromptSubmit ?? [];
  for (const m of matchers) {
    for (const h of m.hooks ?? []) {
      if (typeof h.command === 'string' && h.command.includes(CARN_HOOK_MARKER)) {
        return true;
      }
    }
  }
  return false;
}

function buildCarnMatcher(command: string): HookMatcher {
  return {
    matcher: '',
    hooks: [{ type: 'command', command }],
  };
}

function mergeCarnHook(settings: ClaudeSettings, command: string, force: boolean): {
  next: ClaudeSettings;
  skipped: boolean;
} {
  const hooks = hooksObject(settings);
  if (carnAlreadyConfigured(hooks) && !force) {
    return { next: settings, skipped: true };
  }

  // Strip any pre-existing carn entries so --force replaces rather than
  // appending a second copy. Non-carn matchers are preserved verbatim.
  const remaining = (hooks.UserPromptSubmit ?? []).map((m) => ({
    ...m,
    hooks: (m.hooks ?? []).filter(
      (h) => typeof h.command !== 'string' || !h.command.includes(CARN_HOOK_MARKER),
    ),
  })).filter((m) => (m.hooks ?? []).length > 0);

  const next: ClaudeSettings = {
    ...settings,
    hooks: {
      ...(settings.hooks as Record<string, unknown> | undefined),
      UserPromptSubmit: [...remaining, buildCarnMatcher(command)],
    },
  };
  return { next, skipped: false };
}

/**
 * Install the carn hook into a `.claude/settings.json` file. Idempotent:
 * a second invocation without `--force` exits with `skipped: true`. With
 * `--force`, replaces any existing carn hook entry but never touches
 * other matchers or top-level keys.
 *
 * The merge reads the existing JSON, runs the merge in memory, then
 * writes the whole file atomically. Tests verify a pre-existing
 * unrelated hook (e.g. for `Stop` event) is preserved exactly.
 */
export async function installHook(opts: InstallOptions): Promise<InstallResult> {
  const path = resolveSettingsPath(opts);
  const command = opts.command ?? defaultCommand();

  let existing: ClaudeSettings = {};
  const created = !existsSync(path);
  if (!created) {
    try {
      const raw = await readFile(path, 'utf8');
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') existing = parsed as ClaudeSettings;
      }
    } catch (err) {
      throw new Error(
        `carn install: could not parse ${path} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const { next, skipped } = mergeCarnHook(existing, command, Boolean(opts.force));
  if (skipped) return { path, created: false, skipped: true };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { path, created, skipped: false };
}
