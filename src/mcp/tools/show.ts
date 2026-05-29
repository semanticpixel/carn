import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarnToolContext } from './index.js';
import { resolveEntry } from '../../lib/index.js';
import { jsonToolResult } from './_shared.js';

export function registerShowTool(server: McpServer, ctx: CarnToolContext): void {
  server.registerTool(
    'carn_show',
    {
      description:
        'Fetch a single carn entry by its 8-character id (or unique id prefix). Use this when an entry surfaced by `carn_query` / `carn_list` referenced another id and you need the full content. Ambiguous prefixes return an error listing the matching ids.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async (input) =>
      jsonToolResult(async () => {
        const entry = await resolveEntry(ctx.repoRoot, input.id);
        return { entry };
      }),
  );
}
