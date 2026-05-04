# carn — Plan (done)

> Completed items, archived from [PLAN.md](./PLAN.md). Ordering matches the
> original v1 roadmap so the history reads top-to-bottom.

## How to use this file

When an item in `PLAN.md` is marked done (`### ~~NN. Title~~ DONE`), move
its full block here and prepend a one-line **Recap** noting the resulting
PR or commit. Keep the original block intact below the recap so the
implementation context isn't lost.

---

## v1 items — done

### ~~1. Project bootstrap~~ DONE

**Recap:** TS + pnpm + vitest + tsup scaffolding, AGENTS.md (with CLAUDE.md
symlink), LICENSE, GitHub Actions CI. Placeholder `carn --help` / `--version`
ship; MCP server is a stub awaiting item 7. Delivered via `feat/bootstrap` →
PR #1.

**What:** Set up the TypeScript project with pnpm + vitest + tsconfig +
package.json + AGENTS.md + LICENSE + CI workflow.

**Implementation:**
- TypeScript with strict mode, ES2022 target, NodeNext module resolution
- pnpm (pinned via `packageManager` field) + Node 24 (`.nvmrc`)
- vitest for tests (co-located `*.test.ts`)
- Single `bin` entry in package.json: `carn` → `./dist/cli.js`
- AGENTS.md (symlink CLAUDE.md → AGENTS.md) with project conventions
- GitHub Actions CI: typecheck + test on push and PR
- `tsup` or `unbuild` for bundling

**Acceptance:**
- `pnpm install && pnpm build && pnpm test` exits 0
- `pnpm link` makes `carn --help` work
- CI runs green on a no-op PR

**Out of scope:** Publishing to npm (item 11), release automation.
