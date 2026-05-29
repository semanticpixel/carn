import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarnToolContext } from './index.js';
import { listEntriesFiltered } from '../../lib/index.js';
import { EntryTypeSchema, jsonToolResult } from './_shared.js';

export function registerListTool(server: McpServer, ctx: CarnToolContext): void {
  server.registerTool(
    'carn_list',
    {
      description:
        'List carn entries — defaults to in-flight (open). Use this for a broad inventory across the repo, not for "what applies to my current edit" (that\'s `carn_query`). Useful at the start of a session to scan recent entries, or with `status="closed"` to audit what shipped.',
      inputSchema: {
        status: z
          .enum(['in-flight', 'closed', 'all'])
          .optional()
          .describe(
            'Which entries to return. Default `in-flight` (open). `closed` shows only the archive; `all` returns both.',
          ),
        type: EntryTypeSchema.optional().describe(
          'Optional. Restrict to one entry kind.',
        ),
        author: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional. Filter by `author` (an email — same value `carn_register` records from `git config user.email`).',
          ),
        exclude_expired: z
          .boolean()
          .optional()
          .describe('When true, past-TTL entries are dropped from the result.'),
      },
    },
    async (input) =>
      jsonToolResult(async () => {
        const entries = await listEntriesFiltered(ctx.repoRoot, {
          status: input.status,
          type: input.type,
          author: input.author,
          excludeExpired: input.exclude_expired,
        });
        return { entries };
      }),
  );
}
