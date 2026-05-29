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
        description: z
          .string()
          .min(1)
          .max(2000)
          .describe(
            'Required. Human-readable summary of the entry (1-2 sentences). This is what other agents see first when querying.',
          ),
        paths: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Glob patterns this entry applies to (e.g. `["src/auth/**", "*.ts"]`). Omit for repo-wide.',
          ),
        ttl: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional duration like `7d`, `24h`, `30m`. Units: s|m|h|d|w. After expiry, the entry is flagged but not auto-closed.',
          ),
        constraint: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Required for `forbid-pattern` and `prefer-pattern`. The rule itself (e.g. "no `as Foo` casts").',
          ),
        instead_of: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional for `prefer-pattern`. What the new pattern replaces (e.g. "manual try/catch wrappers").',
          ),
        reason: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Required for `coordinate`. Why other agents should pause or what context they need before touching the paths.',
          ),
        pause_token: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional for `coordinate`. A short token (e.g. `slack:#dev`, `linear:ENG-123`) telling agents where to check or message before proceeding.',
          ),
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
