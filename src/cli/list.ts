import { listEntriesFiltered } from '../lib/index.js';
import type { Entry, EntryType } from '../types.js';
import { CliError, resolveRepoRoot } from './context.js';
import { TABLE_HEADER, formatEntryRow, formatJson, painter, renderTable } from './format.js';
import { parseArgs } from './parse-args.js';

export const LIST_HELP = `
carn list — list carn entries

Usage:
  carn list [--type <t>] [--author <email>] [--closed | --all]
            [--exclude-expired] [--json]

Defaults to in-flight (open) entries. Use --closed for the closed/ folder
or --all for both. Columns: ID  TYPE  DESCRIPTION  TTL  AUTHOR  AGE.
TTL column renders the remaining time (e.g. \`6d\`, \`4h\`) for entries
with a TTL; \`EXPIRED\` for past-TTL in-flight entries.
`.trimStart();

export async function runList(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--type': { kind: 'string' },
      '--author': { kind: 'string' },
      '--closed': { kind: 'boolean' },
      '--all': { kind: 'boolean' },
      '--exclude-expired': { kind: 'boolean' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(LIST_HELP);
    return 0;
  }
  if (parsed.flags['--closed'] && parsed.flags['--all']) {
    throw new CliError('--closed and --all are mutually exclusive.');
  }
  const status: 'in-flight' | 'closed' | 'all' = parsed.flags['--all']
    ? 'all'
    : parsed.flags['--closed']
      ? 'closed'
      : 'in-flight';

  const repoRoot = await resolveRepoRoot();
  const typeFlag = parsed.flags['--type'];
  const authorFlag = parsed.flags['--author'];
  const entries = await listEntriesFiltered(repoRoot, {
    status,
    type: typeof typeFlag === 'string' ? (typeFlag as EntryType) : undefined,
    author: typeof authorFlag === 'string' ? authorFlag : undefined,
    excludeExpired: Boolean(parsed.flags['--exclude-expired']),
  });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ entries }));
    return 0;
  }
  renderEntriesTable(entries);
  return 0;
}

function renderEntriesTable(entries: readonly Entry[]): void {
  if (entries.length === 0) {
    const p = painter();
    process.stdout.write(`${p.dim('no entries')}\n`);
    return;
  }
  const p = painter();
  const header = TABLE_HEADER.map((h) => p.bold(h));
  const rows = entries.map((e) => formatEntryRow(e, { paint: p }));
  process.stdout.write(renderTable(header, rows));
}
