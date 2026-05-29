/**
 * Legacy re-export shim. The canonical home for shared test helpers is
 * `src/test-utils/`. Kept so existing CLI test imports keep working —
 * new tests should import from `'../test-utils/index.js'` (or a specific
 * submodule) directly.
 *
 * `makeFixtureRepo()` here forwards to the canonical helper with the
 * default options (no carn branch, no seeded entries), which matches
 * the original behavior the CLI suite depends on.
 */
export { makeFixtureRepo, type FixtureRepo } from '../test-utils/fixture-repo.js';
export { runCli, type CliResult } from '../test-utils/cli-runner.js';
