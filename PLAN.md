# carn — Plan

> Living document. v1 ships live constraints; later versions extend the
> typed-entry system to breadcrumbs, decisions, and session handoffs.

## How to use this plan

Each session can tackle one or more items. Items follow this shape:

- **What** — one-line description
- **Why** — motivation (when not obvious)
- **Implementation** — key decisions + entry points; not a line-by-line spec
- **Files to touch** — new + modified
- **Acceptance** — bullet list of how to verify
- **Out of scope** — explicit non-goals

Mark an item done by striking through the title in the index below
(`### ~~NN. Title~~ DONE`) and moving the full block to PLAN-DONE.md.

## Roadmap

### v1 — Live constraints (the typecast scenario)

Three entry types: `forbid-pattern`, `prefer-pattern`, `coordinate`.
Orphan branch storage. CLI + MCP + Claude Code hook.

- ~~1. Project bootstrap (TS, pnpm, vitest, AGENTS.md, CI)~~ DONE — see [PLAN-DONE.md](./PLAN-DONE.md)
- 2. Storage layer (orphan branch + file-per-entry + index.jsonl)
- 3. Entry schema + Zod validation (the three v1 types)
- 4. Path matching (glob support for path-scoped queries)
- 5. CLI: init, add, list, show, close, query
- 6. TTL + auto-close on merge
- 7. MCP server (same operations as tool calls)
- 8. Claude Code hook installer (`carn install hooks`)
- 9. `carn doctor` (stale entries, branch drift, etc.)
- 10. Smoke test coverage (storage + CLI happy paths)
- 11. v0.1.0 release prep + docs sweep

### v2 — Breadcrumbs and decisions

- 12. New entry types: `breadcrumb`, `decision`, `gotcha`
- 13. Lifespan policies (evergreen, append-only-supersede)
- 14. Per-entry author + scope (`personal | team | repo`)

### v3 — Cross-tool, cross-host

- 15. Session-handoff entries
- 16. GitHub Issues backend option (mirror entries as labeled issues)
- 17. Codex / Cursor / OpenCode MCP integration docs
- 18. Multi-repo entries (referenced by name, scoped to repo)

### Speculative

Design-space exploration — see the Speculative section at the bottom for
each idea's current rationale and risk. These may or may not earn promotion
to numbered items.

---

## v1 items — detail

### ~~1. Project bootstrap~~ DONE

Moved to [PLAN-DONE.md](./PLAN-DONE.md).

---

### 2. Storage layer (orphan branch + file-per-entry)

**What:** Library that manages the `carn` orphan branch — creation, reading
entries, writing entries, fetching, pushing.

**Implementation:**
- All git operations via shelling out to `git` (no extra dep beyond what's
  already on every dev machine)
- The CLI never checks out the carn branch in the user's worktree. Instead,
  use `git worktree add` to a temp directory or use `git read-tree` /
  `git update-index` plumbing to manipulate the branch without disturbing
  the user's working state. Decision pending — write a spike.
- Entry path: `.carn/in-flight/<uuid>.json` (in-flight) or
  `.carn/closed/<uuid>.json` (archived)
- Append-only `.carn/index.jsonl` for fast scans (one line per entry,
  rewritten on close)
- Auto-fetch + auto-rebase on every push; fail loudly on real conflicts

**Files:** `src/storage/branch.ts`, `src/storage/entry.ts`, `src/storage/index.ts`

**Acceptance:**
- `carn init` creates the carn branch with the directory structure
- Writing two entries from two simulated workers (separate worktrees) both
  succeed without conflict
- `git log carn -- .carn/in-flight/abc123.json` shows the entry's full history

**Out of scope:** Multi-remote sync (single origin only in v1), entry
encryption, GC of closed entries (manual `carn doctor` for now).

---

### 3. Entry schema + Zod validation

**What:** Define the entry shape with Zod schemas for the three v1 types.
Validate on write; auto-migrate on read for forward compatibility.

**Implementation:**
- Common fields: `id`, `type`, `description`, `paths`, `author`,
  `created_at`, `updated_at`, `closed_at`, `ttl`, `metadata`
- Per-type fields:
  - `forbid-pattern`: `constraint` (string)
  - `prefer-pattern`: `constraint`, `instead_of` (optional)
  - `coordinate`: `reason`, `pause_token` (optional human contact info)
- Zod schemas with `.preprocess()` for backwards compatibility
- 50KB max per entry to prevent runaway content

**Files:** `src/types.ts`, `src/types.test.ts`

**Acceptance:**
- Round-trip: write → read → schema-validate the three types
- Malformed entry rejected with a useful error
- Schema migration test: read an entry written under an older shape

**Out of scope:** Other entry types (v2).

---

### 4. Path matching

**What:** Glob-based path scoping. An entry with `paths: ["src/**/*.ts"]`
matches when a query asks for `src/services/auth.ts`.

**Implementation:**
- Use `picomatch` (small, fast, well-tested)
- Match in both directions: entry-paths-vs-query-path AND
  query-paths-vs-entry-paths (for "this entry covers anything in src/auth")
- `paths: ["*"]` matches everything (repo-wide entries)

**Files:** `src/path-match.ts`, `src/path-match.test.ts`

**Acceptance:**
- Globs match expected paths; non-globs match exact paths
- Query with no `--paths` returns all active entries
- Tests cover common patterns (recursive, file-extension, wildcards)

---

### 5. CLI: init, add, list, show, close, query

**What:** The user-facing commands.

**Commands:**
- `carn init` — create the carn branch + structure
- `carn add <description> --type <type> --paths <glob>... [--ttl <duration>] [other type-specific flags]`
- `carn list [--type <type>] [--author <name>]` — active entries
- `carn show <id>` — full details
- `carn close <id> [--merged-sha <sha>]`
- `carn query --paths <path>...` — path-scoped, JSON output for agents

**Implementation:**
- `commander` or hand-rolled arg parser (lean toward hand-rolled to avoid
  a dep)
- Color output via `picocolors` (tiny)
- `--json` flag on every read command for agent consumption
- `carn add` reads stdin if no `<description>` is given (so agents can
  pipe long content in)

**Files:** `src/cli/*.ts`, one file per command

**Acceptance:**
- All six commands work end-to-end against a test fixture repo
- `--json` output validates against a documented schema
- `carn --help` shows useful, complete documentation
- `carn <typo>` returns a "did you mean" hint

**Out of scope:** Interactive prompts, tab completion (later), `edit` /
`update` commands (close + re-add for now).

---

### 6. TTL + auto-close on merge

**What:** Entries optionally specify a TTL (`7d`, `2w`, etc.). Past TTL,
they're flagged stale by `carn doctor`. Entries can also be auto-closed
when their tracked branch merges.

**Implementation:**
- Parse TTL strings via `ms` package (or hand-rolled — small)
- `carn close --merged-sha <sha>` records the merge SHA in entry metadata
- `carn doctor --auto-close` scans for entries whose linked SHA is now
  ancestor of `main`, closes them
- Stale = past TTL OR no updates in 30 days (configurable)

**Files:** `src/ttl.ts`, `src/auto-close.ts`

**Acceptance:**
- Entry with `--ttl 1h` is reported stale by `doctor` after 1 hour
- Auto-close detects merged branches and closes their entries
- Closed entries show their close reason (manual / TTL / merge)

**Out of scope:** Auto-close on PR close (no PR API yet — v3).

---

### 7. MCP server

**What:** Expose the same operations as MCP tool calls so any MCP-aware
agent (Claude Code, Codex, Cursor, OpenCode) can use carn directly.

**Tools exposed:**
- `carn_register`
- `carn_query`
- `carn_list`
- `carn_show`
- `carn_close`
- `carn_update`

**Implementation:**
- Use `@modelcontextprotocol/sdk` for the server
- stdio transport (`carn mcp` starts a stdio server)
- Each tool wraps the corresponding library function (CLI is also a wrapper —
  share the core)

**Files:** `src/mcp/server.ts`, tool definitions

**Acceptance:**
- `carn mcp` starts a server that responds to MCP `tools/list`
- Each tool round-trips through the library and returns expected output
- Smoke-tested against a real Claude Code session

**Out of scope:** HTTP/SSE transport (later), authentication.

---

### 8. Claude Code hook installer

**What:** `carn install hooks` writes a `UserPromptSubmit` hook to
`.claude/settings.json` that runs `carn query --paths <inferred>` and
injects the results as a system reminder.

**Implementation:**
- Detect existing `.claude/settings.json`; merge non-destructively
- Hook config: `UserPromptSubmit` matcher with a command that calls
  `carn hook user-prompt-submit` (a hidden subcommand that reads the
  prompt from stdin, infers paths, queries carn, prints the system
  reminder to stdout)
- Path inference: regex-based scan for file-like tokens in the prompt
  + git-aware fallback (recently touched files)
- `carn install hooks --user` writes to `~/.claude/settings.json` instead
  of the project file

**Files:** `src/hooks/install.ts`, `src/hooks/user-prompt-submit.ts`

**Acceptance:**
- Hook installs cleanly into a fresh `.claude/settings.json`
- Hook installs cleanly alongside existing hooks (no clobber)
- In a real Claude Code session, an active entry surfaces as a system
  reminder when the user mentions a matching path

**Out of scope:** PreToolUse hooks (v2), PostToolUse hooks (v2), other
agents' hook formats (Codex/Cursor have different conventions — separate
items).

---

### 9. `carn doctor`

**What:** Health check command. Surfaces stale entries, branch drift,
malformed entries, etc.

**Checks:**
- Entries past their TTL
- Entries whose linked branch was deleted
- Schema violations
- Carn branch out of date with origin
- Entries with no updates in 30+ days
- Closed entries that should be archived

**Files:** `src/doctor.ts`, `src/doctor.test.ts`

**Acceptance:**
- `carn doctor` produces a readable report of issues
- `carn doctor --fix` can resolve auto-fixable issues
- Exit code reflects severity (0 clean, 1 warnings, 2 errors)

---

### 10. Smoke tests

**What:** Vitest suite covering the storage layer and CLI happy paths.

**Coverage targets:**
- Storage: entry round-trip, concurrent writes, branch initialization
- Path matching: a dozen glob patterns
- Schema: round-trip + migration
- CLI: each command against a fixture repo (using `git init` + tmp dirs)
- TTL parsing
- Auto-close detection

**Files:** `*.test.ts` co-located with sources

**Acceptance:**
- ~30+ tests, under 5s total runtime
- CI runs them on every PR

**Out of scope:** End-to-end tests against a real GitHub repo, MCP server
integration tests (manual smoke for v1).

---

### 11. v0.1.0 release prep + docs sweep

**What:** Publish to npm, write changelog, polish README, record a quick
demo gif (or asciinema cast).

**Implementation:**
- `pnpm version 0.1.0` + tag
- GitHub Actions release workflow that publishes on tag push
- README final pass: install, quick start, agent integration, FAQ
- Examples folder: 3 worked examples (the typecast scenario, a coordinate
  entry, a prefer-pattern transition)

**Acceptance:**
- `npm install -g carn` works
- `carn --help` is complete and accurate
- README renders well on github.com/semanticpixel/carn
- One real user (you) has used it on Trellis for at least a week

---

## v2 items — detail

### 12. New entry types: `breadcrumb`, `decision`, `gotcha`

**What:** Three new typed entries for the "permanent context" use case
that v1 deliberately left out.

- `breadcrumb` — *"tried X, didn't work because Y, switched to Z"*
- `decision` — *"we chose X over Y because Z"*
- `gotcha` — *"this looks wrong but is intentional because..."*

**Why:** v1's three types are all transient (TTL-based, in-flight). The
larger prize is replacing scattered context — Slack threads, ADRs nobody
reads, PR descriptions that go stale, comments left in code that decay
into noise — with first-class entries that agents query automatically.
These three types cover the most common *"I wish someone had told me
this earlier"* moments.

**Implementation:**
- Each gets its own Zod schema extending the common entry shape:
  - `breadcrumb`: `attempted`, `failure_reason`, `chosen_alternative`
  - `decision`: `chosen`, `alternatives_considered[]`, `reasoning`,
    `supersedes` (optional ID of an earlier decision this replaces)
  - `gotcha`: `appears_to_be`, `actually_is`, `reason`
- Lifespan: evergreen by default. Manual close only. `decision` is
  append-only-supersede (see item 13) — the new entry references the old
  via `supersedes` and the old one is hidden from default queries.
- Query model unchanged: a `breadcrumb` for `src/auth/` surfaces when an
  agent is editing `src/auth/login.ts`, just like a `forbid-pattern`.

**Files:** `src/types.ts`, `src/cli/add.ts` (new --type values + flag
plumbing), `examples/breadcrumb.md`, `examples/decision.md`

**Acceptance:**
- All three types round-trip through write → read → validate
- A `breadcrumb` registered today still surfaces in queries 90 days
  later (no auto-stale)
- `decision` with `supersedes: <old-id>` hides the predecessor from
  default queries; `--include-superseded` flag re-includes it
- `carn show` on a superseded decision reports the chain ("superseded
  by <new-id>")

**Out of scope:** A separate file format for ADRs — we keep them in the
same store. Multi-author decisions — comments and discussion live in PR
conversations, not in carn.

---

### 13. Lifespan policies

**What:** Formalize per-type lifespan rules so the CLI, doctor, and query
layers handle them consistently across all entry types.

**Why:** v1 had implicit lifespan handling (TTL, close-on-merge). v2
introduces evergreen and append-only-supersede. Without one canonical
location for "given an entry of type X, when is it active?" the rules
will drift across modules.

**Implementation:**
- New module `src/lifespan.ts` exporting:
  ```ts
  type LifespanPolicy = 'ttl' | 'close-on-merge' | 'evergreen' | 'supersede';
  function isActive(entry: Entry, now: Date): boolean;
  function archivePolicy(entry: Entry): LifespanPolicy;
  ```
- A `TYPE_REGISTRY` constant maps each type to its lifespan policy:
  ```ts
  const TYPE_REGISTRY = {
    'forbid-pattern':  { policy: 'ttl' },
    'prefer-pattern':  { policy: 'ttl' },
    'coordinate':      { policy: 'ttl' },
    'breadcrumb':      { policy: 'evergreen' },
    'decision':        { policy: 'supersede' },
    'gotcha':          { policy: 'evergreen' },
  };
  ```
- `carn list` and `carn query` use these to filter active vs. archived
- `carn doctor` skips false-positives on evergreen types

**Files:** `src/lifespan.ts`, `src/lifespan.test.ts`; small refactors in
`src/cli/list.ts`, `src/cli/query.ts`, `src/doctor.ts`.

**Acceptance:**
- Adding a new entry type requires only a `TYPE_REGISTRY` entry; all
  lifespan handling flows automatically
- Tests cover each policy path: TTL expiry, branch-merge close, evergreen
  permanence, supersede chain
- `carn doctor` no longer flags evergreen entries as stale

**Out of scope:** User-customizable lifespan policies (per-repo overrides) —
defer until someone actually asks for it.

---

### 14. Per-entry author + scope

**What:** Add two new fields: `author` (who registered the entry) and
`scope` (one of `personal | team | repo`).

**Why:** As the entry register grows, it needs differentiated views.
A breadcrumb I left for myself last Tuesday shouldn't clutter my
teammate's queries. Conversely, team-scoped decisions should be visible
to everyone on that team but quietly invisible to people not on it. And
some entries (the typecast scenario) really are repo-wide.

**Implementation:**
- `author` auto-populated from `git config user.email` at create time
- `scope` defaults to `repo`; CLI flag `--scope personal | team` to
  override; teams are a free-form string (`--team frontend`)
- **Storage:**
  - `repo` and `team` entries: `.carn/in-flight/<uuid>.json` on the carn
    branch (current behavior)
  - `personal` entries: `.carn/personal/<author-hash>/<uuid>.json` —
    same branch, same file format, but the `personal/` subtree is
    `.gitignored` on the carn branch and *never pushed*
- **Query semantics:**
  - Default: show all `repo` and `team` entries the current user
    qualifies for, plus that user's own `personal` entries
  - `--scope team --team <name>`: filter to a specific team
  - `--include-personal`: include personal entries (default for the
    current user, never available for others — they're literally
    not pushed)

**Files:** `src/types.ts` (new fields + Zod), `src/storage/branch.ts`
(personal directory handling + gitignore management), `src/cli/query.ts`,
`src/cli/list.ts`

**Acceptance:**
- A `--scope personal` entry never leaves the local machine (verified
  by simulating a teammate clone after the entry is added)
- `--scope team --team frontend` entries surface only when querying
  with `--team frontend`
- `repo`-scoped behavior is identical to v1 (no regression)
- `git config user.email` change is reflected on next `carn add`

**Out of scope:** Real authentication / authorization — carn is not a
security tool, teams are labels, not enforcement. Team membership
management — let users name teams freely; convention beats coordination.

---

## v3 items — detail

### 15. Session-handoff entries

**What:** A new entry type `session-handoff` that captures in-flight
personal state at session end so the next session (same human, possibly
different agent or different machine) picks up cleanly.

**Why:** This is the "where did I leave off" problem the project kept
circling during design. Distinct from `coordinate` (which addresses
cross-human coordination) — handoffs are intra-personal, often
agent-to-agent within one developer's workflow.

**Implementation:**
- Type fields:
  - `current_focus` (string)
  - `branch` (string)
  - `files_in_flight[]`
  - `next_step` (string)
  - `open_questions[]`
  - `decisions_this_session[]` (free-form array of short notes)
- Auto-scoped to `personal` — handoffs aren't for teammates
- Lifespan: replaced (most recent handoff per author wins; older ones
  archived but kept in history)
- New convenience commands:
  - `carn handoff "current focus" --files a.ts b.ts --next "wire up MFA"`
    — quick-create a handoff
  - `carn resume` — print the most recent handoff for the current author
    in agent-friendly format (suitable for injecting as a system reminder)
- **Hook integration:** `carn install hooks --resume` adds a `SessionStart`
  hook that auto-runs `carn resume` and surfaces the result, so the next
  session opens with full context without the user typing anything

**Files:** `src/types.ts`, `src/cli/handoff.ts`, `src/cli/resume.ts`,
`src/hooks/session-start.ts`

**Acceptance:**
- End a session with `carn handoff` → start a new session, the agent
  gets the handoff context as a system reminder via the SessionStart hook
- Switching agents (Claude Code → Codex) within a single dev's workflow
  still picks up the handoff
- `carn resume --all` shows the chain of handoffs across sessions, oldest
  to newest
- `carn handoff` with no flags reads stdin so an agent can pipe a
  longer-form summary in

**Out of scope:** Auto-generation of handoffs from session transcripts —
LLM summarization is too brittle for v1; user-authored is more reliable.
Handoff diffing — "what changed since my last session." Could be useful
later but adds complexity.

---

### 16. GitHub Issues backend option

**What:** Optional configuration that mirrors carn entries to/from
GitHub Issues labeled `carn:in-flight` (or configurable). For teams that
already live in GitHub, makes carn entries discoverable through the
GitHub UI.

**Why:** Some teammates won't switch to a CLI as their source of truth,
but they're fine reading GitHub Issues. Mirroring entries means
non-CLI users still see what's in flight, and the GitHub timeline
captures changes for the audit-trail crowd.

**Implementation:**
- Config in `.carn/config.toml`:
  ```toml
  [sync.github]
  enabled = true
  label = "carn:in-flight"
  closed_label = "carn:closed"
  ```
- Use `gh` CLI for API calls — avoids token management; users already
  have it set up
- Bidirectional sync:
  - `carn add` → creates a labeled issue with the entry's content; issue
    body links back to the carn entry ID
  - `carn close` → closes the issue and applies `carn:closed`
  - Closing the issue in GitHub → carn detects on next `doctor` /
    `sync` run and closes the entry
  - Editing the issue body in GitHub → carn pulls changes on sync
- Sync state tracked locally in `.carn/sync-state.json` (last-synced SHA
  per entry); re-syncs are fast no-ops when nothing changed
- Scope filter: only `repo`-scoped entries sync; `personal` and `team`
  stay local

**Files:** `src/sync/github.ts`, `src/sync/state.ts`, `src/cli/sync.ts`

**Acceptance:**
- `carn add` with sync enabled creates a GitHub issue with a link back
  to the entry ID
- Closing the issue in GitHub triggers `carn close` on next sync
- Conflict (someone edited both ends): surface to the user with a diff;
  don't auto-merge
- `carn sync --dry-run` shows what would change without applying

**Out of scope:** GitLab equivalent (separate item — same pattern,
different API). Bidirectional comment sync. GitHub Projects integration.

---

### 17. Codex / Cursor / OpenCode MCP integration docs

**What:** Documentation pages showing how to wire the carn MCP server
into non-Claude tools.

**Why:** MCP is standardized but each tool has its own config file
format and quirks. A dedicated page per tool prevents users from giving
up at the integration step. The protocol works; the docs are what
actually matters for adoption.

**Implementation:**
- One markdown file per tool under `docs/integrations/`:
  - `claude-code.md` (canonical; also linked from README)
  - `codex.md`
  - `cursor.md`
  - `opencode.md`
  - `aider.md` (when it adds MCP)
- Each shows:
  - The exact config snippet to drop in
  - Where the config file lives
  - How to verify the server is reachable
  - Example of an entry surfacing during a real session (with a
    screenshot or asciinema cast)
- Cross-link: README's "Agent integration" section links into each tool's
  page

**Files:** `docs/integrations/*.md`

**Acceptance:**
- A user with no carn experience wires it into their preferred tool in
  under 5 minutes following the docs
- Each tool's example demonstrates a real entry being surfaced in a real
  session, not pseudocode

**Out of scope:** Docs for tools without MCP support — those need
different integration patterns (pre-commit hooks, manual queries).

---

### 18. Multi-repo entries

**What:** Allow an entry to declare it applies to multiple named repos,
not just paths within a single repo. Used when a refactor or constraint
spans several repos in a monorepo-adjacent setup (e.g., a shared library
and its consumers).

**Why:** Today carn entries are repo-local — registered on a specific
repo's carn branch. If you're refactoring `@company/auth-shared` and
want to warn agents working in five consumer repos, you'd register the
same entry in each. That's wrong — the entry has one logical home and
five logical readers.

**Implementation:**
- Optional `repos: string[]` field on entries (alongside `paths`)
- A central registry concept: `carn config set central-registry
  github.com/<org>/carn-central` points carn at a shared repo whose
  carn branch holds cross-repo entries
- `carn query` checks both the local carn branch *and* the central
  registry; results merged with provenance (which registry surfaced it)
- Authoring: `carn add --repos foo,bar,baz` writes to the central
  registry instead of the local one
- Local entries take precedence over central in case of collision (with
  a warning); the human resolves
- "Soft" multi-repo — relies on convention, not infra. The central
  registry is just another carn-branched repo; access control is
  whatever GitHub provides on that repo

**Files:** `src/sync/central.ts`, `src/cli/query.ts` (multi-source
aggregation), `src/cli/config.ts` (new central-registry settings)

**Acceptance:**
- An entry registered in the central registry surfaces in queries from
  any repo whose `repos` field matches
- Local entries override central with a console warning
- `carn list --source local|central|all` filters by registry origin
- A user with no central registry configured sees no v3 behavior changes

**Out of scope:** Auto-discovery of related repos (must be configured
explicitly). Permission systems beyond what GitHub provides on the
central registry repo. Cross-host central registries (one host at a
time for v3).

---

## Speculative

(Design-space exploration. May or may not earn promotion to numbered
items as the tool matures and real pain validates them.)

- **Webhook notifications.** When a constraint matching paths I'm
  working on is added/updated/closed, ping me (Slack, email, system
  tray). Reduces lag between "constraint added" and "I see it." Probably
  redundant if GitHub Issues sync (item 16) is enabled — most users get
  notifications via GitHub for free.

- **Pre-commit hook variant.** For repos that don't use Claude Code or
  any MCP-aware agent, a pre-commit hook that runs `carn query` on the
  staged files and warns if any constraints would be violated. Less
  rich than agent integration (no inline guidance during edit; just a
  pre-commit gate) but reaches more users. Probably belongs as a
  separate skill / hook installer rather than expanding `carn install
  hooks`.

- **Web UI for browsing the carn branch.** A `carn web` command that
  starts a local server with a browsable view of entries. Useful for
  teams who want to see "what's in flight" at a glance without the CLI.
  Risk: creeps into territory better-served by GitHub Issues sync.
  Probably skip unless the CLI list view is genuinely insufficient.

- **Auto-detection of in-flight work from git activity.** Watch git
  push activity in the background; when a substantive branch is pushed,
  prompt the user to optionally register a constraint (or auto-register
  a draft they can refine before publishing). The "I forgot to register"
  mitigation. Lots of UX risk — false-positive prompts are very
  annoying. Don't build until manual registration discipline is proven
  to be the bottleneck.

- **Statistics / analytics.** `carn stats` showing entry-lifetime
  histograms, most-violated constraints, common breadcrumb topics.
  Useful for retros; not load-bearing. Cheap to add later, no rush.

- **Constraint linting in CI.** A CI action that fails the build if a
  PR introduces code matching a `forbid-pattern` constraint's regex
  (when one is provided). Belt-and-suspenders next to the agent hook —
  catches the case where the agent didn't see the constraint or the
  developer wrote the code by hand. Limit: only works for regex-
  expressible constraints; semantic ones (`coordinate`, free-form
  prose) can't be enforced this way.

- **Entry templates.** `carn add --template typecast-removal` for common
  patterns. Each template is a YAML file under `~/.carn/templates/` or
  `.carn/templates/` (per-repo). Trades off discoverability for speed
  on common cases.

- **`carn watch` mode.** A long-running process that re-runs queries as
  the user navigates the codebase, surfacing relevant entries as a
  status-line update. Aimed at terminal-based dev workflows that don't
  use Claude Code. Niche but cool.

- **Cross-tool session-handoff (item 15) over a shared service.** Today
  handoffs are repo-local + personal. If a user wants the same handoff
  available from a different machine without committing to the carn
  branch (because it's `personal`-scoped), they need a side channel.
  Could be a tiny optional sync layer (encrypted blob to a user-chosen
  store: GitHub Gist, S3, local Dropbox folder). High user value,
  moderate implementation cost. Promote to numbered item if multi-machine
  handoff becomes a real ask.

---

## Non-goals (project-level)

These keep the project scope honest and make it obvious when an idea is
out-of-bounds:

- carn is **not a task tracker.** Use Linear / Jira / GitHub Issues for
  "what work is queued." carn entries are *context*, not assignments.
- carn is **not an ADR system.** It can store decisions, but it doesn't
  prescribe ADR format. If you want full ADRs, write them; carn entries
  can link to them.
- carn is **not a security tool.** Authn/authz are conventions, not
  enforced. The carn branch is as protected as any other branch in your
  repo — no more, no less.
- carn is **not a code review tool.** Comments on PRs live on PRs.
  carn entries are about cross-cutting state that doesn't fit into a
  single PR.
- carn is **not opinionated about formatting** of free-form fields.
  Markdown allowed everywhere; nothing mandated. Agents can render or
  ignore as they see fit.

---

## Working with carn while building carn

This project itself is a great early dogfooding target. Once item 1 is in,
items 2+ should each have a `carn` entry registered for their in-flight
period. By item 5 you can start replacing manual coordination with carn
itself.
