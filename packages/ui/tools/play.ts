/**
 * `npm run play` — put a playable game in front of a person.
 *
 * Resolves a set, stages it where the web app can fetch it, and starts Vite.
 * Nothing here needs an API key, a network, or Forge: the last-resort set is the
 * committed generated fixture, so a clean checkout can play immediately.
 *
 * "Needs no network" is a claim about the page as well as about this process,
 * which is why the rules-text symbols are staged here too. A symbol referenced
 * from another host draws an empty box for a viewer who cannot reach it, and
 * `stage-symbols.ts` either serves all of them from this origin or hands the
 * page the lab's own drawings and says which.
 *
 * The resolution and its failure messages live in `resolve-set.ts` so they can
 * be tested. This file is the part that touches the process.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import { SYMBOL_DIR } from '../src/card/symbols';
import { resolveSet } from './resolve-set';
import type { ResolvedSet } from './resolve-set';
import { ART_MANIFEST_FILENAME } from './stage-set-art';
import { cardsOf, printedCardIdsOf, setCodeOf } from './set-surfaces';
import { DEFAULT_WEB_PORT, portBusyMessage, readPlayArgs, viteArgsFor } from './play-args';
import { describeArt, describeBundles, readSetLibrary, stageSetBundles } from './stage-set-bundles';
import { choosePreconFile, describePrecons, PRECON_FILENAME, preconCandidatesFor } from './stage-precons';
import type { PreconSearch } from './stage-precons';
import { describeReduction, readSetReduction } from './describe-reduction';
import { describeSymbols, stageSymbols } from './stage-symbols';
import type { StagedSymbols } from './stage-symbols';
import { describeEventLog, EVENT_LOG_FILENAME, stageEventLog } from './stage-replay';
import type { LabDeal } from './stage-replay';
import {
  chooseRunLog,
  describeRunLog,
  runLogCandidatesFor,
  RUN_LOG_FILENAME,
  writeRunLog,
} from './stage-run-log';
import type { RunLogSearch } from './stage-run-log';
import { buildThenStagePlayDocuments } from './stage-calibration-command';

/**
 * Whether something already answers on this port.
 *
 * Asked by binding rather than by connecting: a listener that accepts and never
 * replies would pass a connect test, and what matters here is only whether Vite
 * will be able to take the port a moment from now. Any bind error other than
 * `EADDRINUSE` is left for Vite to report in its own words.
 */
async function portIsBusy(port: number): Promise<boolean> {
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
    probe.listen(port, '0.0.0.0');
  });
}

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

export { SET_CANDIDATES } from './set-candidates';
import { flagshipOnly, LIBRARY_CANDIDATES, SET_CANDIDATES } from './set-candidates';

function fail(message: string): never {
  process.stderr.write(`\nnpm run play: ${message}\n\n`);
  process.exit(1);
}

/**
 * Stages the preconstructed decks cut from this set, when there are any.
 *
 * The stale case is handled the way the art manifest's is and for a stronger
 * reason: a `precons.json` left in `public/` from a previous set would offer a
 * picker whose every deck fails to resolve, so the file is removed when nothing
 * matches. `choosePreconFile` has already refused any candidate this set does
 * not print in full.
 */
function stagePrecons(set: ResolvedSet): PreconSearch {
  const target = join(UI_ROOT, 'public', PRECON_FILENAME);
  const search = choosePreconFile(preconCandidatesFor(set.path, REPO_ROOT), printedCardIdsOf(set));
  if (search.chosen === null) {
    rmSync(target, { force: true });
    return search;
  }
  writeFileSync(target, search.chosen.json);
  return search;
}

/**
 * Stages the statistics log the Analysis tab summarizes, when one is this set's.
 *
 * The third staging step with a stale case, and the one that went unhandled
 * longest: a committed three-game slice of a *Tideglass* run was served under
 * whatever set the lab opened, so the flagship's Analysis tab reported another
 * set's games and the shell badge carried the count on every route.
 * `stage-run-log.ts` argues the rule; this is the file removal, which is the
 * half that makes the empty state honest rather than optional.
 */
function stageRunLog(set: ResolvedSet): RunLogSearch {
  const target = join(UI_ROOT, 'public', RUN_LOG_FILENAME);
  const search = chooseRunLog(runLogCandidatesFor(set.path, REPO_ROOT), setCodeOf(set));
  writeRunLog(target, search);
  return search;
}

/**
 * The set's own decks for the Replay tab to record, when it has any.
 *
 * `stagePrecons` has already refused a file this set does not print in full, so
 * the deal is whatever it chose. No precons is not a failure: `stageEventLog`
 * falls back to the fixture decks and says so.
 */
function dealFor(set: ResolvedSet, precons: PreconSearch): LabDeal | undefined {
  const code = setCodeOf(set);
  if (precons.chosen === null || code === null) return undefined;
  return { setCode: code, cards: cardsOf(set), precons: precons.chosen.file };
}

/**
 * The rules-text symbols, onto this origin.
 *
 * Run for the same reason the art is: the browser looking at this page may be
 * on another network entirely. `stage-symbols.ts` says the rest, including why
 * a partial stage is refused in favor of the lab's own drawings.
 */
function stageSymbolSet(): Promise<StagedSymbols> {
  return stageSymbols({
    cacheDir: join(REPO_ROOT, DEFAULT_IMAGE_CACHE_DIR),
    publicDir: join(UI_ROOT, 'public', SYMBOL_DIR),
  });
}

async function main(): Promise<void> {
  const args = readPlayArgs(process.argv.slice(2));
  const named = args.set;
  // A named path plays whatever it names, including the prototype. That is the
  // whole escape hatch, and it is why the filter is not applied to it.
  const candidates = named === undefined ? flagshipOnly(SET_CANDIDATES) : SET_CANDIDATES;
  const result = resolveSet(candidates, named);
  if (!result.ok) fail(result.message);
  const calibration = buildThenStagePlayDocuments(result, join(UI_ROOT, 'public'));
  // Every set on disk, not only the one this run opens. The resolution above is
  // still the whole of what a filter and a named path decide; what changed is
  // that the sets it did not pick are staged beside the one it did, so the page
  // can be switched to them without another server. `stage-set-bundles.ts`
  // argues the bundle and its raster keying.
  const library = readSetLibrary(LIBRARY_CANDIDATES, result);
  const bundles = await stageSetBundles(library, join(UI_ROOT, 'public'), REPO_ROOT, args.artManifest);
  // Nothing writes the flat manifest any more; a copy left by an older launcher
  // run beside a fresh index is another set's art under this set's card ids,
  // which is the exact failure the bundle exists to end.
  rmSync(join(UI_ROOT, 'public', ART_MANIFEST_FILENAME), { force: true });
  const selected = bundles.bundles.find((bundle) => bundle.row.stem === bundles.index.selected);
  const precons = stagePrecons(result);
  const symbols = await stageSymbolSet();
  // The Analysis tab's statistics log, chosen rather than produced: a run that
  // would yield one is thousands of games, so this either finds this set's or
  // clears the last set's and lets the tab say nothing was measured.
  const runLog = stageRunLog(result);
  // The Replay tab's log, played through the kernel here rather than committed;
  // `stage-replay.ts` says why. Half a second at most, and the only staging
  // step that needs nothing from outside this repository.
  const events = stageEventLog(join(UI_ROOT, 'public', EVENT_LOG_FILENAME), dealFor(result, precons));
  // Printed before anything else the staging run did, because it changes what
  // every later line means: 123 cards from a reduced M11 is a complete stage of
  // an incomplete set, and a reader who does not know that reads the sheet
  // depths as a bug. An ordinary set has no reduction record and prints nothing.
  const reduction = describeReduction(readSetReduction(result));

  process.stdout.write(
    `\nPlaying ${String(result.cardCount)} cards from ${result.what}.\n` +
      `  ${result.path}\n` +
      (reduction === '' ? '' : `${reduction}\n`) +
      `${calibration.summary}\n` +
      `${selected === undefined ? '' : `${describeArt(selected.art)}\n`}` +
      `${describeBundles(bundles)}\n` +
      `${describePrecons(precons)}\n` +
      `${describeSymbols(symbols)}\n` +
      `${describeRunLog(runLog)}\n` +
      `${describeEventLog(events)}\n\n` +
      (precons.chosen === null
        ? 'Opening the lab. The Play tab deals a sealed pool: build a deck, then start a game\n' +
          'against a bot that opened its own packs. No API key and no Forge required.\n\n'
        : 'Opening the lab. The Play tab offers the preconstructed decks: pick one, pick what\n' +
          'sits across the table, and play. A sealed pool is one button away. No API key and\n' +
          'no Forge required.\n\n'),
  );

  // `MTG_WEB_PORT` is set by `netplay.ts`, which prints the port in two links
  // before Vite starts. Vite's own behavior when a port is taken is to move to
  // the next free one and say so on a line nobody reads, which would make those
  // links quietly wrong; `--strictPort` turns that into a refusal instead, and
  // `../vite.config.ts` sets it for every run rather than only that one, because
  // walking upward from 5273 lands on the netplay server's port.
  //
  // So a busy port stops this launcher, and the stack trace Vite prints about it
  // says nothing about the reason it is busy. Asking first turns the usual case
  // — a lab still open in another terminal — into a sentence naming the address
  // that is already serving what this run just staged.
  const webPort = args.port === undefined ? process.env['MTG_WEB_PORT'] : String(args.port);
  const port = webPort === undefined ? DEFAULT_WEB_PORT : Number(webPort);
  if (Number.isInteger(port) && (await portIsBusy(port))) fail(portBusyMessage(port));
  const viteArgs = viteArgsFor(webPort);
  const vite = spawn('npx', viteArgs, {
    cwd: UI_ROOT,
    stdio: 'inherit',
    // The set the page paints with, decided by what the staging run achieved
    // rather than compiled in; `../vite.config.ts` turns it into a substitution.
    env: { ...process.env, MTG_SYMBOL_SET: symbols.set },
  });
  vite.on('error', (cause: Error) => {
    fail(`could not start Vite (${cause.message}). Install dependencies at the repo root first.`);
  });
  vite.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

// Run only when this file is the process entrypoint. A test that imports one
// function from here used to run the whole launcher inside the test worker: it
// found no set, called `fail`, and vitest reported an unhandled
// `process.exit(1)` against a file whose own tests all passed.
const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((cause: unknown) => {
    fail(cause instanceof Error ? cause.message : String(cause));
  });
}
