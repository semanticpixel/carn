import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TABLE_HEADER,
  formatEntryRow,
  humanAge,
  painter,
  renderTable,
  shortDescription,
} from './format.js';
import type { Entry } from '../types.js';

describe('painter — NO_COLOR awareness', () => {
  const prevNoColor = process.env.NO_COLOR;
  const prevForce = process.env.FORCE_COLOR;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });
  afterEach(() => {
    process.env.NO_COLOR = prevNoColor;
    process.env.FORCE_COLOR = prevForce;
  });

  it('returns identity painters when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    const p = painter({ isTTY: true } as NodeJS.WriteStream);
    expect(p.bold('x')).toBe('x');
    expect(p.cyan('x')).toBe('x');
  });

  it('returns identity painters when stream is not a TTY (default)', () => {
    const p = painter({ isTTY: false } as NodeJS.WriteStream);
    expect(p.bold('x')).toBe('x');
  });
});

describe('humanAge', () => {
  it('formats seconds, minutes, hours, days', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    expect(humanAge('2026-05-28T11:59:30.000Z', now)).toBe('30s');
    expect(humanAge('2026-05-28T11:55:00.000Z', now)).toBe('5m');
    expect(humanAge('2026-05-28T08:00:00.000Z', now)).toBe('4h');
    expect(humanAge('2026-05-25T12:00:00.000Z', now)).toBe('3d');
  });

  it('clamps future timestamps to 0s', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    expect(humanAge('2026-06-01T12:00:00.000Z', now)).toBe('0s');
  });
});

describe('shortDescription', () => {
  it('collapses whitespace and truncates with ellipsis', () => {
    expect(shortDescription('a   b   c')).toBe('a b c');
    const long = 'x'.repeat(80);
    expect(shortDescription(long, 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('renderTable', () => {
  it('aligns columns by max visible width', () => {
    const out = renderTable(['A', 'B'], [
      ['hi', 'world'],
      ['xx', 'yo'],
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toContain('A');
    expect(lines[0]).toContain('B');
    // 'hi' and 'xx' both width 2 vs header 'A' width 1 → padded to width 2.
    expect(lines[1]?.startsWith('hi  ')).toBe(true);
  });

  it('returns "" on empty rows', () => {
    expect(renderTable(['A'], [])).toBe('');
  });
});

describe('formatEntryRow', () => {
  it('produces [id, type, description, ttl|-, author, age]', () => {
    const e: Entry = {
      id: 'abcdwxyz',
      type: 'forbid-pattern',
      description: 'no new casts',
      paths: ['*'],
      author: 'me@example.com',
      created_at: '2026-05-28T10:00:00.000Z',
      updated_at: '2026-05-28T10:00:00.000Z',
      closed_at: null,
      ttl: null,
      metadata: {},
      constraint: 'no `as Foo`',
    };
    const row = formatEntryRow(e);
    expect(row[0]).toBe('abcdwxyz');
    expect(row[1]).toBe('forbid-pattern');
    expect(row[2]).toBe('no new casts');
    expect(row[3]).toBe('-');
    expect(row[4]).toBe('me@example.com');
  });
});

describe('TABLE_HEADER', () => {
  it('has the six locked columns', () => {
    expect(TABLE_HEADER).toEqual(['ID', 'TYPE', 'DESCRIPTION', 'TTL', 'AUTHOR', 'AGE']);
  });
});
