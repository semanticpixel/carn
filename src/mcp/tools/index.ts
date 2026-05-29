import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GitIdentity } from '../../storage/worktree.js';
import { registerRegisterTool } from './register.js';
import { registerQueryTool } from './query.js';
import { registerListTool } from './list.js';
import { registerShowTool } from './show.js';
import { registerCloseTool } from './close.js';
import { registerUpdateTool } from './update.js';

export interface CarnToolContext {
  repoRoot: string;
  identity: GitIdentity;
}

export function registerCarnTools(server: McpServer, ctx: CarnToolContext): void {
  registerRegisterTool(server, ctx);
  registerQueryTool(server, ctx);
  registerListTool(server, ctx);
  registerShowTool(server, ctx);
  registerCloseTool(server, ctx);
  registerUpdateTool(server, ctx);
}
