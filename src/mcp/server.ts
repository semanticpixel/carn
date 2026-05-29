import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerCarnTools } from './tools/index.js';
import { resolveRepoRoot, resolveIdentity } from '../cli/context.js';

const VERSION = '0.1.0';

/**
 * Start the carn MCP server over stdio. The repo root and git identity
 * are resolved once at startup from the process cwd — same path the CLI
 * uses, so misconfigured envs surface as the same readable error before
 * any JSON-RPC traffic begins.
 */
export async function startMcpServer(): Promise<void> {
  const repoRoot = await resolveRepoRoot();
  const identity = await resolveIdentity(repoRoot);

  const server = new McpServer({
    name: 'carn',
    version: VERSION,
  });

  registerCarnTools(server, { repoRoot, identity });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
