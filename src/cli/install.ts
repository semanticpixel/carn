import { installHook } from '../hooks/install.js';
import { CliError } from './context.js';
import { formatJson, painter } from './format.js';
import { parseArgs } from './parse-args.js';

export const INSTALL_HELP = `
carn install — wire carn into editor / agent tooling

Usage:
  carn install hooks [--user] [--force] [--json]

Subcommands:
  hooks    Install Claude Code's UserPromptSubmit hook so any agent
           in this repo automatically receives matching carn entries
           as <system-reminder> blocks before answering a prompt.

Flags (for \`install hooks\`):
  --user   Write to ~/.claude/settings.json instead of the project file.
  --force  Replace an existing carn hook entry. Default: skip and warn.
  --json   Machine-readable result.
`.trimStart();

export async function runInstall(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(INSTALL_HELP);
    return 0;
  }
  const sub = argv[0]!;
  const rest = argv.slice(1);
  if (sub === 'hooks') return await runInstallHooks(rest);
  throw new CliError(`unknown subcommand 'install ${sub}'. Try 'carn install --help'.`);
}

async function runInstallHooks(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--user': { kind: 'boolean' },
      '--force': { kind: 'boolean' },
      '--json': { kind: 'boolean' },
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(INSTALL_HELP);
    return 0;
  }

  const result = await installHook({
    target: parsed.flags['--user'] ? 'user' : 'project',
    force: Boolean(parsed.flags['--force']),
  });

  if (parsed.flags['--json']) {
    process.stdout.write(formatJson(result));
    return 0;
  }
  const p = painter();
  if (result.skipped) {
    process.stdout.write(
      `${p.yellow('!')} carn hook already present at ${result.path} — pass --force to replace.\n`,
    );
    return 0;
  }
  const verb = result.created ? 'wrote' : 'updated';
  process.stdout.write(`${p.green('✓')} ${verb} ${result.path}\n`);
  return 0;
}
