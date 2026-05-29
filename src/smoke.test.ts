import { afterEach, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  CARN_REF,
  DEFAULT_IDENTITY,
  acquireWorktree,
  gitExec,
  identityEnv,
} from './storage/worktree.js';
import { addEntry, getEntry } from './storage/entry.js';
import { ttlExpiresAt, isExpired } from './ttl.js';
import { runDoctor } from './doctor.js';
import { makeFixtureRepo, runCli, type FixtureRepo } from './test-utils/index.js';

const execFileAsync = promisify(execFile);

/**
 * ST-10 smoke coverage — sits alongside the per-item suites and exists
 * to backstop the v0.1.0 acceptance criteria. Targets the *gaps* the
 * per-item tests don't already cover; deliberately small. The
 * `src/test-utils/fixture-repo.ts` helper is the canonical setup;
 * everything else routes through real storage primitives so a test
 * never validates a synthetic happy path that production wouldn't
 * actually hit.
 */

let active: FixtureRepo | null = null;

afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('TTL boundary — exactly at the TTL', () => {
  it('isExpired flips from false to true the instant `now` reaches created_at + TTL', async () => {
    active = await makeFixtureRepo({
      withEntries: [
        {
          type: 'forbid-pattern',
          description: 'boundary',
          paths: ['*'],
          constraint: 'no x',
          ttl: '1h',
        },
      ],
    });
    const [entry] = (await (async () => {
      const { listEntries } = await import('./storage/entry.js');
      return listEntries(active!.root);
    })());
    expect(entry).toBeDefined();
    const expiresAt = ttlExpiresAt(entry!);
    expect(expiresAt).not.toBeNull();
    // 1 ms before the boundary: not expired.
    expect(isExpired(entry!, new Date(expiresAt! - 1))).toBe(false);
    // Exactly at the boundary: the spec is `now >= expiresAt` → expired.
    expect(isExpired(entry!, new Date(expiresAt!))).toBe(true);
    // 1 ms after: expired.
    expect(isExpired(entry!, new Date(expiresAt! + 1))).toBe(true);
  });
});

describe('Schema forward-compat — unknown fields round-trip through storage', () => {
  it('a v2-ish entry with extra fields persists, re-reads, and keeps the extras', async () => {
    active = await makeFixtureRepo({ withCarn: true });
    // Synthesise an entry-on-disk that includes a hypothetical v2 field
    // and verify storage.getEntry returns it with the extras intact.
    const lease = await acquireWorktree(active.root);
    try {
      const id = 'fwd2cmpt';
      const dir = join(lease.path, 'in-flight');
      await mkdir(dir, { recursive: true });
      const v2Entry = {
        type: 'forbid-pattern',
        id,
        description: 'forward-compat',
        paths: ['src/'],
        author: 'fixture',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        closed_at: null,
        ttl: null,
        metadata: {},
        constraint: 'no x',
        // v2-only extras the schema doesn't know about:
        future_lifespan: 'evergreen',
        author_scope: { team: 'auth', project: 'carn' },
      };
      await writeFile(join(dir, `${id}.json`), JSON.stringify(v2Entry, null, 2));
      const env = identityEnv(DEFAULT_IDENTITY);
      await gitExec(lease.path, ['add', '-A']);
      await gitExec(lease.path, ['commit', '-m', 'test: v2 entry'], { env });
      const head = (await gitExec(lease.path, ['rev-parse', 'HEAD'])).stdout.trim();
      await gitExec(active.root, ['update-ref', CARN_REF, head]);
      await gitExec(active.root, ['push', 'origin', `${head}:${CARN_REF}`]);
    } finally {
      await lease.release();
    }

    const read = await getEntry(active.root, 'fwd2cmpt');
    expect(read).not.toBeNull();
    // The base fields still round-trip:
    expect(read!.type).toBe('forbid-pattern');
    expect(read!.description).toBe('forward-compat');
    // The v2 extras are preserved verbatim — a v1-pinned client must
    // not silently drop them on re-write. `.passthrough()` keeps them
    // on the parse output regardless of TS typing.
    const raw = read as unknown as Record<string, unknown>;
    expect(raw['future_lifespan']).toBe('evergreen');
    expect(raw['author_scope']).toEqual({ team: 'auth', project: 'carn' });
  });
});

describe('Doctor catches malformed disk entries — the "deliberately broken commit" check', () => {
  it('schema-violation surfaces when a hand-written entry omits required fields', async () => {
    active = await makeFixtureRepo({ withCarn: true });
    const lease = await acquireWorktree(active.root);
    try {
      const dir = join(lease.path, 'in-flight');
      await mkdir(dir, { recursive: true });
      // Deliberately broken: missing required `description` + `constraint`.
      await writeFile(
        join(dir, 'corrupt00.json'),
        JSON.stringify({ type: 'forbid-pattern', id: 'corrupt00' }),
      );
      const env = identityEnv(DEFAULT_IDENTITY);
      await gitExec(lease.path, ['add', '-A']);
      await gitExec(lease.path, ['commit', '-m', 'test: malformed entry'], { env });
      const head = (await gitExec(lease.path, ['rev-parse', 'HEAD'])).stdout.trim();
      await gitExec(active.root, ['update-ref', CARN_REF, head]);
      await gitExec(active.root, ['push', 'origin', `${head}:${CARN_REF}`]);
    } finally {
      await lease.release();
    }

    const report = await runDoctor(active.root);
    const violations = report.checks.filter((c) => c.code === 'schema-violation');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.entry_id).toBe('corrupt00');
    expect(report.exit_tier).toBe('error');
  });
});

describe('makeFixtureRepo helper', () => {
  it('seeds entries via the real addEntry path so the index log records them', async () => {
    active = await makeFixtureRepo({
      withEntries: [
        {
          type: 'coordinate',
          description: 'seeded',
          paths: ['src/'],
          reason: 'fixture seed',
        },
      ],
    });
    const { readIndexLog } = await import('./storage/index-log.js');
    const lease = await acquireWorktree(active.root);
    try {
      const records = await readIndexLog(lease.path);
      const adds = records.filter((r) => r.op === 'add');
      expect(adds).toHaveLength(1);
    } finally {
      await lease.release();
    }
  });

  it('does not initialise the carn branch when withCarn is omitted', async () => {
    active = await makeFixtureRepo();
    const ref = await gitExec(active.root, ['rev-parse', '--verify', '--quiet', CARN_REF], {
      allowFailure: true,
    });
    expect(ref.code).not.toBe(0);
  });
});

describe('Storage crash mid-op recovered by doctor --fix', () => {
  it('an externally-added worktree on the carn branch is flagged + removed by --fix', async () => {
    active = await makeFixtureRepo({ withCarn: true });
    // Simulate an aborted CRUD that left an orphaned worktree behind.
    const orphanDir = `${active.root}-orphan-${Date.now()}`;
    await gitExec(active.root, ['worktree', 'add', '--detach', orphanDir, CARN_REF]);
    // Wipe the directory from underneath git — typical crash residue.
    await rm(orphanDir, { recursive: true, force: true });

    const before = await runDoctor(active.root);
    expect(before.checks.some((c) => c.code === 'orphaned-worktree')).toBe(true);

    await runDoctor(active.root, { fix: true });
    const after = await runDoctor(active.root);
    expect(after.checks.some((c) => c.code === 'orphaned-worktree')).toBe(false);
  });
});

describe('MCP stdio subprocess — JSON-RPC round-trip over real pipes', () => {
  /**
   * In-process `InMemoryTransport` coverage already exists in
   * `src/mcp/server.test.ts`. This test specifically backstops the
   * *stdio* path — NDJSON framing across pipe writes, stdin EOF
   * handling, the bundled `dist/cli.js mcp` entry actually running in
   * its published shape (tsup excludes, shebang interaction, etc.).
   * That's the wire-level surface an in-process transport can't
   * reproduce.
   *
   * Skipped when `dist/cli.js` is absent — `pnpm build` precedes
   * `pnpm test` in CI per the spec's acceptance, but local `pnpm test`
   * runs without a fresh build are common. Don't fail the suite for
   * that; document the gap by skip-marker instead.
   */
  const CLI_PATH = join(process.cwd(), 'dist', 'cli.js');

  it.skipIf(!existsSync(CLI_PATH))(
    'tools/list returns the six v1 tools when invoked over stdio',
    async () => {
      active = await makeFixtureRepo({ withCarn: true });
      const child = spawn('node', [CLI_PATH, 'mcp'], {
        cwd: active.root,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      try {
        const reply = await rpcRoundTrip(child);
        // MCP returns tool descriptors; we only assert the six names so a
        // future description tweak doesn't break the smoke.
        const names = (reply.result as { tools: Array<{ name: string }> }).tools.map(
          (t) => t.name,
        );
        expect(names).toEqual(
          expect.arrayContaining([
            'carn_register',
            'carn_query',
            'carn_list',
            'carn_show',
            'carn_close',
            'carn_update',
          ]),
        );
      } finally {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => child.on('exit', () => resolve()));
      }
    },
    20_000,
  );
});

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * Drive the MCP `initialize` → `notifications/initialized` →
 * `tools/list` sequence over the child's stdio and return the
 * `tools/list` response. Messages are NDJSON-framed (one JSON object
 * per line) per the stdio transport contract.
 */
async function rpcRoundTrip(child: ReturnType<typeof spawn>): Promise<JsonRpcMessage> {
  const stdout = child.stdout;
  const stdin = child.stdin;
  if (!stdout || !stdin) throw new Error('child stdio is not piped');

  let buffer = '';
  const responses: JsonRpcMessage[] = [];
  const waiters: Array<(msg: JsonRpcMessage) => void> = [];

  stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        if (waiters.length > 0 && msg.id !== undefined) {
          const w = waiters.shift()!;
          w(msg);
        } else {
          responses.push(msg);
        }
      } catch {
        /* ignore non-JSON lines (e.g. log noise) */
      }
    }
  });

  const send = (msg: JsonRpcMessage): void => {
    stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const expectId = (id: number): Promise<JsonRpcMessage> =>
    new Promise((resolve) => {
      const matched = responses.findIndex((m) => m.id === id);
      if (matched !== -1) {
        const [m] = responses.splice(matched, 1);
        resolve(m!);
      } else {
        waiters.push((m) => {
          if (m.id === id) resolve(m);
          else waiters.push((next) => resolve(next));
        });
      }
    });

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    },
  });
  await expectId(1);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  return expectId(2);
}

describe('CLI exit codes — known error paths return the documented codes', () => {
  /**
   * Sanity-check the contract documented in `--help`: 0 success, 1 user
   * error, 2 system error. Each per-command suite covers its own paths;
   * this exists so a refactor that homogenises error handling can't
   * accidentally renumber what users + scripts depend on.
   */
  it('unknown command → 1', async () => {
    const repo = await makeFixtureRepo();
    try {
      const res = await runCli(repo.root, ['frobnicate']);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain("unknown command 'frobnicate'");
    } finally {
      await repo.cleanup();
    }
  });

  it('show with missing id → 1', async () => {
    const repo = await makeFixtureRepo();
    try {
      const res = await runCli(repo.root, ['show', 'doesnotex']);
      expect(res.code).toBe(1);
    } finally {
      await repo.cleanup();
    }
  });

  it('add with bad --ttl → 1', async () => {
    const repo = await makeFixtureRepo();
    try {
      const res = await runCli(repo.root, [
        'add',
        'x',
        '--type',
        'coordinate',
        '--reason',
        'r',
        '--paths',
        '*',
        '--ttl',
        '7y',
      ]);
      expect(res.code).toBe(1);
    } finally {
      await repo.cleanup();
    }
  });
});
