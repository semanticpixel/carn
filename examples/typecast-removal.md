# Typecast removal — the README hero scenario

You're tightening typing across the codebase: removing `as Foo` casts in
favour of `satisfies` or explicit types. The work is in flight; your
teammate's agent doesn't know that and is about to add three new casts.

`carn` is the place to leave a signal.

## Register the constraint

```bash
$ cd your-repo
$ carn init                          # one-time per repo

$ carn add "Removing typecasts; tightening ESLint" \
    --type forbid-pattern \
    --constraint "Don't introduce new \`as Foo\` casts; use satisfies or explicit types" \
    --paths "src/**/*.ts" \
    --ttl 7d

✓ added na6ppiup forbid-pattern
```

The entry lives on the orphan `carn` branch — auto-pushed to origin by
`carn add`. (No remote? You see a one-time warning; entries stay local
until you add one.)

## What the agent sees

Their next prompt hits the Claude Code `UserPromptSubmit` hook (assuming
they ran `carn install hooks` once):

```text
<system-reminder>
1 active carn entry applies to this context:

- `na6ppiup` (forbid-pattern) [ttl: 6d] Removing typecasts; tightening ESLint
  constraint: Don't introduce new `as Foo` casts; use satisfies or explicit types
  paths: src/**/*.ts
  author: luis@team.example

Dismiss any of these with `carn close <id>` once the constraint/coordinate is no longer relevant.
</system-reminder>
```

The agent now knows the constraint *before* writing code.

## When the work merges

After your PR lands on `main` with merge SHA `1a2b3c4`:

```bash
$ carn close na6ppiup --merged-sha 1a2b3c4
✓ closed na6ppiup
```

Or, equivalently, on a schedule:

```bash
$ carn close --auto-merged
✓ closed na6ppiup (merged_sha 1a2b3c4 is now ancestor of origin/main)
```

`closed/` entries stay in the branch's history forever — searchable, not
noisy.

## Verifying with doctor

If a teammate later wonders whether the constraint is still active:

```bash
$ carn doctor --json | jq '.checks[] | select(.code == "ttl-expired")'
```

…surfaces entries whose TTL has elapsed without a close. Pair with
`carn list --exclude-expired` for quick triage.
