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
  let repoRoot: string;
  let identity: Awaited<ReturnType<typeof resolveIdentity>>;
  try {
    repoRoot = await resolveRepoRoot();
    identity = await resolveIdentity(repoRoot);
  } catch (err) {
    // Resolution happens before transport connect, so without this guard
    // Claude Code (and other MCP clients) see an opaque "MCP server failed
    // to start" with no context. Writing the cause + the prereq to stderr
    // surfaces it in the client's MCP log. The `throw` preserves the
    // non-zero exit and the existing error type for callers.
    process.stderr.write(
      `carn mcp: startup failed — ${err instanceof Error ? err.message : String(err)}\n` +
        `carn mcp expects a git repo at the working directory with user.email configured.\n`,
    );
    throw err;
  }

  const server = new McpServer({
    name: 'carn',
    version: VERSION,
  });

  registerCarnTools(server, { repoRoot, identity });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
