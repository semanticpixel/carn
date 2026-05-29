import { registerEntry } from '../lib/index.js';
import type { EntryDraft } from '../types.js';
import { TtlParseError, assertValidTtl } from '../ttl.js';
import { CliError, resolveIdentity, resolveRepoRoot } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';

export const ADD_HELP = `
carn add — register a new carn entry

Usage:
  carn add [<description>] --type <forbid-pattern|prefer-pattern|coordinate>
           [--paths <pattern>]... [--ttl <duration>] [--json]
           [forbid-pattern | prefer-pattern]
             --constraint <text>   (required)
             --instead-of <text>   (prefer-pattern only)
           [coordinate]
             --reason <text>       (required)
             --pause-token <text>  (optional)

If <description> is omitted, reads it from stdin. Useful for piping a
multi-line note from an agent run.

Examples:
  carn add "no new typecasts here" --type forbid-pattern \\
    --constraint "no new \`as Foo\`" --paths "src/**/*.ts"

  echo "mid-refactor on auth" | carn add --type coordinate \\
    --reason "pause if you're touching auth" --paths "src/auth/**"
`.trimStart();

const ENTRY_TYPES = ['forbid-pattern', 'prefer-pattern', 'coordinate'] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

function isEntryType(s: string): s is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(s);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function runAdd(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--type': { kind: 'string' },
      '--paths': { kind: 'array' },
      '--ttl': { kind: 'string' },
      '--constraint': { kind: 'string' },
      '--instead-of': { kind: 'string' },
      '--reason': { kind: 'string' },
      '--pause-token': { kind: 'string' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(ADD_HELP);
    return 0;
  }

  const type = parsed.flags['--type'];
  if (typeof type !== 'string') {
    throw new CliError('missing --type. Pick one of: forbid-pattern, prefer-pattern, coordinate.');
  }
  if (!isEntryType(type)) {
    throw new CliError(
      `unknown --type "${type}". Pick one of: forbid-pattern, prefer-pattern, coordinate.`,
    );
  }

  let description = parsed.positionals.join(' ').trim();
  if (description.length === 0) {
    description = await readStdin();
  }
  if (description.length === 0) {
    throw new CliError('missing <description>. Pass it as an argument or pipe it via stdin.');
  }

  const paths = (parsed.flags['--paths'] as string[] | undefined) ?? [];
  const ttl = parsed.flags['--ttl'];
  if (ttl !== undefined && typeof ttl !== 'string') {
    throw new CliError('--ttl must be a string like "7d" or "24h".');
  }
  // Validate at the CLI boundary so a typo'd `--ttl 7days` exits 1 with a
  // pointed message instead of persisting and tripping ST-6's TTL scanner.
  if (typeof ttl === 'string') {
    try {
      assertValidTtl(ttl);
    } catch (err) {
      if (err instanceof TtlParseError) throw new CliError(err.message);
      throw err;
    }
  }

  const draft = buildDraft(type, description, paths, ttl as string | undefined, parsed.flags);
  const repoRoot = await resolveRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const entry = await registerEntry(repoRoot, draft, { identity });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ entry }));
  } else {
    const p = painter();
    process.stdout.write(
      `${p.green('✓')} added ${p.cyan(entry.id)} ${p.dim(entry.type)}\n`,
    );
  }
  return 0;
}

function buildDraft(
  type: EntryType,
  description: string,
  paths: string[],
  ttl: string | undefined,
  flags: Record<string, string | boolean | string[] | undefined>,
): EntryDraft {
  const base = {
    description,
    paths: paths.length > 0 ? paths : undefined,
    ttl: ttl ?? undefined,
  };
  if (type === 'forbid-pattern' || type === 'prefer-pattern') {
    const constraint = flags['--constraint'];
    if (typeof constraint !== 'string' || constraint.length === 0) {
      throw new CliError(`--constraint is required for ${type}.`);
    }
    if (type === 'prefer-pattern') {
      const insteadOf = flags['--instead-of'];
      return {
        type,
        ...base,
        constraint,
        ...(typeof insteadOf === 'string' ? { instead_of: insteadOf } : {}),
      };
    }
    return { type, ...base, constraint };
  }
  // coordinate
  const reason = flags['--reason'];
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new CliError('--reason is required for coordinate entries.');
  }
  const pauseToken = flags['--pause-token'];
  return {
    type: 'coordinate',
    ...base,
    reason,
    ...(typeof pauseToken === 'string' ? { pause_token: pauseToken } : {}),
  };
}
