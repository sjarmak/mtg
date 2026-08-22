/**
 * `npm run lab` — put a real deck in front of a person.
 *
 * Resolves a deck artifact, stages it where the web app can fetch it, and
 * starts Vite. The shape is `play.ts`'s exactly: a Node-side tool writes a
 * static file, the browser fetches it, and there is no HTTP API anywhere in
 * this repo. Nothing here needs an API key, a network or the 656 MB card store
 * — the last-resort deck is the committed artifact, which carries its own art
 * URLs, so a clean checkout renders immediately.
 *
 * The resolution and its failure messages live in `resolve-deck.ts` so they can
 * be tested. This file is the part that touches the process.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDeck } from './resolve-deck';
import type { DeckCandidate, ResolvedDeck } from './resolve-deck';
import { DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import { SYMBOL_DIR } from '../src/card/symbols';
import { ART_DIR, stageDeckArt } from './stage-art';
import type { StagedArt } from './stage-art';
import { describeSymbols, stageSymbols } from './stage-symbols';
import type { StagedSymbols } from './stage-symbols';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/** Where a deck is looked for, best first. */
export const DECK_CANDIDATES: readonly DeckCandidate[] = [
  {
    path: join(REPO_ROOT, 'out', 'decklab', 'deck.json'),
    what: 'the most recent `decklab --artifact` run',
  },
  {
    path: join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json'),
    what: 'the committed example deck',
  },
];

function fail(message: string): never {
  process.stderr.write(`\nnpm run lab: ${message}\n\n`);
  process.exit(1);
}

/**
 * Caches the art, then writes the deck that points at it.
 *
 * The art is pulled here rather than left to the browser because the browser
 * may be somewhere else entirely — a laptop reaching this server over a tunnel
 * has its own network, and if that one cannot reach Scryfall every card renders
 * as a pending frame. `stage-art.ts` says the rest.
 */
async function stage(resolved: ResolvedDeck): Promise<StagedArt> {
  const publicDir = join(UI_ROOT, 'public');
  mkdirSync(publicDir, { recursive: true });
  const staged = await stageDeckArt(resolved.deck, {
    cacheDir: join(REPO_ROOT, DEFAULT_IMAGE_CACHE_DIR),
    publicDir: join(publicDir, ART_DIR),
  });
  writeFileSync(join(publicDir, 'deck.json'), `${JSON.stringify(staged.deck, null, 2)}\n`);
  return staged;
}

function describeArt(staged: StagedArt): string {
  const total = staged.fetched + staged.reused;
  const head =
    staged.fetched === 0
      ? `${String(total)} illustrations already in ${DEFAULT_IMAGE_CACHE_DIR}.`
      : `Fetched ${String(staged.fetched)} illustrations into ${DEFAULT_IMAGE_CACHE_DIR} (${String(staged.reused)} already there).`;
  if (staged.failures.length === 0) return head;
  return (
    `${head}\n` +
    `Could not fetch ${String(staged.failures.length)}; those keep their Scryfall URL and\n` +
    'will show the pending frame if your browser cannot reach it either:\n' +
    staged.failures.map((failure) => `  - ${failure}`).join('\n')
  );
}

/** The rules-text symbols, onto this origin; `stage-symbols.ts` says why. */
function stageSymbolSet(): Promise<StagedSymbols> {
  return stageSymbols({
    cacheDir: join(REPO_ROOT, DEFAULT_IMAGE_CACHE_DIR),
    publicDir: join(UI_ROOT, 'public', SYMBOL_DIR),
  });
}

async function main(): Promise<void> {
  const result = resolveDeck(DECK_CANDIDATES, process.argv[2]);
  if (!result.ok) fail(result.message);
  const staged = await stage(result);
  const symbols = await stageSymbolSet();

  process.stdout.write(
    `\nShowing ${String(result.cardCount)} cards — "${result.prompt}" — from ${result.what}.\n` +
      `  ${result.path}\n` +
      `${describeArt(staged)}\n` +
      `${describeSymbols(symbols)}\n\n` +
      'Opening the lab. The Deck tab renders the list with its real card art and the mana\n' +
      "base it was built to: each color's floor, its sources, and the card that set them.\n\n",
  );

  // Opened straight on the deck route: the app has four other tabs and landing
  // on Play after asking for the deck would read as the staging having failed.
  const vite = spawn('npx', ['vite', '--open', '/#/deck'], {
    cwd: UI_ROOT,
    stdio: 'inherit',
    // See `play.ts`: the symbol set is whatever the staging run achieved, and
    // `../vite.config.ts` turns this into a build-time substitution.
    env: { ...process.env, MTG_SYMBOL_SET: symbols.set },
  });
  vite.on('error', (cause: Error) => {
    fail(`could not start Vite (${cause.message}). Install dependencies at the repo root first.`);
  });
  vite.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((cause: unknown) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
