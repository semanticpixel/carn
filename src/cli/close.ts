import { closeEntryById } from '../lib/index.js';
import { autoCloseMergedEntries } from '../auto-close.js';
import { CliError, resolveIdentity, resolveRepoRoot } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';

export const CLOSE_HELP = `
carn close — close a carn entry

Usage:
  carn close <id> [--merged-sha <sha>] [--json]
  carn close --auto-merged [--json]

Moves the entry from in-flight/ to closed/. Idempotent — closing an
already-closed entry is a no-op. \`--merged-sha\` stamps the SHA into
\`metadata.merged_sha\` atomically with the close. \`--auto-merged\`
scans all in-flight entries and closes those whose \`metadata.merged_sha\`
is now an ancestor of \`origin/<default-branch>\`.
`.trimStart();

export async function runClose(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--merged-sha': { kind: 'string' },
      '--auto-merged': { kind: 'boolean' },
      '--base-ref': { kind: 'string' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(CLOSE_HELP);
    return 0;
  }

  if (parsed.flags['--auto-merged']) {
    return await runAutoMerged(parsed.flags);
  }

  const idArg = parsed.positionals[0];
  if (!idArg) {
    throw new CliError(
      'missing <id>. Run `carn list` to see entries, or `carn close --auto-merged` to scan.',
    );
  }

  const repoRoot = await resolveRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const mergedSha = parsed.flags['--merged-sha'];
  const closed = await closeEntryById(repoRoot, idArg, {
    identity,
    mergedSha: typeof mergedSha === 'string' ? mergedSha : undefined,
  });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ entry: closed }));
  } else {
    const p = painter();
    process.stdout.write(`${p.green('✓')} closed ${p.cyan(closed.id)}\n`);
  }
  return 0;
}

async function runAutoMerged(
  flags: Record<string, string | boolean | string[] | undefined>,
): Promise<number> {
  const repoRoot = await resolveRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const baseRef = flags['--base-ref'];
  const result = await autoCloseMergedEntries(repoRoot, {
    identity,
    baseRef: typeof baseRef === 'string' ? baseRef : undefined,
  });

  if (flags['--json']) {
    process.stdout.write(
      formatJson({
        closed: result.closed,
        pending: result.pending,
        base_ref: result.baseRef,
      }),
    );
    return 0;
  }
  const p = painter();
  process.stdout.write(
    `${p.dim(`base: ${result.baseRef}`)}\n`,
  );
  if (result.closed.length === 0) {
    process.stdout.write(`${p.dim('no entries to auto-close.')}\n`);
  } else {
    for (const e of result.closed) {
      process.stdout.write(`${p.green('✓')} closed ${p.cyan(e.id)} ${p.dim(e.type)}\n`);
    }
  }
  if (result.pending.length > 0) {
    process.stdout.write(
      `${p.dim(`${result.pending.length} entr${result.pending.length === 1 ? 'y' : 'ies'} with merged_sha not yet on ${result.baseRef}.`)}\n`,
    );
  }
  return 0;
}
