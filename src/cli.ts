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

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);

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

function isKnownHandler(s: string): s is Exclude<CommandName, 'help'> {
  return (COMMANDS as readonly string[]).includes(s) && s !== 'help';
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const p = painter(process.stderr);
    if (err instanceof CliError) {
      process.stderr.write(`${p.red('error:')} ${err.message}\n`);
      process.exit(err.exitCode);
    }
    if (err instanceof ArgParseError) {
      process.stderr.write(`${p.red('error:')} ${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof z.ZodError) {
      process.stderr.write(`${p.red('error:')} ${formatZodIssues(err)}\n`);
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${p.red('error:')} ${message}\n`);
    process.exit(2);
  });

function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}
