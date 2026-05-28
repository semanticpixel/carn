import { describe, it, expect } from 'vitest';
import { ID_ALPHABET, ID_LENGTH, generateId, isValidId } from './id.js';

describe('id', () => {
  it('alphabet excludes the load-bearing ambiguous glyphs (l, o, 0, 1) and is exactly 32 chars', () => {
    // Lowercase `i` is intentionally kept — dropping it would land at 31 chars and
    // break unbiased mapping from a random byte's top 5 bits. The spec's literal
    // alphabet is the contract; the 32-char arity is what makes generateId() safe.
    for (const ch of 'lo01') {
      expect(ID_ALPHABET).not.toContain(ch);
    }
    expect(ID_ALPHABET).toHaveLength(32);
  });

  it('generates IDs of the configured length using only alphabet chars', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateId();
      expect(id).toHaveLength(ID_LENGTH);
      for (const ch of id) {
        expect(ID_ALPHABET).toContain(ch);
      }
    }
  });

  it('produces unique IDs across 10k draws (no collisions in practice)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(generateId());
    }
    expect(seen.size).toBe(10_000);
  });

  it('isValidId accepts well-formed IDs and rejects malformed ones', () => {
    expect(isValidId(generateId())).toBe(true);
    expect(isValidId('abc')).toBe(false);
    expect(isValidId('abcdefgh'.toUpperCase())).toBe(false);
    expect(isValidId('iiiiiiii')).toBe(true); // `i` is in-alphabet (see alphabet test).
    expect(isValidId('llllllll')).toBe(false);
    expect(isValidId('oooooooo')).toBe(false);
    expect(isValidId('00000000')).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(12345678)).toBe(false);
  });
});
