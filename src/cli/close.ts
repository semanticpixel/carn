import { closeEntry, updateEntry } from '../storage/entry.js';
import { CliError, resolveIdentity, resolveRepoRoot } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';
import { resolveEntry } from './show.js';

export const CLOSE_HELP = `
carn close — close a carn entry

Usage:
  carn close <id> [--merged-sha <sha>] [--json]

Moves the entry from in-flight/ to closed/. Idempotent — closing an
already-closed entry is a no-op. \`--merged-sha\` stamps the SHA into
\`metadata.merged_sha\` before close, for ST-6's auto-close-on-merge.
`.trimStart();

export async function runClose(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--merged-sha': { kind: 'string' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(CLOSE_HELP);
    return 0;
  }

  const idArg = parsed.positionals[0];
  if (!idArg) throw new CliError('missing <id>. Run `carn list` to see entries.');

  const repoRoot = await resolveRepoRoot();
  const identity = await resolveIdentity(repoRoot);
  const target = await resolveEntry(repoRoot, idArg);

  const mergedSha = parsed.flags['--merged-sha'];
  if (typeof mergedSha === 'string' && mergedSha.length > 0 && target.closed_at === null) {
    await updateEntry(
      repoRoot,
      target.id,
      { metadata: { ...target.metadata, merged_sha: mergedSha } },
      { identity },
    );
  }
  const closed = await closeEntry(repoRoot, target.id, { identity });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ entry: closed }));
  } else {
    const p = painter();
    process.stdout.write(`${p.green('✓')} closed ${p.cyan(closed.id)}\n`);
  }
  return 0;
}
