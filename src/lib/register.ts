import { addEntry } from '../storage/entry.js';
import type { GitIdentity } from '../storage/worktree.js';
import type { Entry, EntryDraft } from '../types.js';

export interface RegisterOptions {
  identity: GitIdentity;
}

/**
 * Register a new entry. The lib accepts a fully-formed `EntryDraft`
 * (type + per-type fields). Validation against the schema happens inside
 * `addEntry`. Identity is required — both the CLI and MCP layers resolve
 * it explicitly upstream so failures surface with a meaningful message
 * before any storage work begins.
 */
export async function registerEntry(
  repoRoot: string,
  draft: EntryDraft,
  opts: RegisterOptions,
): Promise<Entry> {
  return addEntry(repoRoot, draft, { identity: opts.identity });
}
