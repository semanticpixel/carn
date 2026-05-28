import { ensureBranch } from '../storage/branch.js';
import { resolveRepoRoot } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';

export const INIT_HELP = `
carn init — ensure the carn branch exists for this repo

Usage:
  carn init [--json]

Creates an orphan \`carn\` branch in the local repo if missing. Idempotent.
If \`origin/carn\` exists, fetches it instead of starting fresh.
`.trimStart();

export async function runInit(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(INIT_HELP);
    return 0;
  }
  const repoRoot = await resolveRepoRoot();
  const sha = await ensureBranch(repoRoot);
  if (parsed.flags['--json']) {
    process.stdout.write(formatJson({ branch: 'carn', sha }));
  } else {
    const p = painter();
    process.stdout.write(
      `${p.green('✓')} carn branch ready at ${p.dim(sha.slice(0, 12))}\n`,
    );
  }
  return 0;
}
