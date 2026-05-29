import { runCarn } from '../cli.js';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke the CLI in-process from `cwd`, capturing stdout/stderr/exit
 * code. Avoids spawning a child interpreter — keeps tests fast and lets
 * the vitest stack trace point at the failing handler line. The handler
 * still goes through the full parse-args + format + storage path via
 * `runCarn`, so error mapping and exit-code conventions are honored.
 *
 * Sets `NO_COLOR=1` by default — assertions stay clean. Override via
 * `opts.env`.
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
  if (!('NO_COLOR' in (opts.env ?? {}))) {
    prevEnv.NO_COLOR = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
  }

  process.chdir(cwd);

  if (opts.stdin !== undefined) {
    pushStdin(opts.stdin);
  }

  try {
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
 * Replace `process.stdin` with a fake async iterable that yields the
 * given string. The CLI's stdin path reads `process.stdin` as an async
 * iterator gated on `!isTTY`; this fake matches that shape.
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
