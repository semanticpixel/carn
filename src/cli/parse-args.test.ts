import { describe, expect, it } from 'vitest';
import { ArgParseError, parseArgs } from './parse-args.js';

describe('parseArgs — flag shapes', () => {
  it('parses `--flag value`', () => {
    const out = parseArgs(['--type', 'forbid-pattern'], {
      flags: { '--type': { kind: 'string' } },
    });
    expect(out.flags['--type']).toBe('forbid-pattern');
    expect(out.positionals).toEqual([]);
  });

  it('parses `--flag=value`', () => {
    const out = parseArgs(['--type=coordinate'], {
      flags: { '--type': { kind: 'string' } },
    });
    expect(out.flags['--type']).toBe('coordinate');
  });

  it('parses boolean `--flag` (no value)', () => {
    const out = parseArgs(['--json'], {
      flags: { '--json': { kind: 'boolean' } },
    });
    expect(out.flags['--json']).toBe(true);
  });

  it('parses `--no-flag` negation for boolean flags', () => {
    const out = parseArgs(['--no-json'], {
      flags: { '--json': { kind: 'boolean' } },
    });
    expect(out.flags['--json']).toBe(false);
  });

  it('rejects `--bool=value` for boolean flags', () => {
    expect(() =>
      parseArgs(['--json=yes'], {
        flags: { '--json': { kind: 'boolean' } },
      }),
    ).toThrow(ArgParseError);
  });

  it('collects repeated array flags', () => {
    const out = parseArgs(['--paths', 'a', '--paths', 'b', '--paths=c'], {
      flags: { '--paths': { kind: 'array' } },
    });
    expect(out.flags['--paths']).toEqual(['a', 'b', 'c']);
  });

  it('array flags greedily consume consecutive non-flag values', () => {
    const out = parseArgs(['--paths', 'a', 'b', 'c'], {
      flags: { '--paths': { kind: 'array' } },
    });
    expect(out.flags['--paths']).toEqual(['a', 'b', 'c']);
    expect(out.positionals).toEqual([]);
  });

  it('greedy consumption stops at the next flag', () => {
    const out = parseArgs(
      ['--paths', 'a', 'b', '--reason', 'r'],
      {
        flags: {
          '--paths': { kind: 'array' },
          '--reason': { kind: 'string' },
        },
      },
    );
    expect(out.flags['--paths']).toEqual(['a', 'b']);
    expect(out.flags['--reason']).toBe('r');
    expect(out.positionals).toEqual([]);
  });

  it('greedy consumption stops at the `--` positional terminator', () => {
    const out = parseArgs(['--paths', 'a', 'b', '--', 'rest', 'tokens'], {
      flags: { '--paths': { kind: 'array' } },
    });
    expect(out.flags['--paths']).toEqual(['a', 'b']);
    expect(out.positionals).toEqual(['rest', 'tokens']);
  });

  it('greedy + repeated combine — `--paths a b --paths c d` → [a,b,c,d]', () => {
    const out = parseArgs(['--paths', 'a', 'b', '--paths', 'c', 'd'], {
      flags: { '--paths': { kind: 'array' } },
    });
    expect(out.flags['--paths']).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inline `--flag=value` is bounded — does NOT greedily consume', () => {
    // `=` is the explicit value-boundary convention (kubectl, cargo, git).
    // Users who want to add more values can repeat the flag or use the
    // next-slot form.
    const out = parseArgs(['--paths=a', 'b', 'c'], {
      flags: { '--paths': { kind: 'array' } },
    });
    expect(out.flags['--paths']).toEqual(['a']);
    expect(out.positionals).toEqual(['b', 'c']);
  });

  it('greedy treats a bare `-` as a value (stdin convention), not a flag', () => {
    const out = parseArgs(['--paths', 'a', '-', 'b'], {
      flags: { '--paths': { kind: 'array' } },
    });
    expect(out.flags['--paths']).toEqual(['a', '-', 'b']);
  });

  it('greedy does NOT affect non-array kind flags — `string` still takes one value', () => {
    const out = parseArgs(['--type', 'forbid', 'leftover'], {
      flags: { '--type': { kind: 'string' } },
    });
    expect(out.flags['--type']).toBe('forbid');
    expect(out.positionals).toEqual(['leftover']);
  });

  it('positional before greedy array — description then paths works as users expect', () => {
    // The dogfooding bug that motivated this change:
    //   carn add "desc" --type coordinate --paths a b c --reason r
    // should produce description="desc", paths=[a,b,c], reason="r".
    const out = parseArgs(
      ['desc', '--type', 'coordinate', '--paths', 'a', 'b', 'c', '--reason', 'r'],
      {
        flags: {
          '--type': { kind: 'string' },
          '--paths': { kind: 'array' },
          '--reason': { kind: 'string' },
        },
      },
    );
    expect(out.positionals).toEqual(['desc']);
    expect(out.flags['--type']).toBe('coordinate');
    expect(out.flags['--paths']).toEqual(['a', 'b', 'c']);
    expect(out.flags['--reason']).toBe('r');
  });

  it('resolves aliases (e.g. -h → --help)', () => {
    const out = parseArgs(['-h'], {
      flags: { '--help': { kind: 'boolean', aliases: ['-h'] } },
    });
    expect(out.flags['--help']).toBe(true);
  });

  it('captures positionals', () => {
    const out = parseArgs(['carn', 'add', 'desc'], {
      flags: {},
      allowUnknown: false,
    });
    expect(out.positionals).toEqual(['carn', 'add', 'desc']);
  });

  it('treats everything after `--` as positional', () => {
    const out = parseArgs(['--json', '--', '--literal', '-x'], {
      flags: { '--json': { kind: 'boolean' } },
    });
    expect(out.flags['--json']).toBe(true);
    expect(out.positionals).toEqual(['--literal', '-x']);
  });

  it('throws on unknown flag by default', () => {
    expect(() => parseArgs(['--ghost'], { flags: {} })).toThrow(ArgParseError);
  });

  it('passes unknown flags through as positionals when allowUnknown', () => {
    const out = parseArgs(['--ghost', 'x'], { flags: {}, allowUnknown: true });
    expect(out.positionals).toContain('--ghost');
  });

  it('errors when a string flag is missing its value', () => {
    expect(() =>
      parseArgs(['--type'], { flags: { '--type': { kind: 'string' } } }),
    ).toThrow(ArgParseError);
  });

  it('errors when a string flag is followed by another flag', () => {
    expect(() =>
      parseArgs(['--type', '--json'], {
        flags: {
          '--type': { kind: 'string' },
          '--json': { kind: 'boolean' },
        },
      }),
    ).toThrow(ArgParseError);
  });
});
