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
        id: z
          .string()
          .min(1)
          .describe(
            'The entry id — full 8 chars or a unique prefix. Ambiguous prefixes error out.',
          ),
        merged_sha: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional. Stamps `metadata.merged_sha` atomically with the close — for entries closed because a specific commit landed. Used by ST-6\'s auto-close-on-merge.',
          ),
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
