import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EntryRefError } from '../../lib/index.js';

/**
 * The set of v1 entry type discriminants, as a Zod enum reused across the
 * `register` / `query` / `list` tool inputs.
 */
export const EntryTypeSchema = z.enum([
  'forbid-pattern',
  'prefer-pattern',
  'coordinate',
]);

/**
 * Wrap a tool body so its return value is shaped as MCP `text` content
 * containing the JSON serialization, and any thrown lib error becomes a
 * `CallToolResult` with `isError: true`. Tools always return data the
 * LLM can introspect; surfacing exceptions as `isError` lets the model
 * see what went wrong instead of getting a JSON-RPC error opaque to the
 * tool layer.
 */
export async function jsonToolResult(
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const value = await fn();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(value, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: formatToolError(err),
        },
      ],
    };
  }
}

function formatToolError(err: unknown): string {
  if (err instanceof EntryRefError) {
    const detail = err.matches.length > 0 ? ` (${err.matches.join(', ')})` : '';
    return `${err.message}${detail}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
