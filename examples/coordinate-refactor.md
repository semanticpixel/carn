# Coordinating a refactor — the auth-team scenario

The auth team is in the middle of moving session storage from cookies to
Redis. The change touches `src/auth/**` and a handful of API handlers.
Other teams' agents shouldn't be editing those paths until the migration
lands — the conflict surface would be brutal.

`carn` is the place to broadcast *"pause and check"* before they do.

## Register the coordinate

```bash
$ carn add "Migrating session storage from cookies to Redis" \
    --type coordinate \
    --paths "src/auth/**" \
    --paths "src/api/login.ts" \
    --paths "src/api/logout.ts" \
    --reason "Active refactor; please leave a PR comment before parallel edits — luis@auth-team" \
    --ttl 5d

✓ added pq2r8stv coordinate
```

`coordinate` is distinct from `forbid-pattern` — it doesn't say
"never touch this," it says "ping me first." The `--reason` is the
escape hatch: how a teammate (or their agent) gets unblocked.

## What another team's agent sees

When their prompt mentions any of the listed paths:

```text
<system-reminder>
1 active carn entry applies to this context:

- `pq2r8stv` (coordinate) [ttl: 4d] Migrating session storage from cookies to Redis
  reason: Active refactor; please leave a PR comment before parallel edits — luis@auth-team
  paths: src/auth/**, src/api/login.ts, src/api/logout.ts
  author: luis@auth-team.example

Dismiss any of these with `carn close <id>` once the constraint/coordinate is no longer relevant.
</system-reminder>
```

The agent now has both the constraint *and* the unblock path. Compare
that to discovering the conflict at merge time.

## Closing on merge

The migration PR is `feat/redis-sessions`. When it merges:

```bash
$ carn close pq2r8stv --merged-sha <merge-sha>
✓ closed pq2r8stv
```

Or, if you forget:

```bash
$ carn close --auto-merged   # scans for in-flight entries whose
                             # metadata.merged_sha is ancestor of main
```

## Why `coordinate` and not a slack message?

A Slack thread reaches whoever's watching the channel right now. A
`carn` entry reaches the next agent who *touches the path*, regardless
of which human is at the keyboard or which time zone they're in. The
two complement each other — keep the Slack thread for nuance; let
`carn` handle the mechanical "pause and read."
