import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetPurgeMemoForTests } from '../storage/worktree.js';
import { runCarn } from '../cli.js';

const execFileAsync = promisify(execFile);

export interface FixtureRepo {
  root: string;
  bare: string;
  cleanup: () => Promise<void>;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'cli-test',
      GIT_AUTHOR_EMAIL: 'cli@test.local',
      GIT_COMMITTER_NAME: 'cli-test',
      GIT_COMMITTER_EMAIL: 'cli@test.local',
    },
  });
}

/**
 * Make a real tmp git repo with a configured user.email — what the CLI's
 * `resolveIdentity()` reads. Includes a paired bare origin so push/fetch
 * round-trips work end-to-end.
 */
export async function makeFixtureRepo(): Promise<FixtureRepo> {
  const root = await mkdtemp(join(tmpdir(), 'carn-cli-'));
  const bare = join(root, 'origin.git');
  await execFileAsync('git', ['init', '--bare', '-b', 'main', bare]);

  const work = join(root, 'work');
  await execFileAsync('git', ['clone', bare, work]);
  await git(work, 'config', 'user.name', 'cli-test');
  await git(work, 'config', 'user.email', 'cli@test.local');
  await writeFile(join(work, 'README.md'), 'fixture\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '-m', 'seed');
  await git(work, 'push', 'origin', 'main');

  const cleanup = async () => {
    _resetPurgeMemoForTests();
    await rm(root, { recursive: true, force: true });
  };

  return { root: work, bare, cleanup };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke a CLI handler in-process from `cwd`, capturing stdout/stderr/exit
 * code. Avoids spawning a child interpreter — keeps tests fast and lets the
 * vitest stack trace point at the failing line in the handler. The handler
 * still goes through the full parse-args + format + storage path.
 */
export async function runCli(
  cwd: string,
  args: readonly string[],
  opts: { stdin?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliResult> {
  const prevCwd = process.cwd();
  const prevEnv: Record<string, string | undefined> = {};
  let stdout = '';
  let stderr = '';

  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: typeof process.stdout.write }).write = ((
    chunk: string | Uint8Array,
  ) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as { write: typeof process.stderr.write }).write = ((
    chunk: string | Uint8Array,
  ) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;

  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      prevEnv[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  // NO_COLOR=1 by default — keep assertions clean.
  if (!('NO_COLOR' in (opts.env ?? {}))) {
    prevEnv.NO_COLOR = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
  }

  process.chdir(cwd);

  if (opts.stdin !== undefined) {
    pushStdin(opts.stdin);
  }

  try {
    // Drive the real `runCarn` from cli.ts — keeps the test harness honest
    // about how the bin entry actually maps errors and resolves commands.
    const code = await runCarn(['node', 'carn', ...args]);
    return { code, stdout, stderr };
  } finally {
    process.chdir(prevCwd);
    (process.stdout as { write: typeof process.stdout.write }).write = stdoutWrite;
    (process.stderr as { write: typeof process.stderr.write }).write = stderrWrite;
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Replace `process.stdin` with a fake async iterable that yields the given
 * string. The CLI's stdin path reads `process.stdin` as an async iterator
 * gated on `!isTTY`; this fake matches that shape.
 */
function pushStdin(value: string): void {
  const buf = Buffer.from(value, 'utf8');
  const fake = {
    isTTY: false,
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
}
