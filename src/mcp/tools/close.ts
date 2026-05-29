import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarnToolContext } from './index.js';
import { closeEntryById } from '../../lib/index.js';
import { jsonToolResult } from './_shared.js';

export function registerCloseTool(server: McpServer, ctx: CarnToolContext): void {
  server.registerTool(
    'carn_close',
    {
      description:
        'Close a carn entry. Call this when the constraint/preference/coordinate it described is no longer relevant — the refactor landed, the merge happened, the team decision was made. Pass `merged_sha` when closing because a specific commit landed; ST-6\'s auto-close uses it. Idempotent — closing an already-closed entry is a no-op.',
      inputSchema: {
        id: z.string().min(1),
        merged_sha: z.string().min(1).optional(),
      },
    },
    async (input) =>
      jsonToolResult(async () => {
        const entry = await closeEntryById(ctx.repoRoot, input.id, {
          identity: ctx.identity,
          mergedSha: input.merged_sha,
        });
        return { entry };
      }),
  );
}
