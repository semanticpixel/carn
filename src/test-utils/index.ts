/**
 * Canonical home for shared test helpers. Per ST-10's spec, this is the
 * one place to add a new test utility. The legacy locations
 * (`src/storage/_test-utils.ts`, `src/cli/_test-utils.ts`) re-export
 * from here so existing imports keep working — new tests should import
 * from `'./test-utils/index.js'` (or a specific submodule) directly.
 */
export { makeFixtureRepo, type FixtureRepo, type FixtureRepoOptions } from './fixture-repo.js';
export { runCli, type CliResult } from './cli-runner.js';
export { gitStatusSnapshot } from './git-snapshot.js';
