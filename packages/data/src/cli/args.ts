/**
 * Minimal argv parser for the data CLI.
 *
 * Deliberately dependency-free (no new third-party packages) and strict:
 * unknown flags are an error rather than a silent no-op, because a typo'd
 * `--limit` on an ingest command should not quietly become a full download.
 */
import { InvalidInputError } from '../errors';

export interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

export interface FlagSpec {
  /** Flags that take a value, e.g. `--limit 10`. */
  readonly valued: readonly string[];
  /** Flags that stand alone, e.g. `--force`. */
  readonly boolean: readonly string[];
  /** Valued flags that may repeat, collected in order. */
  readonly repeated?: readonly string[];
}

export interface CommandArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
  readonly repeated: Readonly<Record<string, readonly string[]>>;
}

export function parseArgs(argv: readonly string[], spec: FlagSpec): CommandArgs {
  const valued = new Set(spec.valued);
  const booleans = new Set(spec.boolean);
  const repeatable = new Set(spec.repeated ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  const repeated: Record<string, string[]> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

    if (booleans.has(name)) {
      if (inlineValue !== undefined) {
        throw new InvalidInputError('argument', `--${name} does not take a value`);
      }
      flags[name] = true;
      continue;
    }

    if (!valued.has(name) && !repeatable.has(name)) {
      throw new InvalidInputError('argument', `unknown flag --${name}`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new InvalidInputError('argument', `--${name} requires a value`);
    }
    if (inlineValue === undefined) index += 1;

    if (repeatable.has(name)) {
      const bucket = repeated[name] ?? [];
      bucket.push(value);
      repeated[name] = bucket;
    } else {
      flags[name] = value;
    }
  }

  return { positionals, flags, repeated };
}

export function flagString(args: CommandArgs, name: string, fallback: string): string {
  const value = args.flags[name];
  return typeof value === 'string' ? value : fallback;
}

export function flagBoolean(args: CommandArgs, name: string): boolean {
  return args.flags[name] === true;
}

export function flagInteger(args: CommandArgs, name: string): number | undefined {
  const value = args.flags[name];
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidInputError('argument', `--${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function requirePositional(args: CommandArgs, index: number, what: string): string {
  const value = args.positionals[index];
  if (value === undefined || value.length === 0) {
    throw new InvalidInputError('argument', `missing required ${what}`);
  }
  return value;
}
