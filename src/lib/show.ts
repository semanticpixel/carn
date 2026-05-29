import { getEntry, listEntries } from '../storage/entry.js';
import type { Entry } from '../types.js';
import { EntryRefError } from './errors.js';

export interface ResolveResult {
  entry: Entry;
}

/**
 * Resolve an 8-char id or a prefix to exactly one entry. Throws
 * `EntryRefError` on miss or ambiguity so the calling surface can map
 * the kind onto its error vocabulary (exit codes for CLI, JSON-RPC
 * errors for MCP).
 */
export async function resolveEntry(
  repoRoot: string,
  idOrPrefix: string,
): Promise<Entry> {
  // Fast path: full-length id — single getEntry call, no full directory walk.
  if (idOrPrefix.length === 8) {
    const exact = await getEntry(repoRoot, idOrPrefix);
    if (exact) return exact;
  }
  const all = await listEntries(repoRoot, { status: 'all' });
  const matches = all.filter((e) => e.id.startsWith(idOrPrefix));
  if (matches.length === 0) {
    throw new EntryRefError('not-found', `no entry with id '${idOrPrefix}'.`);
  }
  if (matches.length > 1) {
    throw new EntryRefError(
      'ambiguous',
      `ambiguous id prefix '${idOrPrefix}' (${matches.length} matches).`,
      matches.map((e) => e.id),
    );
  }
  return matches[0]!;
}
