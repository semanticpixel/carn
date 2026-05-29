/**
 * Shared core consumed by the CLI (`src/cli/*.ts`) and the MCP server
 * (`src/mcp/tools/*.ts`). Pure orchestration — no color, no table
 * rendering, no JSON serialisation. Each function takes a `repoRoot`
 * and returns plain data (Entry, Entry[], or a small result type),
 * letting the calling surface choose its own presentation.
 *
 * Identity resolution lives in the calling layer (CLI reads `git
 * config`; MCP reuses the CLI helper). That keeps `src/lib/` free of
 * git-config side effects so tests can drive it with explicit
 * identities.
 */
export { registerEntry, type RegisterOptions } from './register.js';
export { queryEntries, type QueryOptions } from './query.js';
export { listEntriesFiltered, type ListOptions } from './list.js';
export { resolveEntry, type ResolveResult } from './show.js';
export { closeEntryById, type CloseOptions } from './close.js';
export { updateEntryById, type UpdateOptions } from './update.js';
export { EntryRefError } from './errors.js';
