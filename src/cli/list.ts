import { listEntries } from '../storage/entry.js';
import type { Entry } from '../types.js';
import { CliError, resolveRepoRoot } from './context.js';
import { TABLE_HEADER, formatEntryRow, formatJson, painter, renderTable } from './format.js';
import { parseArgs } from './parse-args.js';

export const LIST_HELP = `
carn list — list carn entries

Usage:
  carn list [--type <t>] [--author <email>] [--closed | --all] [--json]

Defaults to in-flight (open) entries. Use --closed for the closed/ folder
or --all for both. Columns: ID  TYPE  DESCRIPTION  TTL  AUTHOR  AGE.
`.trimStart();

export async function runList(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--type': { kind: 'string' },
      '--author': { kind: 'string' },
      '--closed': { kind: 'boolean' },
      '--all': { kind: 'boolean' },
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
  let entries = await listEntries(repoRoot, { status });

  const typeFlag = parsed.flags['--type'];
  if (typeof typeFlag === 'string') {
    entries = entries.filter((e) => e.type === typeFlag);
  }
  const authorFlag = parsed.flags['--author'];
  if (typeof authorFlag === 'string') {
    entries = entries.filter((e) => e.author === authorFlag);
  }

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
  const rows = entries.map(formatEntryRow);
  process.stdout.write(renderTable(header, rows));
}
