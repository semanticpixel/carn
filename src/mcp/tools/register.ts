import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CarnToolContext } from './index.js';
import { registerEntry } from '../../lib/index.js';
import { assertValidTtl } from '../../ttl.js';
import type { EntryDraft } from '../../types.js';
import { EntryTypeSchema, jsonToolResult } from './_shared.js';

export function registerRegisterTool(server: McpServer, ctx: CarnToolContext): void {
  server.registerTool(
    'carn_register',
    {
      description:
        'Register a new carn entry (forbid-pattern, prefer-pattern, or coordinate). Call this when you (the agent) are about to leave a long-running constraint, preference, or pause-coordinate for the next agent or human working in this repo — for example, "no new typecasts in this file", "use satisfies instead of as", or "mid-refactor on auth, pause if touching".',
      inputSchema: {
        type: EntryTypeSchema,
        description: z.string().min(1).max(2000),
        paths: z.array(z.string().min(1)).optional(),
        ttl: z.string().min(1).optional(),
        constraint: z.string().min(1).optional(),
        instead_of: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
        pause_token: z.string().min(1).optional(),
      },
    },
    async (input) =>
      jsonToolResult(async () => {
        if (input.ttl) assertValidTtl(input.ttl);
        const draft = buildDraft(input);
        const entry = await registerEntry(ctx.repoRoot, draft, {
          identity: ctx.identity,
        });
        return { entry };
      }),
  );
}

function buildDraft(input: {
  type: 'forbid-pattern' | 'prefer-pattern' | 'coordinate';
  description: string;
  paths?: string[];
  ttl?: string;
  constraint?: string;
  instead_of?: string;
  reason?: string;
  pause_token?: string;
}): EntryDraft {
  const base = {
    description: input.description,
    paths: input.paths,
    ttl: input.ttl,
  };
  if (input.type === 'forbid-pattern' || input.type === 'prefer-pattern') {
    if (!input.constraint) {
      throw new Error(`constraint is required for ${input.type} entries.`);
    }
    if (input.type === 'prefer-pattern') {
      return {
        type: 'prefer-pattern',
        ...base,
        constraint: input.constraint,
        ...(input.instead_of ? { instead_of: input.instead_of } : {}),
      };
    }
    return { type: 'forbid-pattern', ...base, constraint: input.constraint };
  }
  if (!input.reason) {
    throw new Error('reason is required for coordinate entries.');
  }
  return {
    type: 'coordinate',
    ...base,
    reason: input.reason,
    ...(input.pause_token ? { pause_token: input.pause_token } : {}),
  };
}
