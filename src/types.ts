import { z } from 'zod';
import { isValidId } from './storage/id.js';

/**
 * 50KB cap on serialized entry size. Prevents a runaway agent or paste-bomb
 * from blowing up the carn branch, and keeps `carn query` IO cheap.
 */
export const ENTRY_MAX_BYTES = 50 * 1024;

const IsoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'must be an ISO 8601 timestamp parseable by Date.parse',
  });

const CarnId = z.string().refine((v) => isValidId(v), {
  message: 'must be a valid 8-char carn id',
});

/**
 * Fields shared by every entry type. Per-type schemas extend this with the
 * `type` discriminator and any type-specific fields.
 *
 * `paths` defaults to `[]` — an unscoped entry applies everywhere.
 * `ttl` is a human-friendly duration string like `7d` or `24h`. Validation
 * of the spec format lives in path-matching / TTL items; here we just
 * require a non-empty string when set so a typo'd flag doesn't silently
 * persist as the literal string `"undefined"`.
 * `closedAt` is null while the entry is in-flight, ISO timestamp once closed.
 */
const baseShape = {
  id: CarnId,
  text: z.string().min(1, 'text is required'),
  paths: z.array(z.string().min(1)).default([]),
  ttl: z.string().min(1).nullable().default(null),
  createdAt: IsoDateTime,
  closedAt: IsoDateTime.nullable().default(null),
  author: z.string().min(1).optional(),
};

export const ForbidPatternEntry = z.object({
  type: z.literal('forbid-pattern'),
  ...baseShape,
  constraint: z.string().min(1, 'forbid-pattern requires a constraint'),
});

export const PreferPatternEntry = z.object({
  type: z.literal('prefer-pattern'),
  ...baseShape,
  constraint: z.string().min(1, 'prefer-pattern requires a constraint'),
  instead_of: z.string().min(1).optional(),
});

export const CoordinateEntry = z.object({
  type: z.literal('coordinate'),
  ...baseShape,
  reason: z.string().min(1, 'coordinate requires a reason'),
  pause_token: z.string().min(1).optional(),
});

const EntryDiscriminator = z.discriminatedUnion('type', [
  ForbidPatternEntry,
  PreferPatternEntry,
  CoordinateEntry,
]);

/**
 * The canonical Entry schema. Routes through `z.preprocess` so future
 * schema migrations have a single hook to live in. ST-3 ships no actual
 * migrations (there is no historical shape yet) — the preprocess is a
 * pass-through plus the load-bearing 50KB size cap.
 *
 * The size cap is asserted **on the raw input** rather than the parsed
 * Entry so we reject oversized payloads before paying their parse cost.
 */
export const EntrySchema = z.preprocess(
  (raw) => {
    if (raw !== null && typeof raw === 'object') {
      const serialized = JSON.stringify(raw);
      if (Buffer.byteLength(serialized, 'utf8') > ENTRY_MAX_BYTES) {
        throw new Error(
          `entry exceeds ${ENTRY_MAX_BYTES}-byte cap (got ${Buffer.byteLength(serialized, 'utf8')} bytes)`,
        );
      }
    }
    return raw;
  },
  EntryDiscriminator,
);

export type Entry = z.infer<typeof EntrySchema>;
export type EntryType = Entry['type'];

/**
 * What addEntry accepts — everything except the fields the storage layer
 * fills in (id, createdAt, closedAt).
 *
 * The mapped form (rather than plain `Omit`) is required because plain
 * `Omit<A | B | C, K>` collapses to the *common* keys; distributing
 * preserves each variant's per-type fields like `constraint` / `reason`.
 */
export type EntryDraft = Entry extends infer E
  ? E extends Entry
    ? Omit<E, 'id' | 'createdAt' | 'closedAt'>
    : never
  : never;

/**
 * Per-type lifespan policy. All v1 types use `ttl`; v2 items will add
 * `evergreen` and `supersede` to this registry. Centralising the map keeps
 * the addition of a new entry type a one-place change.
 */
export const TYPE_REGISTRY: Record<EntryType, { policy: 'ttl' }> = {
  'forbid-pattern': { policy: 'ttl' },
  'prefer-pattern': { policy: 'ttl' },
  coordinate: { policy: 'ttl' },
};

/**
 * Parse an unknown value into an Entry. Throws a Zod error with a useful
 * message on failure — never silently yields partials.
 */
export function parseEntry(raw: unknown): Entry {
  return EntrySchema.parse(raw);
}

/** Serialize an entry, validating it first. */
export function serializeEntry(entry: Entry): string {
  const validated = EntrySchema.parse(entry);
  return JSON.stringify(validated, null, 2);
}
