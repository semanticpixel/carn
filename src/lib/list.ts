import { listEntries } from '../storage/entry.js';
import { isExpired } from '../ttl.js';
import type { Entry, EntryType } from '../types.js';

export interface ListOptions {
  /** Default: 'in-flight'. */
  status?: 'in-flight' | 'closed' | 'all';
  type?: EntryType;
  /** Match `entry.author` exactly. */
  author?: string;
  excludeExpired?: boolean;
}

/**
 * Filtered list. Mirrors the CLI's `carn list` flag set so a CLI handler
 * and an MCP tool see the same surface.
 */
export async function listEntriesFiltered(
  repoRoot: string,
  opts: ListOptions = {},
): Promise<Entry[]> {
  let entries = await listEntries(repoRoot, { status: opts.status ?? 'in-flight' });
  if (opts.type) entries = entries.filter((e) => e.type === opts.type);
  if (opts.author) entries = entries.filter((e) => e.author === opts.author);
  if (opts.excludeExpired) entries = entries.filter((e) => !isExpired(e));
  return entries;
}
