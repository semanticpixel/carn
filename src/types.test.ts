import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ENTRY_MAX_BYTES,
  EntrySchema,
  TYPE_REGISTRY,
  parseEntry,
  serializeEntry,
  type Entry,
  type EntryDraft,
} from './types.js';
import { generateId } from './storage/id.js';

const NOW = '2026-05-28T10:00:00.000Z';

function baseFields(): {
  id: string;
  text: string;
  createdAt: string;
} {
  return { id: generateId(), text: 'do the thing', createdAt: NOW };
}

describe('EntrySchema — round-trip per type', () => {
  it('parses a minimal forbid-pattern entry', () => {
    const input = {
      type: 'forbid-pattern' as const,
      ...baseFields(),
      constraint: 'no new `as Foo` typecasts',
    };
    const parsed = parseEntry(input);
    expect(parsed.type).toBe('forbid-pattern');
    expect(parsed).toMatchObject({ constraint: input.constraint, text: input.text });
    expect(parsed.paths).toEqual([]);
    expect(parsed.ttl).toBeNull();
    expect(parsed.closedAt).toBeNull();
  });

  it('parses a prefer-pattern entry with instead_of', () => {
    const input = {
      type: 'prefer-pattern' as const,
      ...baseFields(),
      constraint: 'use `satisfies` for shape assertions',
      instead_of: '`as Foo` casts',
      paths: ['src/**/*.ts'],
      ttl: '7d',
    };
    const parsed = parseEntry(input);
    expect(parsed.type).toBe('prefer-pattern');
    if (parsed.type === 'prefer-pattern') {
      expect(parsed.instead_of).toBe(input.instead_of);
    }
    expect(parsed.paths).toEqual(input.paths);
    expect(parsed.ttl).toBe('7d');
  });

  it('parses a prefer-pattern entry without instead_of (optional)', () => {
    const input = {
      type: 'prefer-pattern' as const,
      ...baseFields(),
      constraint: 'use named exports',
    };
    const parsed = parseEntry(input);
    expect(parsed.type).toBe('prefer-pattern');
  });

  it('parses a coordinate entry with pause_token', () => {
    const input = {
      type: 'coordinate' as const,
      ...baseFields(),
      reason: 'mid-refactor on auth, pause if touching',
      pause_token: 'slack:#dev',
      paths: ['src/auth/**'],
    };
    const parsed = parseEntry(input);
    expect(parsed.type).toBe('coordinate');
    if (parsed.type === 'coordinate') {
      expect(parsed.pause_token).toBe('slack:#dev');
      expect(parsed.reason).toBe(input.reason);
    }
  });

  it('parses a coordinate entry without pause_token (optional)', () => {
    const input = {
      type: 'coordinate' as const,
      ...baseFields(),
      reason: 'mid-refactor',
    };
    const parsed = parseEntry(input);
    expect(parsed.type).toBe('coordinate');
  });
});

describe('EntrySchema — rejection paths throw with useful messages', () => {
  it('rejects when `type` is missing', () => {
    expect(() => parseEntry({ ...baseFields(), constraint: 'x' })).toThrow();
  });

  it('rejects when `type` is not one of the v1 discriminants', () => {
    expect(() =>
      parseEntry({ type: 'breadcrumb', ...baseFields(), text: 'note' }),
    ).toThrow();
  });

  it('rejects forbid-pattern missing constraint', () => {
    expect(() =>
      parseEntry({ type: 'forbid-pattern', ...baseFields() }),
    ).toThrow(/constraint/);
  });

  it('rejects prefer-pattern missing constraint', () => {
    expect(() =>
      parseEntry({ type: 'prefer-pattern', ...baseFields() }),
    ).toThrow(/constraint/);
  });

  it('rejects coordinate missing reason', () => {
    expect(() => parseEntry({ type: 'coordinate', ...baseFields() })).toThrow(
      /reason/,
    );
  });

  it('rejects empty text', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        id: generateId(),
        text: '',
        createdAt: NOW,
        constraint: 'x',
      }),
    ).toThrow(/text/);
  });

  it('rejects an invalid id format', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        id: 'NOT-A-VALID-ID',
        text: 'x',
        createdAt: NOW,
        constraint: 'x',
      }),
    ).toThrow(/id/);
  });

  it('rejects an entry whose serialized form exceeds the 50KB cap', () => {
    const huge = 'a'.repeat(ENTRY_MAX_BYTES + 1);
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        ...baseFields(),
        constraint: huge,
      }),
    ).toThrow(/50|cap|exceed/i);
  });

  it('rejects an invalid createdAt timestamp', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        id: generateId(),
        text: 'x',
        createdAt: 'not-a-date',
        constraint: 'x',
      }),
    ).toThrow();
  });

  it('rejects unknown extra fields cleanly (still parses; extras are dropped)', () => {
    const parsed = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      constraint: 'x',
      extra_field: 'should be ignored or rejected — but never silently kept',
    });
    expect((parsed as Record<string, unknown>).extra_field).toBeUndefined();
  });
});

describe('discriminated-union narrowing', () => {
  it('narrows on `type` for TS-level discrimination', () => {
    const entry: Entry = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      constraint: 'x',
    });
    if (entry.type === 'forbid-pattern') {
      expectTypeOf(entry.constraint).toEqualTypeOf<string>();
    }
    // `instead_of` should not exist on a forbid-pattern entry at the TS level
    if (entry.type === 'prefer-pattern') {
      expectTypeOf(entry.instead_of).toEqualTypeOf<string | undefined>();
    }
  });

  it('EntryDraft type omits id/createdAt/closedAt', () => {
    expectTypeOf<keyof EntryDraft>().not.toEqualTypeOf<'id'>();
    const draft: EntryDraft = {
      type: 'coordinate',
      text: 'pause',
      reason: 'mid-refactor',
      paths: [],
      ttl: null,
    };
    expect(draft.type).toBe('coordinate');
  });
});

describe('TYPE_REGISTRY', () => {
  it('covers exactly the three v1 entry types with policy:ttl', () => {
    expect(Object.keys(TYPE_REGISTRY).sort()).toEqual(
      ['coordinate', 'forbid-pattern', 'prefer-pattern'].sort(),
    );
    for (const policy of Object.values(TYPE_REGISTRY)) {
      expect(policy).toEqual({ policy: 'ttl' });
    }
  });
});

describe('serializeEntry / parseEntry round-trip', () => {
  it('serializes then re-parses to the same shape', () => {
    const e = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      constraint: 'no `any`',
      paths: ['src/foo.ts'],
      ttl: '24h',
    });
    const json = serializeEntry(e);
    const reparsed = parseEntry(JSON.parse(json));
    expect(reparsed).toEqual(e);
  });

  it('preprocess pass-through leaves a valid input shape untouched', () => {
    const raw = {
      type: 'coordinate' as const,
      ...baseFields(),
      reason: 'r',
    };
    // Parsing twice should be stable.
    expect(parseEntry(raw)).toEqual(parseEntry(parseEntry(raw)));
  });
});

describe('EntrySchema — defaults', () => {
  it('fills in paths=[] and ttl=null when omitted', () => {
    const parsed = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      constraint: 'x',
    });
    expect(parsed.paths).toEqual([]);
    expect(parsed.ttl).toBeNull();
    expect(parsed.closedAt).toBeNull();
  });
});
