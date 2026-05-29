import { runDoctor, type DoctorCheck, type DoctorReport } from '../doctor.js';
import { resolveIdentity, resolveRepoRoot } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';

export const DOCTOR_HELP = `
carn doctor — surface issues that would silently degrade the register

Usage:
  carn doctor [--fix] [--stale-after-days <n>] [--json]

What it checks:
  - TTL expired (warn)
  - No updates in 30+ days (warn; configurable)
  - Mergeable entries — merged_sha is ancestor of base (info, auto-fixable)
  - Schema violation on disk entry (error)
  - Branch drift — local carn behind origin (error, auto-fixable)
  - Orphaned worktrees on the carn branch (warn, auto-fixable)
  - Index mismatch — .carn/index.jsonl vs JSON files (warn, auto-fixable)

Flags:
  --fix                       Apply the auto-fixable subset (default: read-only).
  --stale-after-days <n>      Override the 30-day "no updates" threshold.
  --json                      Machine-readable report.

Exit codes:
  0   no issues
  1   warnings only
  2   one or more errors

\`--json\` output shape (stable contract):
  {
    "ok": boolean,
    "exit_tier": "ok" | "warn" | "error",
    "checks": [
      {
        "severity": "info" | "warn" | "error",
        "code": string,            // stable identifier, e.g. "ttl-expired"
        "message": string,
        "entry_id"?: string,
        "fixable": boolean,
        "fixed"?: boolean          // present and true when --fix applied a remedy
      }
    ]
  }
`.trimStart();

const SEVERITY_ORDER: Record<DoctorCheck['severity'], number> = {
  error: 0,
  warn: 1,
  info: 2,
};

export async function runDoctorCli(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--fix': { kind: 'boolean' },
      '--stale-after-days': { kind: 'string' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(DOCTOR_HELP);
    return 0;
  }

  const staleRaw = parsed.flags['--stale-after-days'];
  let staleAfterDays: number | undefined;
  if (typeof staleRaw === 'string') {
    const n = Number.parseInt(staleRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      process.stderr.write(
        `error: --stale-after-days must be a positive integer (got '${staleRaw}')\n`,
      );
      return 1;
    }
    staleAfterDays = n;
  }

  const repoRoot = await resolveRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const report = await runDoctor(repoRoot, {
    fix: Boolean(parsed.flags['--fix']),
    staleAfterDays,
    identity,
  });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson(report));
  } else {
    process.stdout.write(formatReport(report));
  }

  return exitCodeFor(report);
}

export function exitCodeFor(report: DoctorReport): number {
  switch (report.exit_tier) {
    case 'error':
      return 2;
    case 'warn':
      return 1;
    case 'ok':
    default:
      return 0;
  }
}

function formatReport(report: DoctorReport): string {
  const p = painter();
  if (report.ok) {
    return `${p.green('✓')} no issues found\n`;
  }
  const lines: string[] = [];
  const sorted = [...report.checks].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  for (const c of sorted) {
    const tag =
      c.severity === 'error'
        ? p.red('error')
        : c.severity === 'warn'
          ? p.yellow('warn ')
          : p.cyan('info ');
    const fixedTag = c.fixed ? ` ${p.green('[fixed]')}` : c.fixable && !c.fixed ? ` ${p.dim('[fixable]')}` : '';
    lines.push(`${tag}  ${c.code}${fixedTag}  ${c.message}`);
  }
  const counts = report.checks.reduce(
    (acc, c) => {
      acc[c.severity] = (acc[c.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const summary = [
    counts.error ? `${counts.error} error${counts.error === 1 ? '' : 's'}` : null,
    counts.warn ? `${counts.warn} warning${counts.warn === 1 ? '' : 's'}` : null,
    counts.info ? `${counts.info} info` : null,
  ]
    .filter(Boolean)
    .join(', ');
  lines.push('');
  lines.push(p.dim(summary));
  return `${lines.join('\n')}\n`;
}
