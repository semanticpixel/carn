import { closeEntry } from '../storage/entry.js';
import type { GitIdentity } from '../storage/worktree.js';
import type { Entry } from '../types.js';
import { resolveEntry } from './show.js';

export interface CloseOptions {
  identity: GitIdentity;
  mergedSha?: string;
}

/**
 * Close an entry by id or id-prefix. When `mergedSha` is provided and the
 * entry is still in-flight, the SHA is merged into `metadata` atomically
 * in the same commit as the in-flight → closed move.
 */
export async function closeEntryById(
  repoRoot: string,
  idOrPrefix: string,
  opts: CloseOptions,
): Promise<Entry> {
  const target = await resolveEntry(repoRoot, idOrPrefix);
  const metadataPatch =
    typeof opts.mergedSha === 'string' && opts.mergedSha.length > 0
      ? { merged_sha: opts.mergedSha }
      : undefined;
  return closeEntry(repoRoot, target.id, { identity: opts.identity, metadataPatch });
}
