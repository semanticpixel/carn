import pc from 'picocolors';
import type { Entry } from '../types.js';

/**
 * `--json` output contract — STABLE. ST-7 (MCP) and ST-8 (hook installer)
 * consume this; bumping the shape is a breaking change.
 *
 * ## List / query JSON
 *
 * ```json
 * { "entries": Entry[] }
 * ```
 *
 * ## Show JSON
 *
 * ```json
 * { "entry": Entry }
 * ```
 *
 * ## Init JSON
 *
 * ```json
 * { "branch": "carn", "sha": "<commit>" }
 * ```
 *
 * ## Add / close JSON
 *
 * ```json
 * { "entry": Entry }
 * ```
 *
 * Where `Entry` is the discriminated union exported from `src/types.ts`.
 * Unknown extra fields are preserved verbatim via `.passthrough()` on the
 * schema so a v1 client reading v2 entries never drops fields silently.
 */
export const JSON_SCHEMA_VERSION = 1;

function colorEnabled(stream: NodeJS.WriteStream): boolean {
  // Read env at call time, not module load: tests toggle these per case and a
  // long-running parent process shouldn't have its color decision baked in
  // at import time. Cost is one env lookup per `painter()` call.
  const noColor =
    typeof process.env.NO_COLOR === 'string' && process.env.NO_COLOR !== '';
  if (noColor) return false;
  const forceColor =
    typeof process.env.FORCE_COLOR === 'string' && process.env.FORCE_COLOR !== '0';
  if (forceColor) return true;
  return Boolean(stream.isTTY);
}

interface Painter {
  bold: (s: string) => string;
  dim: (s: string) => string;
  cyan: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
}

function identity(s: string): string {
  return s;
}

export function painter(stream: NodeJS.WriteStream = process.stdout): Painter {
  if (!colorEnabled(stream)) {
    return {
      bold: identity,
      dim: identity,
      cyan: identity,
      yellow: identity,
      red: identity,
      green: identity,
    };
  }
  return {
    bold: pc.bold,
    dim: pc.dim,
    cyan: pc.cyan,
    yellow: pc.yellow,
    red: pc.red,
    green: pc.green,
  };
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function visibleLen(s: string): number {
  // Strip ANSI SGR — keep table widths honest when color is on. Pattern
  // covers the small set picocolors actually emits.
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function pad(s: string, w: number): string {
  const v = visibleLen(s);
  return v >= w ? s : s + ' '.repeat(w - v);
}

export function renderTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  if (rows.length === 0) return '';
  const widths = header.map((h, i) =>
    Math.max(visibleLen(h), ...rows.map((r) => visibleLen(r[i] ?? ''))),
  );
  const lines: string[] = [];
  lines.push(header.map((h, i) => pad(h, widths[i]!)).join('  '));
  for (const row of rows) {
    lines.push(row.map((c, i) => pad(c ?? '', widths[i]!)).join('  '));
  }
  return lines.join('\n') + '\n';
}

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function humanAge(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '?';
  const delta = now.getTime() - then;
  if (delta < 0) return '0s';
  const days = Math.floor(delta / MS_PER_DAY);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(delta / MS_PER_HOUR);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.floor(delta / 60000);
  if (minutes >= 1) return `${minutes}m`;
  return `${Math.max(1, Math.floor(delta / 1000))}s`;
}

export function shortDescription(s: string, max = 60): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function formatEntryRow(entry: Entry): string[] {
  return [
    entry.id,
    entry.type,
    shortDescription(entry.description),
    entry.ttl ?? '-',
    entry.author,
    humanAge(entry.updated_at),
  ];
}

export const TABLE_HEADER = ['ID', 'TYPE', 'DESCRIPTION', 'TTL', 'AUTHOR', 'AGE'] as const;
