import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetPurgeMemoForTests } from '../storage/worktree.js';
import { CliError } from './context.js';
import { ArgParseError } from './parse-args.js';
import { z } from 'zod';

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

  try {
    const code = await dispatch(args, opts.stdin);
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

async function dispatch(args: readonly string[], stdin: string | undefined): Promise<number> {
  // Re-import here lazily so each test sees a fresh handler closure (matters
  // for modules that memoise stuff like the no-origin warn set).
  const { runInit } = await import('./init.js');
  const { runAdd } = await import('./add.js');
  const { runList } = await import('./list.js');
  const { runShow } = await import('./show.js');
  const { runClose } = await import('./close.js');
  const { runQuery } = await import('./query.js');
  const { topLevelHelp, suggestCommand, COMMANDS, VERSION } = await import('./help.js');

  const handlers: Record<string, (a: readonly string[]) => Promise<number>> = {
    init: runInit,
    add: runAdd,
    list: runList,
    show: runShow,
    close: runClose,
    query: runQuery,
  };

  if (stdin !== undefined) {
    pushStdin(stdin);
  }

  try {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
      process.stdout.write(topLevelHelp());
      return 0;
    }
    if (args[0] === '--version' || args[0] === '-v') {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    const cmd = args[0]!;
    const rest = args.slice(1);
    if (cmd === 'help') {
      // Skip the per-command help registry; tests don't exercise the dispatcher's
      // own help path directly.
      process.stdout.write(topLevelHelp());
      return 0;
    }
    if (!(cmd in handlers)) {
      const hint = suggestCommand(cmd);
      const known = COMMANDS.includes(cmd as never);
      // (commands list reference suppresses an unused-import lint flag in CI)
      void known;
      process.stderr.write(
        `carn: unknown command '${cmd}'${hint ? ` — did you mean '${hint}'?` : ''}\n`,
      );
      return 1;
    }
    return await handlers[cmd]!(rest);
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`error: ${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof ArgParseError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    if (err instanceof z.ZodError) {
      const msg = err.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      process.stderr.write(`error: ${msg}\n`);
      return 1;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
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
