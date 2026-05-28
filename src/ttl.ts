import type { Entry } from './types.js';

/**
 * Supported TTL units. `y` (years) and `mo` (months) are intentionally
 * excluded — too fuzzy for a per-entry shelf-life, and `mo` collides with
 * `m` (minutes) parsing. The error message points at the supported set.
 */
export const TTL_UNITS = ['s', 'm', 'h', 'd', 'w'] as const;
export type TtlUnit = (typeof TTL_UNITS)[number];

const UNIT_MS: Record<TtlUnit, number> = {
  s: 1_000,
  m: 60 * 1_000,
  h: 60 * 60 * 1_000,
  d: 24 * 60 * 60 * 1_000,
  w: 7 * 24 * 60 * 60 * 1_000,
};

const TTL_PATTERN = /^(\d+)(s|m|h|d|w)$/;

export class TtlParseError extends Error {
  constructor(input: string) {
    super(
      `invalid --ttl "${input}": expected a number followed by one of s|m|h|d|w (e.g. "7d", "24h", "30m"). y/mo not supported.`,
    );
    this.name = 'TtlParseError';
  }
}

export interface ParsedTtl {
  count: number;
  unit: TtlUnit;
  /** Stored on the entry verbatim. `parseTtl('7d').source === '7d'`. */
  source: string;
  durationMs: number;
}

/**
 * Parse a TTL string like `7d` or `24h` into its components + total ms.
 * Throws TtlParseError on bad input — the CLI's `add` handler catches and
 * surfaces it as exit-1, so a typo never silently persists.
 */
export function parseTtl(input: string): ParsedTtl {
  const trimmed = input.trim();
  const m = TTL_PATTERN.exec(trimmed);
  if (!m) throw new TtlParseError(input);
  const count = Number.parseInt(m[1]!, 10);
  if (count <= 0) throw new TtlParseError(input);
  const unit = m[2] as TtlUnit;
  return { count, unit, source: trimmed, durationMs: count * UNIT_MS[unit] };
}

/** Validation-only entry point — throws on bad input, otherwise returns void. */
export function assertValidTtl(input: string): void {
  parseTtl(input);
}

/**
 * Compute the absolute expiry timestamp (ms since epoch) for an entry with
 * a TTL. Returns null for entries without a TTL.
 *
 * Anchor is `created_at` — TTL is "how long after creation until this
 * goes stale", not "how long after last touch". That matches user
 * intuition: I added a 7d coordinate, it should expire 7d after I added
 * it regardless of intermediate edits.
 */
export function ttlExpiresAt(entry: Entry): number | null {
  if (!entry.ttl) return null;
  const parsed = parseTtl(entry.ttl);
  const start = Date.parse(entry.created_at);
  if (Number.isNaN(start)) return null;
  return start + parsed.durationMs;
}

/**
 * Is `entry` past its TTL relative to `now`? Closed entries are never
 * expired — once closed they're terminal, the badge would be noise. Entries
 * without a TTL are never expired either.
 */
export function isExpired(entry: Entry, now: Date = new Date()): boolean {
  if (entry.closed_at !== null) return false;
  const expiresAt = ttlExpiresAt(entry);
  if (expiresAt === null) return false;
  return now.getTime() >= expiresAt;
}

/**
 * Human-friendly remaining duration. Returns null when the entry has no
 * TTL. Returns `"expired"` when already past. Otherwise picks the largest
 * unit ≥ 1 (`6d`, `4h`, `30m`, `45s`) so list output stays narrow.
 */
export function ttlRemaining(entry: Entry, now: Date = new Date()): string | null {
  const expiresAt = ttlExpiresAt(entry);
  if (expiresAt === null) return null;
  const delta = expiresAt - now.getTime();
  if (delta <= 0) return 'expired';
  const days = Math.floor(delta / UNIT_MS.d);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(delta / UNIT_MS.h);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.floor(delta / UNIT_MS.m);
  if (minutes >= 1) return `${minutes}m`;
  return `${Math.max(1, Math.floor(delta / UNIT_MS.s))}s`;
}
