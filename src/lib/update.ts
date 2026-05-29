import { updateEntry } from '../storage/entry.js';
import type { GitIdentity } from '../storage/worktree.js';
import type { Entry } from '../types.js';
import { resolveEntry } from './show.js';

export interface UpdateOptions {
  identity: GitIdentity;
  patch: Record<string, unknown>;
}

/**
 * Update an entry by id or id-prefix. The `patch` is shallow-merged into
 * the existing entry and re-validated against the schema. `id` cannot be
 * patched (the storage layer pins it). Closed entries cannot be updated.
 */
export async function updateEntryById(
  repoRoot: string,
  idOrPrefix: string,
  opts: UpdateOptions,
): Promise<Entry> {
  const target = await resolveEntry(repoRoot, idOrPrefix);
  return updateEntry(repoRoot, target.id, opts.patch, { identity: opts.identity });
}
