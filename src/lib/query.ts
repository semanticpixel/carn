import { listEntries } from '../storage/entry.js';
import { filterByPaths } from '../path-match.js';
import { isExpired } from '../ttl.js';
import type { Entry, EntryType } from '../types.js';

export interface QueryOptions {
  paths: readonly string[];
  type?: EntryType;
  excludeExpired?: boolean;
}

/**
 * Agent-facing read API: in-flight entries whose `paths` overlap any of
 * the query paths. Optional post-filters: `type` (exact discriminant
 * match), `excludeExpired` (drops past-TTL entries).
 *
 * Returns an empty array when `paths` is empty — callers wanting the
 * "no filter" semantics should use `listEntriesFiltered` instead.
 */
export async function queryEntries(
  repoRoot: string,
  opts: QueryOptions,
): Promise<Entry[]> {
  if (opts.paths.length === 0) return [];
  let entries = await listEntries(repoRoot, { status: 'in-flight' });
  entries = filterByPaths(entries, [...opts.paths]);
  if (opts.type) {
    entries = entries.filter((e) => e.type === opts.type);
  }
  if (opts.excludeExpired) {
    entries = entries.filter((e) => !isExpired(e));
  }
  return entries;
}
