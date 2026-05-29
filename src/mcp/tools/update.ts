import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarnToolContext } from './index.js';
import { updateEntryById } from '../../lib/index.js';
import { jsonToolResult } from './_shared.js';

export function registerUpdateTool(server: McpServer, ctx: CarnToolContext): void {
  server.registerTool(
    'carn_update',
    {
      description:
        'Edit an in-flight carn entry — tweak the description, extend the TTL, add metadata, change paths. Use this instead of `carn_close` + `carn_register` when refining an entry you (or another agent) recently created. Cannot edit closed entries. The patch is shallow-merged then re-validated against the schema.',
      inputSchema: {
        id: z.string().min(1),
        patch: z.record(z.string(), z.unknown()),
      },
    },
    async (input) =>
      jsonToolResult(async () => {
        const entry = await updateEntryById(ctx.repoRoot, input.id, {
          identity: ctx.identity,
          patch: input.patch,
        });
        return { entry };
      }),
  );
}
