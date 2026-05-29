import { painter } from './format.js';

export const COMMANDS = [
  'init',
  'add',
  'list',
  'show',
  'close',
  'query',
  'mcp',
  'install',
  'hook',
  'doctor',
  'help',
] as const;
export type CommandName = (typeof COMMANDS)[number];

export const VERSION = '0.1.0';

const TOP_HELP = (): string => {
  const p = painter();
  return `${p.bold('carn')} v${VERSION} — live, typed, repo-scoped context for AI agents and humans

${p.bold('Usage:')}
  carn <command> [options]

${p.bold('Commands:')}
  ${p.cyan('init')}      Ensure the carn branch exists
  ${p.cyan('add')}       Register a new entry (forbid-pattern | prefer-pattern | coordinate)
  ${p.cyan('list')}      List entries (in-flight by default)
  ${p.cyan('show')}      Show one entry by id (prefix-matched)
  ${p.cyan('close')}     Close an entry
  ${p.cyan('query')}     Find entries whose paths overlap one or more queries (agent read API)
  ${p.cyan('mcp')}       Start the MCP server over stdio (for Claude Code / other MCP clients)
  ${p.cyan('install')}   Install hook config into Claude Code's settings.json
  ${p.cyan('hook')}      Internal: run a Claude Code hook event handler
  ${p.cyan('doctor')}    Surface issues (TTL expired, schema violations, drift) that degrade the register
  ${p.cyan('help')}      Show this message, or help for a single command

${p.bold('Flags:')}
  --help, -h    Show help for a command
  --version, -v Print version
  --json        Machine-readable output (where supported)

${p.bold('Exit codes:')}
  0   success
  1   user error (bad flag, missing entry, etc.)
  2   system error (git failure, filesystem, etc.)

Run \`carn help <command>\` or \`carn <command> --help\` for per-command help.
`;
};

export function topLevelHelp(): string {
  return TOP_HELP();
}

/**
 * Levenshtein for the "did you mean" hint on an unknown command. Tiny by
 * design — alphabet is ~7 entries, lengths are short.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

export function suggestCommand(input: string): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const c of COMMANDS) {
    const dist = levenshtein(input, c);
    if (!best || dist < best.dist) best = { name: c, dist };
  }
  if (!best) return null;
  // Only suggest when the typo is "close" — avoids confident wrong suggestions
  // like `carn xyz` → `did you mean init?`
  return best.dist <= 2 ? best.name : null;
}
