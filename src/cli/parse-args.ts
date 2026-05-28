/**
 * Tiny argv parser. Supports:
 *   --flag           → boolean true
 *   --flag=value     → string
 *   --flag value     → string (consumes next argv slot)
 *   --no-flag        → boolean false (only when caller marks `flag` as boolean)
 *   positionals     → everything that isn't a flag
 *
 * A flag declared as `array` collects every occurrence into a string[]
 * (so `--paths a --paths b` and `--paths=a --paths=b` both yield `[a, b]`).
 *
 * No-frills by design — the spec rules out commander/yargs. The trade-off is
 * documented: unknown flags surface as an error so a typo doesn't silently
 * persist as `[undefined]` in storage.
 */
export type FlagKind = 'string' | 'boolean' | 'array';

export interface FlagSpec {
  kind: FlagKind;
  /** Alternate names — e.g. `-h` for `help`. */
  aliases?: string[];
}

export interface ParseSpec {
  flags: Record<string, FlagSpec>;
  /** When true, unknown flags are returned as positionals instead of throwing. */
  allowUnknown?: boolean;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[] | undefined>;
}

export class ArgParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgParseError';
  }
}

function resolveName(
  spec: ParseSpec,
  raw: string,
): { canonical: string; flag: FlagSpec } | null {
  if (spec.flags[raw]) return { canonical: raw, flag: spec.flags[raw] };
  for (const [name, flag] of Object.entries(spec.flags)) {
    if (flag.aliases?.includes(raw)) return { canonical: name, flag };
  }
  return null;
}

export function parseArgs(argv: readonly string[], spec: ParseSpec): ParsedArgs {
  const positionals: string[] = [];
  const flags: ParsedArgs['flags'] = {};
  let sawDoubleDash = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (sawDoubleDash) {
      positionals.push(tok);
      continue;
    }
    if (tok === '--') {
      sawDoubleDash = true;
      continue;
    }
    if (!tok.startsWith('-')) {
      positionals.push(tok);
      continue;
    }

    const eq = tok.indexOf('=');
    const rawName = eq === -1 ? tok : tok.slice(0, eq);
    const inlineValue = eq === -1 ? null : tok.slice(eq + 1);

    let resolved = resolveName(spec, rawName);
    let negated = false;
    if (!resolved && rawName.startsWith('--no-')) {
      const probe = `--${rawName.slice('--no-'.length)}`;
      const candidate = resolveName(spec, probe);
      if (candidate?.flag.kind === 'boolean') {
        resolved = candidate;
        negated = true;
      }
    }

    if (!resolved) {
      if (spec.allowUnknown) {
        positionals.push(tok);
        continue;
      }
      throw new ArgParseError(`unknown flag: ${rawName}`);
    }

    const { canonical, flag } = resolved;
    if (flag.kind === 'boolean') {
      if (inlineValue !== null) {
        throw new ArgParseError(
          `boolean flag does not take a value: ${rawName}=${inlineValue}`,
        );
      }
      flags[canonical] = !negated;
      continue;
    }

    let value: string;
    if (inlineValue !== null) {
      value = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        throw new ArgParseError(`flag requires a value: ${rawName}`);
      }
      value = next;
      i++;
    }

    if (flag.kind === 'array') {
      const existing = flags[canonical];
      if (Array.isArray(existing)) existing.push(value);
      else flags[canonical] = [value];
    } else {
      flags[canonical] = value;
    }
  }

  return { positionals, flags };
}
