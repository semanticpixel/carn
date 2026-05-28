import picomatch from 'picomatch';

/**
 * The repo-wide sentinel. An entry with `paths: ['*']` (or a query for
 * `['*']`) means "applies to / asks about everywhere" — bypasses the
 * per-pattern matcher and short-circuits to true.
 *
 * Surfaced via a constant so the CLI in ST-5 / MCP in ST-7 can render the
 * exact same literal in `--paths` flag help and validate against it.
 */
export const REPO_WIDE_SENTINEL = '*';

// We normalise Windows separators in `normalize()` before they reach
// picomatch, so picomatch sees posix paths uniformly regardless of host OS.
const PICOMATCH_OPTS: picomatch.PicomatchOptions = {
  dot: true,
};

function normalize(p: string): string {
  // The product is repo-scoped, where all paths are git-tracked → always
  // posix slashes on disk. But CLI users on Windows will pass `\` from cmd.
  // Convert before matching so picomatch's posix-only globs apply uniformly.
  return p.replace(/\\/g, '/');
}

function isSentinel(p: string): boolean {
  return p === REPO_WIDE_SENTINEL;
}

/**
 * Does one path "match" another? Bidirectional: either side may be the
 * glob, the other the literal — or both globs that overlap (e.g.
 * `src/**` overlaps `src/auth/**`).
 *
 * The overlap definition is `picomatch(a)(b) || picomatch(b)(a)`. For two
 * concrete paths this reduces to equality. For two compatible globs
 * (`src/**` vs `src/auth/**`) the more-specific side matches the wider
 * pattern, so the predicate fires correctly.
 */
function singleOverlap(a: string, b: string): boolean {
  if (isSentinel(a) || isSentinel(b)) return true;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  return picomatch(na, PICOMATCH_OPTS)(nb) || picomatch(nb, PICOMATCH_OPTS)(na);
}

/**
 * Returns true if any path in `entryPaths` overlaps any path in
 * `queryPaths`. An entry "overlaps" a query when its scope and the
 * query's scope intersect — either side may be a glob, a concrete file,
 * or the `'*'` sentinel.
 */
export function pathsOverlap(entryPaths: string[], queryPaths: string[]): boolean {
  // Empty entryPaths means an unscoped entry → applies everywhere → always
  // overlaps any non-empty query.
  if (entryPaths.length === 0) return true;
  // An empty queryPaths means "no filter at this layer" — by convention we
  // treat that as overlap too, so `pathsOverlap(entry, [])` is consistent
  // with `filterByPaths(entries, [])` returning all entries.
  if (queryPaths.length === 0) return true;
  for (const e of entryPaths) {
    for (const q of queryPaths) {
      if (singleOverlap(e, q)) return true;
    }
  }
  return false;
}

/**
 * Filter entries to those whose `paths` overlap `queryPaths`. Matches the
 * CLI flag shape: `carn query --paths src/auth/login.ts`.
 *
 * Empty `queryPaths` returns input unchanged — same as the CLI's "no
 * `--paths` filter" behavior.
 */
export function filterByPaths<T extends { paths: string[] }>(
  entries: T[],
  queryPaths: string[],
): T[] {
  if (queryPaths.length === 0) return entries;
  return entries.filter((e) => pathsOverlap(e.paths, queryPaths));
}
