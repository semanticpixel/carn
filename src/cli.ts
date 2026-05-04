#!/usr/bin/env node

const VERSION = '0.0.0';

const HELP = `carn v${VERSION} — pre-alpha. Run \`carn --help\` for more once commands land.

Usage:
  carn --help        Show this message
  carn --version     Print the version

Real commands (init, add, list, show, close, query) land in a later milestone.
See https://github.com/semanticpixel/carn/blob/main/PLAN.md for the roadmap.
`;

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  process.stdout.write(HELP);
  return 0;
}

process.exit(main(process.argv));
