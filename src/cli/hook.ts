import { runUserPromptSubmitHook } from '../hooks/user-prompt-submit.js';
import { CliError } from './context.js';

export const HOOK_HELP = `
carn hook — internal hook event handlers (called by Claude Code)

Usage:
  carn hook user-prompt-submit

Subcommands:
  user-prompt-submit   Read a Claude Code UserPromptSubmit envelope from
                       stdin, infer relevant paths, and print a
                       <system-reminder> block when active carn entries
                       apply. Always exits 0 — never blocks a prompt.

You don't normally run these directly. \`carn install hooks\` wires the
handler into Claude Code's settings.json.
`.trimStart();

export async function runHook(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HOOK_HELP);
    return 0;
  }
  const sub = argv[0]!;
  if (sub === 'user-prompt-submit') {
    return await runUserPromptSubmitHook();
  }
  throw new CliError(`unknown hook event '${sub}'. Try 'carn hook --help'.`);
}
