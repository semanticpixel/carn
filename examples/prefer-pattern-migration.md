# Migrating off a deprecated helper — the `prefer-pattern` scenario

Six months ago you wrote `getUser(id)` to fetch a user record. Last
quarter you replaced it with `userRepo.findById(id)` — the new path
hooks the cache, emits the right metrics, and handles tenant scoping.
Most call sites have migrated; a long tail of stragglers remains.

You don't want to *block* `getUser` (that's `forbid-pattern`'s job) —
you want to *suggest the replacement* every time an agent encounters
the old call. That's `prefer-pattern`.

## Register the preference

```bash
$ carn add "Use userRepo.findById instead of getUser — caches + metrics" \
    --type prefer-pattern \
    --constraint "userRepo.findById(id) handles cache + tenant scoping + metrics" \
    --instead-of "getUser(id)" \
    --paths "src/**/*.ts" \
    --ttl 60d

✓ added k4mn7pr8 prefer-pattern
```

The `--instead-of` field gives the agent a concrete before/after pair.
The constraint is the *why* — the new API does more than the old one,
not just rename.

## What the agent sees

```text
<system-reminder>
carn entries for paths the prompt references:

  k4mn7pr8  prefer-pattern  Use userRepo.findById instead of getUser —
            caches + metrics
            Author: luis@team.example  TTL: 59d remaining
            Paths: src/**/*.ts
            Instead of: getUser(id)
</system-reminder>
```

The agent now suggests `userRepo.findById` when it would otherwise have
reached for `getUser`. The user-facing diff stays small, but the call
site graph slowly heals.

## Letting it expire

Unlike `forbid-pattern`, you typically don't close `prefer-pattern`
entries on merge — the migration is gradual, not a single PR. The 60-day
TTL is the forcing function: it expires when the codebase has had
two months to drift toward the new API. After that, either:

- Most call sites have migrated → close and forget.
- Some stragglers remain → graduate to a `forbid-pattern` against the
  old API and run one final sweep PR.

`carn doctor` flags both states:

```bash
$ carn doctor
warn  ttl-expired  [fixable]  k4mn7pr8 (prefer-pattern): ttl 60d expired
```

…and the call is yours.
