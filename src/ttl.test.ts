import { describe, expect, it } from 'vitest';
import {
  TtlParseError,
  assertValidTtl,
  isExpired,
  parseTtl,
  ttlExpiresAt,
  ttlRemaining,
} from './ttl.js';
import type { Entry } from './types.js';

const NOW = new Date('2026-05-28T12:00:00.000Z');

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'abcdwxyz',
    type: 'forbid-pattern',
    description: 'sample',
    paths: ['*'],
    author: 'me@example.com',
    created_at: '2026-05-28T10:00:00.000Z',
    updated_at: '2026-05-28T10:00:00.000Z',
    closed_at: null,
    ttl: null,
    metadata: {},
    constraint: 'x',
    ...overrides,
  } as Entry;
}

describe('parseTtl — happy path', () => {
  it.each([
    ['7d', 7, 'd', 7 * 86400 * 1000],
    ['24h', 24, 'h', 24 * 3600 * 1000],
    ['30m', 30, 'm', 30 * 60 * 1000],
    ['90s', 90, 's', 90 * 1000],
    ['2w', 2, 'w', 2 * 7 * 86400 * 1000],
  ] as const)('parses %s', (input, count, unit, durationMs) => {
    const parsed = parseTtl(input);
    expect(parsed.count).toBe(count);
    expect(parsed.unit).toBe(unit);
    expect(parsed.durationMs).toBe(durationMs);
    expect(parsed.source).toBe(input);
  });

  it('trims surrounding whitespace', () => {
    expect(parseTtl('  3d  ').source).toBe('3d');
  });
});

describe('parseTtl — rejection paths', () => {
  it.each(['', 'abc', '7', 'd', '7y', '1mo', '0d', '-1d', '7.5d', '7 d', '7days'])(
    'rejects %s',
    (input) => {
      expect(() => parseTtl(input)).toThrow(TtlParseError);
    },
  );

  it('error message points at the supported units and the y/mo exclusion', () => {
    let msg = '';
    try {
      parseTtl('1y');
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain('s|m|h|d|w');
    expect(msg).toContain('y/mo');
  });
});

describe('assertValidTtl', () => {
  it('returns void on valid TTL', () => {
    expect(() => assertValidTtl('7d')).not.toThrow();
  });
  it('throws on invalid TTL', () => {
    expect(() => assertValidTtl('garbage')).toThrow(TtlParseError);
  });
});

describe('ttlExpiresAt', () => {
  it('returns null when entry has no TTL', () => {
    expect(ttlExpiresAt(makeEntry({ ttl: null }))).toBeNull();
  });
  it('returns created_at + durationMs for a TTL entry', () => {
    const entry = makeEntry({
      ttl: '7d',
      created_at: '2026-05-21T10:00:00.000Z',
    });
    expect(ttlExpiresAt(entry)).toBe(Date.parse('2026-05-28T10:00:00.000Z'));
  });
  it('returns null when created_at is unparseable (defensive)', () => {
    const entry = makeEntry({ ttl: '7d', created_at: 'not-a-date' });
    expect(ttlExpiresAt(entry)).toBeNull();
  });
});

describe('isExpired', () => {
  it('returns false for entries without a TTL', () => {
    expect(isExpired(makeEntry({ ttl: null }), NOW)).toBe(false);
  });

  it('returns false for closed entries even when past TTL', () => {
    const entry = makeEntry({
      ttl: '1h',
      created_at: '2026-05-28T10:00:00.000Z',
      closed_at: '2026-05-28T10:30:00.000Z',
    });
    expect(isExpired(entry, NOW)).toBe(false);
  });

  it('returns true when now is past created_at + TTL', () => {
    const entry = makeEntry({
      ttl: '1h',
      created_at: '2026-05-28T10:00:00.000Z',
    });
    expect(isExpired(entry, NOW)).toBe(true);
  });

  it('returns false when now is before created_at + TTL', () => {
    const entry = makeEntry({
      ttl: '7d',
      created_at: '2026-05-28T11:00:00.000Z',
    });
    expect(isExpired(entry, NOW)).toBe(false);
  });
});

describe('ttlRemaining', () => {
  it('returns null when entry has no TTL', () => {
    expect(ttlRemaining(makeEntry({ ttl: null }), NOW)).toBeNull();
  });

  it('returns "expired" when past TTL', () => {
    const entry = makeEntry({
      ttl: '1h',
      created_at: '2026-05-28T10:00:00.000Z',
    });
    expect(ttlRemaining(entry, NOW)).toBe('expired');
  });

  it('matches the spec example: --ttl 7d then 1d later shows 6d', () => {
    const entry = makeEntry({
      ttl: '7d',
      created_at: '2026-05-27T12:00:00.000Z',
    });
    expect(ttlRemaining(entry, NOW)).toBe('6d');
  });

  it('falls back to hours and minutes for shorter remainders', () => {
    const hours = makeEntry({
      ttl: '24h',
      created_at: '2026-05-28T08:00:00.000Z',
    });
    expect(ttlRemaining(hours, NOW)).toBe('20h');

    const minutes = makeEntry({
      ttl: '90m',
      created_at: '2026-05-28T11:00:00.000Z',
    });
    expect(ttlRemaining(minutes, NOW)).toBe('30m');
  });
});
