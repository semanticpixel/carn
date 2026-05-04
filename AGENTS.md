# AGENTS.md — carn

Live, typed, repo-scoped context for AI agents and the humans they work
with. A small CLI + MCP server that lets you register dated, scoped notes
("don't introduce new typecasts here", "I'm refactoring auth, pause if
you're touching it") so other agents and humans see them before they act.

See [PLAN.md](./PLAN.md) for the full roadmap and per-item implementation
notes. See [README.md](./README.md) for the product framing.

## Toolchain

- **Package manager:** pnpm (pinned via `packageManager` in package.json).
- **Node:** version in `.nvmrc`.
- **Language:** TypeScript, strict mode, ES2022 target, NodeNext modules.
- **Bundler:** tsup (esm only, dts on).
- **Tests:** vitest, co-located `*.test.ts` next to sources.

## Commands

```sh
pnpm install           # install deps
pnpm build             # bundle src -> dist
pnpm dev               # tsup --watch
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run
pnpm test:watch        # vitest in watch mode
pnpm lint              # placeholder, no linter yet
```

## Layout

```
src/
  cli.ts               # CLI entry (bin: carn)
  index.ts             # library barrel (currently empty)
  mcp/
    server.ts          # MCP server entry (stub until item 7)
```

## Commit format

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`,
`refactor:`. Reference the PLAN item when relevant — e.g.
`feat: storage layer (#2)` for plan item 2.

## Hard rules

These are load-bearing and apply across the project:

1. **TypeScript strict.** No `any` without an inline justification comment
   explaining why a stronger type isn't reachable.
2. **No new runtime dependencies without discussion.** Add a note in the
   PR description proposing the dep and the alternative considered.
   Devtime-only deps (test, build, types) are fine.
3. **All entry-shape changes go through Zod schemas** (item 3 in PLAN.md).
   No ad-hoc parsing of entry JSON outside `src/types.ts`.
4. **Tests co-located with sources.** `src/foo.ts` ↔ `src/foo.test.ts`.
   Vitest discovers `**/*.test.ts` under `src/`.
5. **Storage operations never mutate the user's working directory's git
   state** (item 2 in PLAN.md). The carn branch must be manipulated via
   plumbing or a temp worktree — never a checkout in the user's repo.

## Conventions

- Default to writing no comments. Only add one when the WHY is non-obvious.
- Prefer editing existing files to creating new ones.
- Keep PRs scoped to a single PLAN item where possible.

## Working with carn while building carn

Once item 5 (CLI) lands, register `carn` entries for in-flight work on
this repo itself. Eat the dog food.
