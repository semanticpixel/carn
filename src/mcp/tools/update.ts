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
        id: z
          .string()
          .min(1)
          .describe(
            'The entry id — full 8 chars or a unique prefix. Closed entries cannot be updated.',
          ),
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            'Shallow-merged into the existing entry. Common fields: `description`, `paths`, `ttl`, `constraint`, `instead_of`, `reason`, `pause_token`, `metadata`. The merged shape is re-validated against the schema; `id` cannot be patched.',
          ),
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
