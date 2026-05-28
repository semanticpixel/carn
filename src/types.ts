import { z } from 'zod';
import { isValidId } from './storage/id.js';

/**
 * 50KB cap on serialized entry size. Prevents a runaway agent or paste-bomb
 * from blowing up the carn branch, and keeps `carn query` IO cheap.
 */
export const ENTRY_MAX_BYTES = 50 * 1024;

/** Hard cap on the human description field — long-form notes live in linked docs, not entries. */
export const DESCRIPTION_MAX_LEN = 2000;

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
 * Naming convention: snake_case for all storage-owned fields (created_at,
 * updated_at, closed_at) and for per-type fields the spec already names in
 * snake_case (instead_of, pause_token). Aligns with downstream items —
 * ST-5 CLI flags, ST-6 `metadata.merged_sha` lookup, ST-9 doctor's
 * "no updates in 30+ days" check that reads `updated_at`.
 *
 * `paths` defaults to `[]` — an unscoped entry applies everywhere.
 * `ttl` is a human-friendly duration string like `7d` or `24h`; ST-6
 * validates the spec format. Here we just require a non-empty string
 * when set so a typo'd flag doesn't silently persist as `"undefined"`.
 * `metadata` is the open extension bag — ST-6 stores `merged_sha`,
 * future items add their own keys without expanding the base shape.
 * `author` is required; ST-5's CLI auto-populates from `git config
 * user.email` and fails loudly when unset, so making it optional in
 * the schema would let a buggy caller silently skip provenance.
 */
const baseShape = {
  id: CarnId,
  description: z.string().min(1, 'description is required').max(DESCRIPTION_MAX_LEN),
  paths: z.array(z.string().min(1)).default([]),
  author: z.string().min(1, 'author is required'),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  closed_at: IsoDateTime.nullable().default(null),
  ttl: z.string().min(1).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
};

// .passthrough() preserves unknown fields on round-trip — critical for forward-
// compatibility once v2 adds new fields. The ST-10 forward-compat test relies
// on this: a v1-pinned client reading then re-writing a v2 entry must not
// silently drop the v2 fields.
export const ForbidPatternEntry = z
  .object({
    type: z.literal('forbid-pattern'),
    ...baseShape,
    constraint: z.string().min(1, 'forbid-pattern requires a constraint'),
  })
  .passthrough();

export const PreferPatternEntry = z
  .object({
    type: z.literal('prefer-pattern'),
    ...baseShape,
    constraint: z.string().min(1, 'prefer-pattern requires a constraint'),
    instead_of: z.string().min(1).optional(),
  })
  .passthrough();

export const CoordinateEntry = z
  .object({
    type: z.literal('coordinate'),
    ...baseShape,
    reason: z.string().min(1, 'coordinate requires a reason'),
    pause_token: z.string().min(1).optional(),
  })
  .passthrough();

/**
 * The canonical Entry schema. The 50KB cap rides on `.refine()` (not
 * `z.preprocess`) so failure modes stay homogenous — every validation
 * failure is a `z.ZodError`, never a plain `Error`. Downstream code
 * (ST-9 doctor's "schema violation" check) can catch ZodError as the
 * single signal.
 *
 * (No `z.preprocess` migration seam in ST-3; there is no historical
 * shape to translate yet. ST-6 / future items can add one when needed.)
 */
export const EntrySchema = z
  .discriminatedUnion('type', [
    ForbidPatternEntry,
    PreferPatternEntry,
    CoordinateEntry,
  ])
  .refine(
    (entry) =>
      Buffer.byteLength(JSON.stringify(entry), 'utf8') <= ENTRY_MAX_BYTES,
    {
      message: `entry exceeds ${ENTRY_MAX_BYTES}-byte cap`,
    },
  );

export type Entry = z.infer<typeof EntrySchema>;
export type EntryType = Entry['type'];

/**
 * What addEntry accepts — everything except the fields the storage layer
 * fills in (id, created_at, updated_at, closed_at, author). Built from
 * `z.input<>` (not `z.infer<>`) so defaulted fields like `paths`, `ttl`,
 * `metadata` stay correctly *optional* on the input side — the CLI in
 * ST-5 doesn't have to construct empty defaults when its flags are absent.
 *
 * The mapped form (rather than plain `Omit`) is required because plain
 * `Omit<A | B | C, K>` collapses to the *common* keys; distributing
 * preserves each variant's per-type fields like `constraint` / `reason`.
 */
export type EntryDraft = z.input<typeof EntrySchema> extends infer E
  ? E extends z.input<typeof EntrySchema>
    ? Omit<E, 'id' | 'created_at' | 'updated_at' | 'closed_at' | 'author'>
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
