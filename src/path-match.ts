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
  if (isSentinel(p)) return p;
  // The product is repo-scoped, where all paths are git-tracked → always
  // posix slashes on disk. But CLI users on Windows will pass `\` from cmd.
  // Convert before matching so picomatch's posix-only globs apply uniformly.
  let n = p.replace(/\\/g, '/');
  // Strip a leading `./` — `./src/foo.ts` is the same scope as `src/foo.ts`
  // and shells/CLIs frequently produce the former from tab completion or
  // explicit `./` patterns.
  if (n.startsWith('./')) n = n.slice(2);
  // Trim a trailing slash (but never the bare root `/`) — `src/auth/` and
  // `src/auth` describe the same directory scope.
  if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
  // Absolute paths are intentionally left as-is: picomatch will fail to
  // match them against relative globs, which is the correct behavior for a
  // repo-scoped tool. ST-5's CLI is expected to reject them at the argv
  // boundary before they reach here.
  return n;
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
  // Defensive: an empty entryPaths array shouldn't appear in validated Entry
  // data — ST-3's schema normalises `[]` → `['*']` on parse. But path-match
  // may be called with hand-built arrays from CLI/MCP layers; treat the
  // empty case as repo-wide so callers don't have to remember the rule.
  if (entryPaths.length === 0) return true;
  // An empty queryPaths means "nothing to ask about" → no overlap. The
  // "no filter" semantic lives on `filterByPaths`, not here. Callers asking
  // about overlap with an empty query should get the predicate's answer:
  // false. (See filterByPaths below for the no-filter shortcut.)
  if (queryPaths.length === 0) return false;
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
