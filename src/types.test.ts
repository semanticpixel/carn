import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  DESCRIPTION_MAX_LEN,
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
  description: string;
  author: string;
  created_at: string;
  updated_at: string;
} {
  return {
    id: generateId(),
    description: 'do the thing',
    author: 'luis@example.com',
    created_at: NOW,
    updated_at: NOW,
  };
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
    expect(parsed).toMatchObject({
      constraint: input.constraint,
      description: input.description,
    });
    // Canonical "applies everywhere" — `[]` and absent both normalise to `['*']`.
    expect(parsed.paths).toEqual(['*']);
    expect(parsed.ttl).toBeNull();
    expect(parsed.closed_at).toBeNull();
    expect(parsed.metadata).toEqual({});
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

describe('EntrySchema — rejection paths throw ZodError with useful messages', () => {
  it('rejects when `type` is missing', () => {
    expect(() => parseEntry({ ...baseFields(), constraint: 'x' })).toThrow(
      z.ZodError,
    );
  });

  it('rejects when `type` is not one of the v1 discriminants', () => {
    expect(() =>
      parseEntry({ type: 'breadcrumb', ...baseFields(), description: 'note' }),
    ).toThrow(z.ZodError);
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

  it('rejects empty description', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        id: generateId(),
        description: '',
        author: 'a',
        created_at: NOW,
        updated_at: NOW,
        constraint: 'x',
      }),
    ).toThrow(/description/);
  });

  it('rejects description over the 2000-char cap', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        ...baseFields(),
        description: 'x'.repeat(DESCRIPTION_MAX_LEN + 1),
        constraint: 'x',
      }),
    ).toThrow();
  });

  it('rejects when `author` is missing (required, not optional)', () => {
    const { author: _omitted, ...rest } = baseFields();
    expect(() =>
      parseEntry({ type: 'forbid-pattern', ...rest, constraint: 'x' }),
    ).toThrow(/author/);
  });

  it('rejects an invalid id format', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        id: 'NOT-A-VALID-ID',
        description: 'x',
        author: 'a',
        created_at: NOW,
        updated_at: NOW,
        constraint: 'x',
      }),
    ).toThrow(/id/);
  });

  it('rejects an entry whose serialized form exceeds the 50KB cap (as ZodError)', () => {
    const huge = 'a'.repeat(ENTRY_MAX_BYTES + 1);
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        ...baseFields(),
        // Use `metadata` (no max len) to push over the byte cap rather than
        // `description` (which has its own 2000-char ceiling).
        metadata: { blob: huge },
        constraint: 'x',
      }),
    ).toThrow(z.ZodError);
  });

  it('rejects an invalid created_at timestamp', () => {
    expect(() =>
      parseEntry({
        type: 'forbid-pattern',
        id: generateId(),
        description: 'x',
        author: 'a',
        created_at: 'not-a-date',
        updated_at: NOW,
        constraint: 'x',
      }),
    ).toThrow();
  });
});

describe('forward-compat: .passthrough() preserves unknown extras on round-trip', () => {
  it('keeps unknown fields verbatim so a v1 client never silently drops v2 keys', () => {
    const parsed = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      constraint: 'x',
      // Mimic a v2 field a v1-pinned client would otherwise drop on round-trip.
      scope: 'team-platform',
    });
    expect((parsed as Record<string, unknown>).scope).toBe('team-platform');
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
    if (entry.type === 'prefer-pattern') {
      expectTypeOf(entry.instead_of).toEqualTypeOf<string | undefined>();
    }
  });

  it('EntryDraft drops storage-owned fields AND keeps defaulted ones optional', () => {
    // `paths`, `ttl`, `metadata` carry .default() in the schema → optional
    // on the *input* type. Storage-owned fields are stripped entirely.
    const draft: EntryDraft = {
      type: 'coordinate',
      description: 'pause',
      reason: 'mid-refactor',
    };
    expect(draft.type).toBe('coordinate');

    // Type-level: id/created_at/updated_at/closed_at/author must NOT be on the draft.
    expectTypeOf<keyof EntryDraft>().not.toEqualTypeOf<'id'>();
    expectTypeOf<keyof EntryDraft>().not.toEqualTypeOf<'created_at'>();
    expectTypeOf<keyof EntryDraft>().not.toEqualTypeOf<'updated_at'>();
    expectTypeOf<keyof EntryDraft>().not.toEqualTypeOf<'closed_at'>();
    expectTypeOf<keyof EntryDraft>().not.toEqualTypeOf<'author'>();
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

  it('parsing twice (idempotency) is stable', () => {
    const raw = {
      type: 'coordinate' as const,
      ...baseFields(),
      reason: 'r',
    };
    expect(parseEntry(raw)).toEqual(parseEntry(parseEntry(raw)));
  });
});

describe('EntrySchema — defaults + canonical paths', () => {
  it('fills in defaults — paths=["*"], ttl=null, closed_at=null, metadata={}', () => {
    const parsed = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      constraint: 'x',
    });
    expect(parsed.paths).toEqual(['*']);
    expect(parsed.ttl).toBeNull();
    expect(parsed.closed_at).toBeNull();
    expect(parsed.metadata).toEqual({});
  });

  it('normalises an explicit empty `paths: []` to the canonical `["*"]`', () => {
    // Avoids the dual representation problem — downstream code never has to
    // test for both `paths: []` and `paths: ['*']` to ask "applies everywhere?"
    const parsed = parseEntry({
      type: 'forbid-pattern',
      ...baseFields(),
      paths: [],
      constraint: 'x',
    });
    expect(parsed.paths).toEqual(['*']);
  });
});
