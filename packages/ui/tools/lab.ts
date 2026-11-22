/**
 * `npm run lab` — put a real deck in front of a person.
 *
 * Resolves a deck artifact, stages it where the web app can fetch it, and
 * starts Vite. The shape is `play.ts`'s exactly: a Node-side tool writes a
 * static file, the browser fetches it, and there is no HTTP API anywhere in
 * this repo. Nothing here needs an API key, a network or the 656 MB card store:
 * a deck artifact carries its own art URLs, and a named path opens whatever a
 * person points it at, the committed fixture included. What it will not do is
 * reach for that fixture on its own; `DECK_CANDIDATES` says why.
 *
 * The resolution and its failure messages live in `resolve-deck.ts` so they can
 * be tested. This file is the part that touches the process.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDeck } from './resolve-deck';
import type { DeckCandidate, ResolvedDeck } from './resolve-deck';
import { DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import { SYMBOL_DIR } from '../src/card/symbols';
import { ART_DIR, stageDeckArt } from './stage-art';
import type { StagedArt } from './stage-art';
import { DEFAULT_WEB_PORT, readPort, takeFeedbackModelArg, vitePortArgs } from './play-args';
import { claimPublicDir, releaseLauncherClaim } from './launcher-lock';
import { DECK_FILENAME } from './stage-deck';
import { describeSymbols, stageSymbols } from './stage-symbols';
import type { StagedSymbols } from './stage-symbols';
import { launchFeedback } from './feedback/launch';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * Where a deck is looked for, best first.
 *
 * One place, and the committed `boros-aggro` fixture is deliberately not the
 * second. It was, and what that bought was a lab that always had a deck in it:
 * a checkout that had never built one still opened on 60 real printings. What
 * it cost is that the deck the lab showed by default belonged to no set this
 * project generated, so Customize's Decks section on a session staging The
 * flagship set listed a Modern Boros list beside that set's own decks and
 * nothing said which of the two was the subject. Staging nothing is a state
 * this route already draws -- an instruction naming the command that builds
 * one -- and the section still has the staged set's written decks and the
 * builder in it.
 *
 * The fixture is still the fixture: `../test/` reads it in ten suites, and
 * `npm run lab -- packages/decklab/fixtures/decks/boros-aggro.deck.json` opens
 * it on purpose. What is gone is opening it by accident.
 */
export const DECK_CANDIDATES: readonly DeckCandidate[] = [
  {
    path: join(REPO_ROOT, 'out', 'decklab', 'deck.json'),
    what: 'the most recent `decklab --artifact` run',
  },
];

function fail(message: string): never {
  process.stderr.write(`\nnpm run lab: ${message}\n\n`);
  process.exit(1);
}

/** `play.ts`'s probe, restated: bind, and read `EADDRINUSE` as busy. */
async function portIsBusy(port: number, host: string): Promise<boolean> {
  return new Promise((resolveBusy) => {
    const probe = createServer();
    probe.once('error', (cause: NodeJS.ErrnoException) => {
      resolveBusy(cause.code === 'EADDRINUSE');
    });
    probe.once('listening', () => {
      probe.close(() => {
        resolveBusy(false);
      });
    });
    probe.listen(port, host);
  });
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
  writeFileSync(join(publicDir, DECK_FILENAME), `${JSON.stringify(staged.deck, null, 2)}\n`);
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

/**
 * An empty positional argument, read as the argument nobody gave.
 *
 * `npm run lab -- "" 5280` is how a port is stated without also naming a deck,
 * because these are positional and the deck comes first. Without this the empty
 * string reaches `resolveDeck` as a path, resolves to the repository root, and
 * fails with `EISDIR` — a message about a directory, for a command line that
 * named no directory.
 */
function blank(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

async function main(): Promise<void> {
  // A deck path and then a port, the same pair and the same order `play.ts`
  // takes, because two launchers in one repo that spell the same argument
  // differently is a thing to look up every time.
  const { argv, feedbackModel } = takeFeedbackModelArg(process.argv.slice(2));
  const port = readPort(blank(argv[1]));
  // Before the deck is resolved, for the reason `launcher-lock.ts` argues: this
  // run's art staging overwrites `public/art/` and a sibling `npm run play` is
  // serving that directory to a page it will not reload. The refusal has to come
  // before the first write, and the first write is a staging step.
  const publicDir = join(UI_ROOT, 'public');
  mkdirSync(publicDir, { recursive: true });
  const claim = claimPublicDir(publicDir, 'npm run lab', port ?? DEFAULT_WEB_PORT, new Date().toISOString());
  if (!claim.ok) fail(claim.message);
  process.on('exit', () => {
    releaseLauncherClaim(publicDir, process.pid);
  });
  const result = resolveDeck(DECK_CANDIDATES, blank(argv[0]));
  if (!result.ok) fail(result.message);
  const staged = await stage(result);
  const symbols = await stageSymbolSet();
  // The feedback server, so the Report button on this page files somewhere;
  // `feedback/plan.ts` says when this run starts one and when it attaches.
  const feedback = await launchFeedback({
    repoRoot: REPO_ROOT,
    staged: `${result.what} (${result.path})`,
    envPort: process.env['MTG_FEEDBACK_PORT'],
    portIsBusy,
    model: feedbackModel,
  });

  process.stdout.write(
    `\nShowing ${String(result.cardCount)} cards — "${result.prompt}" — from ${result.what}.\n` +
      `  ${result.path}\n` +
      `${describeArt(staged)}\n` +
      `${describeSymbols(symbols)}\n` +
      `${feedback.message}\n\n` +
      "Opening the lab. Customize's Decks section renders the list with its real card art and the mana\n" +
      "base it was built to: each color's floor, its sources, and the card that set them.\n\n",
  );

  // Opened straight on the deck route: the app has three other modes and
  // landing on Play after asking for the deck would read as the staging having
  // failed. `--strictPort` rides along with a stated port (`vitePortArgs`): a
  // lab asked for an address that quietly serves the next one up has answered a
  // different question from the one somebody asked over a tunnel. The route
  // stays next to `--open`, which takes it as its value.
  const vite = spawn('npx', ['vite', '--open', '/#/customize/decks', ...vitePortArgs(port)], {
    cwd: UI_ROOT,
    stdio: 'inherit',
    // See `play.ts`: the symbol set is whatever the staging run achieved, and
    // `../vite.config.ts` turns this into a build-time substitution.
    env: { ...process.env, MTG_SYMBOL_SET: symbols.set, ...feedback.env },
  });
  vite.on('error', (cause: Error) => {
    void feedback.close().finally(() => {
      fail(`could not start Vite (${cause.message}). Install dependencies at the repo root first.`);
    });
  });
  vite.on('exit', (code) => {
    void feedback.close().finally(() => {
      process.exit(code ?? 0);
    });
  });
}

main().catch((cause: unknown) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
