#!/usr/bin/env node
import { z } from 'zod';
import { CliError } from './cli/context.js';
import { runAdd, ADD_HELP } from './cli/add.js';
import { runClose, CLOSE_HELP } from './cli/close.js';
import { runInit, INIT_HELP } from './cli/init.js';
import { runList, LIST_HELP } from './cli/list.js';
import { runQuery, QUERY_HELP } from './cli/query.js';
import { runShow, SHOW_HELP } from './cli/show.js';
import { ArgParseError } from './cli/parse-args.js';
import {
  COMMANDS,
  VERSION,
  suggestCommand,
  topLevelHelp,
  type CommandName,
} from './cli/help.js';
import { painter } from './cli/format.js';

type Handler = (argv: readonly string[]) => Promise<number>;

const HANDLERS: Record<Exclude<CommandName, 'help'>, Handler> = {
  init: runInit,
  add: runAdd,
  list: runList,
  show: runShow,
  close: runClose,
  query: runQuery,
};

const PER_COMMAND_HELP: Record<Exclude<CommandName, 'help'>, string> = {
  init: INIT_HELP,
  add: ADD_HELP,
  list: LIST_HELP,
  show: SHOW_HELP,
  close: CLOSE_HELP,
  query: QUERY_HELP,
};

function isKnownHandler(s: string): s is Exclude<CommandName, 'help'> {
  return (COMMANDS as readonly string[]).includes(s) && s !== 'help';
}

async function dispatch(args: readonly string[]): Promise<number> {
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
    const target = rest[0];
    if (!target) {
      process.stdout.write(topLevelHelp());
      return 0;
    }
    if (isKnownHandler(target)) {
      process.stdout.write(PER_COMMAND_HELP[target]);
      return 0;
    }
    const hint = suggestCommand(target);
    process.stderr.write(
      `carn: unknown command '${target}'${hint ? ` — did you mean '${hint}'?` : ''}\n`,
    );
    return 1;
  }

  if (!isKnownHandler(cmd)) {
    const hint = suggestCommand(cmd);
    process.stderr.write(
      `carn: unknown command '${cmd}'${hint ? ` — did you mean '${hint}'?` : ''}\nRun \`carn --help\` for available commands.\n`,
    );
    return 1;
  }

  return HANDLERS[cmd](rest);
}

/**
 * Run the CLI with a full argv vector (`[node, carn, ...args]`). Exposed so
 * the test harness (`src/cli/_test-utils.ts`) can drive the exact same
 * dispatch + error-mapping path the bin entry uses — avoids drift where a
 * new error class gets a custom exit code here but the test harness keeps
 * its old copy.
 */
export async function runCarn(argv: readonly string[]): Promise<number> {
  try {
    return await dispatch(argv.slice(2));
  } catch (err) {
    const p = painter(process.stderr);
    if (err instanceof CliError) {
      process.stderr.write(`${p.red('error:')} ${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof ArgParseError) {
      process.stderr.write(`${p.red('error:')} ${err.message}\n`);
      return 1;
    }
    if (err instanceof z.ZodError) {
      process.stderr.write(`${p.red('error:')} ${formatZodIssues(err)}\n`);
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${p.red('error:')} ${message}\n`);
    return 2;
  }
}

function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}

// Bin entry — only when invoked directly, not when imported by tests.
import { pathToFileURL } from 'node:url';
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCarn(process.argv).then((code) => process.exit(code));
}
