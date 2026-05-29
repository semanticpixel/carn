import { EntryRefError, resolveEntry as resolveEntryFromLib } from '../lib/index.js';
import type { Entry } from '../types.js';
import { CliError, resolveRepoRoot } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';

export const SHOW_HELP = `
carn show — show a single carn entry

Usage:
  carn show <id> [--json]

<id> may be a prefix — \`carn show ab12\` resolves uniquely if exactly
one entry starts with that prefix. Ambiguous prefixes exit 1 with the
list of matches.
`.trimStart();

export async function runShow(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(SHOW_HELP);
    return 0;
  }
  const idArg = parsed.positionals[0];
  if (!idArg) throw new CliError('missing <id>. Run `carn list` to see entries.');

  const repoRoot = await resolveRepoRoot();
  const entry = await resolveEntry(repoRoot, idArg);

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ entry }));
    return 0;
  }
  renderEntry(entry);
  return 0;
}

export async function resolveEntry(repoRoot: string, idOrPrefix: string): Promise<Entry> {
  // CLI wrapper around lib's resolveEntry — maps EntryRefError to CliError
  // so the user gets the same "no entry with id ..." UX as before.
  try {
    return await resolveEntryFromLib(repoRoot, idOrPrefix);
  } catch (err) {
    if (err instanceof EntryRefError) {
      if (err.kind === 'not-found') throw new CliError(err.message);
      const sample = err.matches.slice(0, 5).map((id) => `  - ${id}`).join('\n');
      throw new CliError(`${err.message}\n${sample}`);
    }
    throw err;
  }
}

function renderEntry(entry: Entry): void {
  const p = painter();
  process.stdout.write(`${p.bold(entry.id)} ${p.dim(entry.type)}\n`);
  process.stdout.write(`${entry.description}\n`);
  if (entry.type === 'forbid-pattern' || entry.type === 'prefer-pattern') {
    process.stdout.write(`${p.dim('constraint:')} ${entry.constraint}\n`);
    if (entry.type === 'prefer-pattern' && entry.instead_of) {
      process.stdout.write(`${p.dim('instead of:')} ${entry.instead_of}\n`);
    }
  } else if (entry.type === 'coordinate') {
    process.stdout.write(`${p.dim('reason:')} ${entry.reason}\n`);
    if (entry.pause_token) {
      process.stdout.write(`${p.dim('pause-token:')} ${entry.pause_token}\n`);
    }
  }
  process.stdout.write(`${p.dim('paths:')} ${entry.paths.join(', ')}\n`);
  process.stdout.write(`${p.dim('author:')} ${entry.author}\n`);
  process.stdout.write(`${p.dim('created:')} ${entry.created_at}\n`);
  process.stdout.write(`${p.dim('updated:')} ${entry.updated_at}\n`);
  if (entry.ttl) process.stdout.write(`${p.dim('ttl:')} ${entry.ttl}\n`);
  if (entry.closed_at) process.stdout.write(`${p.dim('closed:')} ${entry.closed_at}\n`);
}
