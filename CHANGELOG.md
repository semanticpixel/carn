# Changelog

All notable changes to `carn` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-29

Initial release.

### Added

- **Storage layer.** Orphan `carn` branch with per-entry JSON files,
  append-only `.carn/index.jsonl`, atomic worktree-based CRUD. Never
  touches the user's working tree.
- **Entry schemas.** Zod discriminated union over three v1 types
  (`forbid-pattern`, `prefer-pattern`, `coordinate`). 50 KB cap per
  entry; `.passthrough()` preserves unknown fields for forward-compat.
- **Path matching.** Bidirectional glob overlap via `picomatch`.
  Repo-wide sentinel `*` on either side.
- **CLI.** Six commands wired to the storage + schema + path-match
  layers: `init`, `add`, `list`, `show`, `close`, `query`. Stable
  `--json` output. `NO_COLOR` respected.
- **CLI: greedy array flags.** `--paths a b c` now consumes all three
  values (was: only `a`, with `b c` falling into positionals). Repeated
  `--paths a --paths b` continues to work; `--paths=a` stays bounded by
  convention. Surfaced by the dogfooding loop itself.
- **TTL + auto-close.** `--ttl 7d` style durations; `carn close
  --auto-merged` closes in-flight entries whose `metadata.merged_sha`
  is now an ancestor of the default branch.
- **MCP server.** Six tools exposed over stdio for agent clients
  (Claude Code, Cursor, Codex). `carn mcp` starts the server.
- **Claude Code hook installer.** `carn install hooks [--user]
  [--force]` writes a `UserPromptSubmit` hook into
  `.claude/settings.json`. Hook surfaces matching entries as a
  `<system-reminder>` block before the agent answers.
- **Doctor.** `carn doctor [--fix]` surfaces TTL-expired entries,
  schema violations, branch drift, orphaned worktrees, index
  mismatches, mergeable entries, and stale Claude Code hooks.
  Documented `--json` shape.

### Notes

- Node ≥ 24 supported; Node 22 works locally with a single engine warning.
- No real network is required by any test; a local bare repo serves as
  origin in push tests.
- See [PLAN.md](./PLAN.md) for the v2 roadmap.

[Unreleased]: https://github.com/semanticpixel/carn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/semanticpixel/carn/releases/tag/v0.1.0
