import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSandbox } from '../storage/_test-utils.js';
import { registerCarnTools } from './tools/index.js';
import type { GitIdentity } from '../storage/worktree.js';

/**
 * Round-trip test through the real McpServer + Client JSON-RPC stack
 * using InMemoryTransport. The stdio transport is one syscall layer
 * away — the SDK owns it, and the manual smoke against Claude Code
 * documented in the PR description covers the real stdio path. This
 * suite is the integration confidence that `registerTool` wiring +
 * tool body + storage round-trip all line up.
 */

const TEST_IDENTITY: GitIdentity = {
  name: 'mcp-test',
  email: 'mcp@test.local',
};

/**
 * Wrap `client.callTool` to always pass `CallToolResultSchema`, which
 * narrows the return type to the modern `CallToolResult` shape and away
 * from the deprecated `CompatibilityCallToolResult` (`{ toolResult }`).
 * Without this, `result.content` is `unknown` to TS.
 */
async function callCarnTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof Client.prototype.callTool>>> {
  return client.callTool({ name, arguments: args }, CallToolResultSchema);
}

async function makeClientServerPair(
  repoRoot: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = new McpServer({ name: 'carn-test', version: '0.0.0-test' });
  registerCarnTools(server, { repoRoot, identity: TEST_IDENTITY });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const close = async () => {
    await client.close();
    await server.close();
  };
  return { client, close };
}

interface ToolText {
  type: string;
  text?: string;
}

/**
 * `callTool()` returns a union including the deprecated
 * `CompatibilityCallToolResult` shape (`{ toolResult }`, no `content`).
 * Tests always pass `CallToolResultSchema` so the runtime value is the
 * modern shape, but the static type stays a union — this helper takes
 * `unknown` and narrows structurally.
 */
function readText(result: unknown): unknown {
  const content = (result as { content?: unknown }).content;
  const arr = Array.isArray(content) ? (content as ToolText[]) : [];
  const text = arr[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`tool returned no text content: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text);
}

describe('MCP server — tool round-trip', () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(() => {
    cleanup = null;
  });
  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it('tools/list returns all six carn tools', async () => {
    const sandbox = await makeSandbox(1);
    const pair = await makeClientServerPair(sandbox.clones[0]!);
    cleanup = async () => {
      await pair.close();
      await sandbox.cleanup();
    };
    const result = await pair.client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['carn_register', 'carn_query', 'carn_list', 'carn_show', 'carn_close', 'carn_update'].sort(),
    );
  });

  it('every tool has a description that mentions WHEN to use it', async () => {
    const sandbox = await makeSandbox(1);
    const pair = await makeClientServerPair(sandbox.clones[0]!);
    cleanup = async () => {
      await pair.close();
      await sandbox.cleanup();
    };
    const result = await pair.client.listTools();
    for (const t of result.tools) {
      expect(t.description ?? '').toMatch(/call|use this|when/i);
    }
  });

  it('register → query → show → update → close round-trip', async () => {
    const sandbox = await makeSandbox(1);
    const pair = await makeClientServerPair(sandbox.clones[0]!);
    cleanup = async () => {
      await pair.close();
      await sandbox.cleanup();
    };

    const registered = readText(
      await pair.client.callTool({
        name: 'carn_register',
        arguments: {
          type: 'forbid-pattern',
          description: 'no new typecasts in auth',
          constraint: 'no `as Foo` here',
          paths: ['src/auth/**'],
        },
      }, CallToolResultSchema),
    ) as { entry: { id: string; type: string } };
    expect(registered.entry.id).toMatch(/^[a-z2-9]{8}$/);
    expect(registered.entry.type).toBe('forbid-pattern');

    const queried = readText(
      await pair.client.callTool({
        name: 'carn_query',
        arguments: { paths: ['src/auth/login.ts'] },
      }, CallToolResultSchema),
    ) as { entries: Array<{ id: string }> };
    expect(queried.entries.map((e) => e.id)).toContain(registered.entry.id);

    const shown = readText(
      await pair.client.callTool({
        name: 'carn_show',
        arguments: { id: registered.entry.id },
      }, CallToolResultSchema),
    ) as { entry: { id: string } };
    expect(shown.entry.id).toBe(registered.entry.id);

    const updated = readText(
      await pair.client.callTool({
        name: 'carn_update',
        arguments: { id: registered.entry.id, patch: { description: 'updated note' } },
      }, CallToolResultSchema),
    ) as { entry: { description: string } };
    expect(updated.entry.description).toBe('updated note');

    const closed = readText(
      await pair.client.callTool({
        name: 'carn_close',
        arguments: { id: registered.entry.id, merged_sha: 'deadbeef' },
      }, CallToolResultSchema),
    ) as { entry: { closed_at: string | null; metadata: { merged_sha?: string } } };
    expect(closed.entry.closed_at).not.toBeNull();
    expect(closed.entry.metadata.merged_sha).toBe('deadbeef');
  });

  it('carn_list with status="all" returns the closed entry', async () => {
    const sandbox = await makeSandbox(1);
    const pair = await makeClientServerPair(sandbox.clones[0]!);
    cleanup = async () => {
      await pair.close();
      await sandbox.cleanup();
    };
    const registered = readText(
      await pair.client.callTool({
        name: 'carn_register',
        arguments: { type: 'coordinate', description: 'r', reason: 'mid' },
      }, CallToolResultSchema),
    ) as { entry: { id: string } };
    await pair.client.callTool({
      name: 'carn_close',
      arguments: { id: registered.entry.id },
    }, CallToolResultSchema);

    const inflight = readText(
      await pair.client.callTool({
        name: 'carn_list',
        arguments: { status: 'in-flight' },
      }, CallToolResultSchema),
    ) as { entries: Array<{ id: string }> };
    expect(inflight.entries).toHaveLength(0);

    const all = readText(
      await pair.client.callTool({
        name: 'carn_list',
        arguments: { status: 'all' },
      }, CallToolResultSchema),
    ) as { entries: Array<{ id: string }> };
    expect(all.entries.map((e) => e.id)).toContain(registered.entry.id);
  });

  it('carn_show with an unknown id returns isError with a clear message', async () => {
    const sandbox = await makeSandbox(1);
    const pair = await makeClientServerPair(sandbox.clones[0]!);
    cleanup = async () => {
      await pair.close();
      await sandbox.cleanup();
    };
    const result = await pair.client.callTool({
      name: 'carn_show',
      arguments: { id: 'zzzzzzzz' },
    }, CallToolResultSchema);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result.content as ToolText[])[0]?.text ?? '';
    expect(text).toContain('zzzzzzzz');
  });
});
