import { randomBytes } from 'node:crypto';

// Crockford-ish base32 without the ambiguous glyphs (i, l, o, 0, 1).
// 24 chars; 8 chars ⇒ ~4.7e11 keyspace.
export const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const ID_LENGTH = 8;

if (ID_ALPHABET.length !== 32) {
  throw new Error(
    `ID_ALPHABET must be exactly 32 chars for unbiased mapping; got ${ID_ALPHABET.length}`,
  );
}

export function generateId(): string {
  // 32 == 2^5: a byte's top 5 bits map cleanly to one alphabet slot, no rejection sampling needed.
  const bytes = randomBytes(ID_LENGTH);
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ID_ALPHABET[bytes[i]! >> 3];
  }
  return out;
}

const VALID = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && VALID.test(value);
}
