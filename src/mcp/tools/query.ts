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
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'One or more file paths or globs to ask about (e.g. `["src/auth/login.ts"]` or `["src/**"]`). Returns entries whose own `paths` overlap any of these.',
          ),
        type: EntryTypeSchema.optional().describe(
          'Optional. Restrict to one entry kind. Omit to surface all kinds.',
        ),
        exclude_expired: z
          .boolean()
          .optional()
          .describe(
            'When true, past-TTL entries are dropped from the result. Default false — expired entries are still returned with their TTL stamped so the agent can decide.',
          ),
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
