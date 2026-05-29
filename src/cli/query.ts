import { queryEntries } from '../lib/index.js';
import type { EntryType } from '../types.js';
import { CliError, resolveRepoRoot } from './context.js';
import { TABLE_HEADER, formatEntryRow, formatJson, painter, renderTable } from './format.js';
import { parseArgs } from './parse-args.js';

export const QUERY_HELP = `
carn query — read API for agents

Usage:
  carn query --paths <pattern>... [--type <t>] [--exclude-expired] [--json]

Returns in-flight entries whose paths overlap any of the given query
paths. The agent-facing read API — ST-7's MCP server proxies this.

Examples:
  carn query --paths src/auth/login.ts
  carn query --paths "src/**" --type forbid-pattern --json
  carn query --paths "src/**" --exclude-expired
`.trimStart();

export async function runQuery(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--paths': { kind: 'array' },
      '--type': { kind: 'string' },
      '--exclude-expired': { kind: 'boolean' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(QUERY_HELP);
    return 0;
  }

  const paths = (parsed.flags['--paths'] as string[] | undefined) ?? [];
  if (paths.length === 0) {
    throw new CliError('missing --paths. Pass at least one path or glob.');
  }

  const repoRoot = await resolveRepoRoot();
  const typeFlag = parsed.flags['--type'];
  const entries = await queryEntries(repoRoot, {
    paths,
    type: typeof typeFlag === 'string' ? (typeFlag as EntryType) : undefined,
    excludeExpired: Boolean(parsed.flags['--exclude-expired']),
  });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ entries }));
    return 0;
  }
  if (entries.length === 0) {
    const p = painter();
    process.stdout.write(`${p.dim('no matching entries')}\n`);
    return 0;
  }
  const p = painter();
  const header = TABLE_HEADER.map((h) => p.bold(h));
  const rows = entries.map((e) => formatEntryRow(e, { paint: p }));
  process.stdout.write(renderTable(header, rows));
  return 0;
}
