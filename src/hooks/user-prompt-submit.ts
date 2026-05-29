import { resolveRepoRoot } from '../cli/context.js';
import { listEntriesFiltered, queryEntries } from '../lib/index.js';
import type { Entry } from '../types.js';
import { isExpired, ttlRemaining } from '../ttl.js';
import { inferPaths } from './infer-paths.js';

interface PromptEnvelope {
  prompt?: string;
  cwd?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseEnvelope(raw: string): PromptEnvelope {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return parsed as PromptEnvelope;
    }
    return {};
  } catch {
    // Not JSON — treat the whole stdin as the prompt body, which keeps
    // the hook useful in ad-hoc test invocations like
    // `echo "fix src/foo.ts" | carn hook user-prompt-submit`.
    return { prompt: trimmed };
  }
}

/**
 * Renders one entry as a compact bullet for the system-reminder block.
 * Format is deterministic so the LLM can quickly scan; we keep `id`
 * up front since the dismiss command (`carn close <id>`) takes it.
 */
function renderEntry(entry: Entry, now: Date): string {
  const lines: string[] = [];
  const ttl = entry.ttl
    ? isExpired(entry, now)
      ? ' [EXPIRED]'
      : ` [ttl: ${ttlRemaining(entry, now) ?? entry.ttl}]`
    : '';
  lines.push(`- \`${entry.id}\` (${entry.type})${ttl} ${entry.description}`);
  if (entry.type === 'forbid-pattern' || entry.type === 'prefer-pattern') {
    lines.push(`  constraint: ${entry.constraint}`);
    if (entry.type === 'prefer-pattern' && entry.instead_of) {
      lines.push(`  instead of: ${entry.instead_of}`);
    }
  } else if (entry.type === 'coordinate') {
    lines.push(`  reason: ${entry.reason}`);
    if (entry.pause_token) {
      lines.push(`  pause-token: ${entry.pause_token}`);
    }
  }
  if (entry.paths.length > 0 && !(entry.paths.length === 1 && entry.paths[0] === '*')) {
    lines.push(`  paths: ${entry.paths.join(', ')}`);
  }
  lines.push(`  author: ${entry.author}`);
  return lines.join('\n');
}

function renderReminder(entries: Entry[], now: Date): string {
  const header =
    entries.length === 1
      ? '1 active carn entry applies to this context:'
      : `${entries.length} active carn entries apply to this context:`;
  const body = entries.map((e) => renderEntry(e, now)).join('\n');
  return [
    '<system-reminder>',
    header,
    '',
    body,
    '',
    'Dismiss any of these with `carn close <id>` once the constraint/coordinate is no longer relevant.',
    '</system-reminder>',
  ].join('\n');
}

export interface UserPromptHookOptions {
  /** Override stdin reader (tests). */
  readStdin?: () => Promise<string>;
  /** Override the clock (tests). */
  now?: Date;
  /** Override cwd resolution (tests). */
  cwd?: string;
}

/**
 * Handler for Claude Code's `UserPromptSubmit` event. Always exits 0 —
 * non-zero would block the prompt, which is never the desired UX.
 * Storage / git failures log to stderr (visible in Claude Code's hook
 * log) but never block.
 */
export async function runUserPromptSubmitHook(
  opts: UserPromptHookOptions = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const reader = opts.readStdin ?? readStdin;
  let raw = '';
  try {
    raw = await reader();
  } catch (err) {
    process.stderr.write(
      `carn hook: failed to read stdin: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 0;
  }

  const envelope = parseEnvelope(raw);
  if (!envelope.prompt || envelope.prompt.trim().length === 0) {
    return 0;
  }

  let repoRoot: string;
  try {
    repoRoot = opts.cwd ?? (await resolveRepoRoot(envelope.cwd ?? process.cwd()));
  } catch {
    // Not in a git repo — silent.
    return 0;
  }

  let entries: Entry[];
  try {
    const paths = await inferPaths({ cwd: repoRoot, prompt: envelope.prompt });
    if (paths.length === 0) {
      // No path signal — surface every in-flight entry (the agent may be
      // about to touch something we couldn't predict from text alone).
      entries = await listEntriesFiltered(repoRoot, { status: 'in-flight' });
    } else {
      entries = await queryEntries(repoRoot, { paths, excludeExpired: false });
    }
  } catch (err) {
    process.stderr.write(
      `carn hook: query failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 0;
  }

  if (entries.length === 0) return 0;
  process.stdout.write(renderReminder(entries, now) + '\n');
  return 0;
}
