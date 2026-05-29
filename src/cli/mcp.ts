import { startMcpServer } from '../mcp/server.js';
import { parseArgs } from './parse-args.js';

export const MCP_HELP = `
carn mcp — start the carn MCP server over stdio

Usage:
  carn mcp

The server resolves the repo and git identity from \`process.cwd()\`
on startup, then speaks JSON-RPC on stdin/stdout. Configure your MCP
client (Claude Code's \`.mcp.json\` / \`~/.claude.json\`) to launch
\`carn mcp\` with the working directory set to the repo you want to
expose. Exposes six tools: carn_register, carn_query, carn_list,
carn_show, carn_close, carn_update.
`.trimStart();

export async function runMcp(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    flags: {
      '--help': { kind: 'boolean', aliases: ['-h'] },
    },
  });
  if (parsed.flags['--help']) {
    process.stdout.write(MCP_HELP);
    return 0;
  }
  await startMcpServer();
  // startMcpServer's `connect()` returns once the transport is wired and
  // listening; the SDK keeps the event loop alive until the client closes
  // stdin or sends shutdown. Return 0 so the bin entry doesn't exit early.
  await new Promise<void>((resolve) => {
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
  return 0;
}
