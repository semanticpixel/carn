# carn

Live, typed, repo-scoped context for AI agents and the humans they work with.

> A *carn* (Scottish Gaelic, the root English borrowed as *cairn*) is a stack
> of stones hikers leave to mark a trail. Same idea applied to code — small,
> durable markers that tell the next person which way the work is going.

## The problem

You're tightening lint rules across the codebase. While you're doing it, your
teammate's agent introduces three new typecasts. You don't see it until the
merge conflict. Their agent didn't see your work-in-progress because there
was nowhere to look.

This is the same shape as a hundred paper cuts:

- A coworker is mid-refactor on a path you're about to touch
- Past-you tried approach X and it didn't work; current-you doesn't remember
- A decision was made three months ago and the reasoning lives in a Slack
  thread nobody can find
- Two of your own agents (Claude Code in a terminal, Codex in a browser tab)
  are doing related work and don't know about each other

The common thread: **state that's relevant to "what should I do here?" but
lives nowhere queryable.**

`carn` is a small CLI + MCP server that gives you somewhere to put it.

## How it works

Each entry in carn is a typed, scoped, dated note. Stored as JSON files on a
dedicated orphan branch in your repo (`carn`), so it's git-versioned, shared
with your team, and works offline.

```bash
$ carn add "Removing typecasts; tightening ESLint" \
    --type forbid-pattern \
    --constraint "Don't introduce new \`as Foo\` casts; use satisfies or explicit types" \
    --paths "src/**/*.ts" \
    --ttl 7d

✓ added na6ppiup forbid-pattern
```

Your teammate's agent at session start runs:

```bash
$ carn query --paths src/services/auth.ts

ID        TYPE            DESCRIPTION                            TTL  AUTHOR             AGE
na6ppiup  forbid-pattern  Removing typecasts; tightening ESLint  6d   luis@team.example  1s
```

…and surfaces the constraint to your teammate before their agent writes a
single typecast.

## Entry types

v1:

| Type              | Purpose                                              | Lifespan                |
| ----------------- | ---------------------------------------------------- | ----------------------- |
| `forbid-pattern`  | Block an in-flight refactor's regressions            | TTL + close on merge    |
| `prefer-pattern`  | Suggest the new way during a transition              | TTL + close on merge    |
| `coordinate`      | Pause and check before touching certain paths        | TTL + manual close      |

Planned (v2+):

| Type              | Purpose                                              | Lifespan                |
| ----------------- | ---------------------------------------------------- | ----------------------- |
| `breadcrumb`      | "Tried X, didn't work because Y, switched to Z"      | Evergreen               |
| `decision`        | "We chose X over Y because Z"                        | Append-only, supersede  |
| `gotcha`          | "This looks wrong but is intentional because..."     | Evergreen               |
| `session-handoff` | "Where I left off; pick up from..."                  | Until next session      |

## Storage model

carn uses an orphan branch with no shared history with `main`:

```
main          ── feature work, your code
carn          ── isolated branch, just .carn/ entries (managed by the CLI)
```

Each entry is its own file (`.carn/in-flight/<uuid>.json`) so concurrent
writes from two agents don't conflict. Closed entries archive to
`.carn/closed/`. An append-only `.carn/index.jsonl` gives fast scans.

CI ignores the `carn` branch by convention. Force-push is blocked by the
CLI. Full git history of every entry is preserved.

## Install

```bash
npm install -g carn
```

## Quick start

```bash
cd your-repo
carn init                          # creates the carn branch and structure
carn add "..." --type ... ...      # registers an entry
carn list                          # shows active entries
carn show <id>                     # full details
carn close <id>                    # marks resolved
carn query --paths "src/foo/**"    # path-scoped query
```

## Agent integration

carn ships an MCP server and a Claude Code hook installer. The hook fires
on `UserPromptSubmit` and queries carn for entries relevant to the paths
the prompt mentions, surfacing them as a system reminder before the agent
acts.

```bash
carn install hooks                 # writes UserPromptSubmit hook to
                                   # .claude/settings.json (project or user)
```

For other tools (Codex, Cursor, OpenCode), point their MCP config at the
carn server:

```bash
carn mcp                           # starts the MCP server on stdio
```

## Examples

Three worked walkthroughs:

- [examples/typecast-removal.md](./examples/typecast-removal.md) —
  `forbid-pattern` for an in-flight tightening
- [examples/coordinate-refactor.md](./examples/coordinate-refactor.md) —
  `coordinate` for cross-team work
- [examples/prefer-pattern-migration.md](./examples/prefer-pattern-migration.md) —
  `prefer-pattern` for a gradual API migration

## Health check

```bash
carn doctor                        # TTL expired, schema violations,
                                   # branch drift, stale hooks, ...
carn doctor --fix                  # apply the auto-fixable subset
carn doctor --json                 # machine-readable report
```

Exit codes: `0` clean, `1` warnings only, `2` errors.

## FAQ

**Can I use carn without Claude Code?**
Yes. The CLI is the primary surface; the MCP server works with any
MCP client (Codex, Cursor, OpenCode). Claude Code's hook is one
convenience integration, not a requirement.

**What about Cursor / Codex?**
Add the MCP server to their config — `carn mcp` over stdio. The six
tools (`carn_register`, `carn_query`, `carn_list`, `carn_show`,
`carn_close`, `carn_update`) work the same as the CLI commands.

**How do I keep CI from running on the carn branch?**
Add `carn` to your branch protection's "ignore for CI" list, or
gate your workflows on `if: github.ref != 'refs/heads/carn'`.
carn's storage is just JSON files — your test suite has nothing
useful to say about it.

## Why an orphan branch?

- **No infra.** Git is the network. Already authenticated, already shared,
  already versioned.
- **One source of truth.** Both humans (via CLI) and agents (via MCP) write
  to the same place.
- **Isolation.** main's history stays clean; CI doesn't churn on every entry.
- **Conflict-free in practice.** One file per entry means concurrent writes
  almost never collide.

## Status

v0.1.0 — initial release. Covers live constraints (`forbid-pattern`,
`prefer-pattern`, `coordinate`). v2 will add breadcrumbs and decisions.
See [PLAN.md](./PLAN.md) for the roadmap and
[CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

MIT
