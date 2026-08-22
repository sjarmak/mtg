/**
 * Argument parsing for the benchmarks.
 *
 * Shared so both benchmarks reject a typo instead of silently benchmarking
 * something other than what was asked for — a benchmark that quietly ignores
 * `--wokers` reports a number nobody can reproduce.
 */
export interface BenchArgs {
  readonly flags: ReadonlyMap<string, string>;
}

export function parseBenchArgs(argv: readonly string[], allowed: readonly string[]): BenchArgs {
  const known = new Set(allowed);
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument "${token}"; every option is a --flag`);
    }
    const equals = token.indexOf('=');
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (!known.has(name)) {
      throw new Error(
        `unknown option "--${name}"; known options are ${allowed.map((f) => `--${f}`).join(', ')}`,
      );
    }
    if (equals !== -1) {
      flags.set(name, token.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(name, 'true');
      continue;
    }
    flags.set(name, next);
    index += 1;
  }
  return { flags };
}

export function intArg(args: BenchArgs, name: string, fallback: number): number {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} needs a positive integer, got "${raw}"`);
  }
  return parsed;
}

export function boolArg(args: BenchArgs, name: string, fallback: boolean): boolean {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  if (raw === 'true' || raw === 'on' || raw === 'yes') return true;
  if (raw === 'false' || raw === 'off' || raw === 'no') return false;
  throw new Error(`--${name} needs on/off, got "${raw}"`);
}

export function stringArg(args: BenchArgs, name: string, fallback: string): string {
  return args.flags.get(name) ?? fallback;
}

export function choiceArg<T extends string>(
  args: BenchArgs,
  name: string,
  choices: readonly T[],
  fallback: T,
): T {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  const found = choices.find((choice) => choice === raw);
  if (found === undefined) {
    throw new Error(`--${name} must be one of ${choices.join(', ')}, got "${raw}"`);
  }
  return found;
}
