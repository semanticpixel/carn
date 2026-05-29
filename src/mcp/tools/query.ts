import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarnToolContext } from './index.js';
import { queryEntries } from '../../lib/index.js';
import { EntryTypeSchema, jsonToolResult } from './_shared.js';

export function registerQueryTool(server: McpServer, ctx: CarnToolContext): void {
  server.registerTool(
    'carn_query',
    {
      description:
        'Query for active carn entries that apply to specific paths. Call this at the start of a task (and again before editing a new area of the codebase) to surface constraints, preferences, and pause-coordinates left by previous agents or humans. Returns in-flight entries whose `paths` overlap any of the given query paths.',
      inputSchema: {
        paths: z.array(z.string().min(1)).min(1),
        type: EntryTypeSchema.optional(),
        exclude_expired: z.boolean().optional(),
      },
    },
    async (input) =>
      jsonToolResult(async () => {
        const entries = await queryEntries(ctx.repoRoot, {
          paths: input.paths,
          type: input.type,
          excludeExpired: input.exclude_expired,
        });
        return { entries };
      }),
  );
}
