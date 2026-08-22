import { resolve } from 'node:path';
import { newSeed } from '../src/routes/play/seed';
import { takeArtManifestArg } from './play-args';

const DEFAULT_API_PORT = 5274;
const DEFAULT_WEB_PORT = 5273;

export interface NetplayArgs {
  readonly set: string | undefined;
  readonly artManifest: string | undefined;
  readonly apiPort: number;
  readonly webPort: number;
  readonly seed: string;
  readonly names: readonly [string, string];
  readonly decks: string | undefined;
}

export interface NetplayArgOptions {
  /** The operator's directory, before netplay starts play from the UI package. */
  readonly cwd?: string;
}

function readPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${value} is not a port`);
  return port;
}

/** Flags for `npm run netplay`, including the manifest passed through to play. */
export function readNetplayArgs(argv: readonly string[], options: NetplayArgOptions = {}): NetplayArgs {
  const extracted = takeArtManifestArg(argv);
  let set: string | undefined;
  let apiPort = DEFAULT_API_PORT;
  let webPort = DEFAULT_WEB_PORT;
  // A launcher with no `--seed` deals a fresh table, and the seed it draws is
  // random rather than the clock. Two runs a millisecond apart were the same
  // game under `Date.now()`, which is not a thing a person does by hand but is
  // exactly what a test or a script that starts two tables does. Drawn through
  // the one unseeded call in the package (`play/seed.ts`) so the lab and the
  // wire agree about what a fresh seed is and what it looks like written down.
  let seed = newSeed('netplay');
  let names: readonly [string, string] = ['Seat one', 'Seat two'];
  let decks: string | undefined;
  for (let index = 0; index < extracted.argv.length; index += 1) {
    const flag = extracted.argv[index];
    const value = extracted.argv[index + 1];
    if (flag === undefined) continue;
    if (!flag.startsWith('--')) {
      set = flag;
      continue;
    }
    if (value === undefined) throw new Error(`${flag} needs a value`);
    index += 1;
    if (flag === '--set') set = value;
    else if (flag === '--seed') seed = value;
    else if (flag === '--decks') decks = value;
    else if (flag === '--api-port') apiPort = readPort(value);
    else if (flag === '--web-port') webPort = readPort(value);
    else if (flag === '--names') {
      const [first, second] = value.split(',');
      if (first === undefined || second === undefined) {
        throw new Error('--names takes two names separated by a comma');
      }
      names = [first.trim(), second.trim()];
    } else throw new Error(`${flag} is not a flag this launcher has`);
  }
  const artManifest =
    extracted.artManifest === undefined
      ? undefined
      : resolve(options.cwd ?? process.cwd(), extracted.artManifest);
  return { set, artManifest, apiPort, webPort, seed, names, decks };
}
