/**
 * `npm run play` — put a playable game in front of a person.
 *
 * Resolves a set, stages it where the web app can fetch it, and starts Vite.
 * Nothing here needs an API key or a network: the last-resort set is the
 * committed generated fixture, so a clean checkout can play immediately. When
 * the pinned Forge runtime is installed, this launcher also exposes it through
 * the bounded backend gateway for the printed Legacy Cube route; without it,
 * that route reports the missing backend by name.
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
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import type { GameplayRecorder, ObservedDealer, RunningBackendGateway, RunningServer } from '@mtg/netplay';
import { SYMBOL_DIR } from '../src/card/symbols';
import { SET_ICON_DIR } from '../src/card/set-icon';
import { resolveSet } from './resolve-set';
import type { ResolvedSet } from './resolve-set';
import { ART_MANIFEST_FILENAME } from './stage-set-art';
import { clearStagedFlatArt, describeClearedFlatArt } from './stage-art';
import { cardsOf, printedCardIdsOf, setCodeOf } from './set-surfaces';
import { DEFAULT_WEB_PORT, portBusyMessage, readPlayArgs, viteArgsFor } from './play-args';
import { readBackendPort, startBackendService } from './backend-service';
import type { ObservedFormats } from './backend-service';
import { observedDealer } from './observed-dealer';
import type { SeatFormat } from './observed-dealer';
import { gameplayDir, resolveDataDir } from './data-path';
import { setIdentitySources } from './gameplay-identity';
import { gameplayRecorder } from './gameplay-recorder';
import { startPlayServices } from './play-services';
import { describeArt, describeBundles, readSetLibrary, stageSetBundles } from './stage-set-bundles';
import { describeReferenceRefresh, refreshReferenceSets } from './refresh-reference';
import { choosePreconFile, describePrecons, PRECON_FILENAME, preconCandidatesFor } from './stage-precons';
import type { PreconSearch } from './stage-precons';
import { describeSetReduction } from './describe-reduction';
import { claimPublicDir, releaseLauncherClaim } from './launcher-lock';
import { clearStagedDeck, describeClearedDeck } from './stage-deck';
import { DEFAULT_DECK_PORT, deckLibraryArgv, planDeckServer } from './deck-server';
import type { DeckServerPlan } from './deck-server';
import { launchFeedback } from './feedback/launch';
import { describeSymbols, stageSymbols } from './stage-symbols';
import type { StagedSymbols } from './stage-symbols';
import {
  describeSetIcons,
  printedCatalogIconRoster,
  setIconRoster,
  setIconsEnv,
  stageSetIcons,
} from './stage-set-icons';
import type { StagedSetIcons } from './stage-set-icons';
import { describeEventLog, EVENT_LOG_FILENAME, stageEventLog } from './stage-replay';
import { describeEvidence, stageEvidence } from './stage-evidence';
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
import { startTableService } from './table-service';
import { stagePrintedFormats } from './stage-printed-formats';
import { describePrintedReleaseDates, storeReleaseDates } from './printed-release-dates';
import { buildInstalledPrintedDraftRatings, describePrintedDraftRatings } from './printed-draft-ratings';
import {
  deckWinRatesPath,
  describeDeckWinRates,
  describeHeadToHead,
  headToHeadPath,
  readDeckWinRates,
  readHeadToHead,
} from './stage-deck-win-rates';
import { installedPrintedAdmissions, stageableFormats } from './printed-format-registry';
import type { loadPrintedAdmissionSource } from './printed-format-registry';
import {
  describeLegacyCubeStage,
  LEGACY_CUBE_CATALOG_FILENAME,
  LEGACY_CUBE_FORGE_READY_FILENAME,
  LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME,
  describeLegacyCubeTokenStage,
  stageLegacyCubeTokenPrintings,
  stageLegacyCubeCatalog,
  stageLegacyCubeForgeReadyPool,
} from './stage-legacy-cube';

/**
 * Whether something already answers on this port.
 *
 * Asked by binding rather than by connecting: a listener that accepts and never
 * replies would pass a connect test, and what matters here is only whether Vite
 * will be able to take the port a moment from now. Any bind error other than
 * `EADDRINUSE` is left for Vite to report in its own words.
 */
async function portIsBusy(port: number, host = '0.0.0.0'): Promise<boolean> {
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

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

export { SET_CANDIDATES } from './set-candidates';
import { flagshipOnly, libraryCandidates, SET_CANDIDATES } from './set-candidates';

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
 * The set's own decks for Analysis's Replay section to record, when it has any.
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
 * The game server this lab deals LAN tables from, or null when one already runs.
 *
 * Started here so that *Play over LAN* is a button rather than a second command
 * in a second terminal, which is what the playtester asked for and what the shipped
 * arrangement was not. It binds **127.0.0.1** and is reached from the other
 * machine only through Vite's `/api` proxy, exactly as `npm run netplay`'s does;
 * nothing about what is exposed changes, and `@mtg/netplay`'s header carries the
 * argument about the one route on it that takes no token.
 *
 * Port 0, so the operating system picks a free one and the number is handed to
 * Vite below. A fixed default would collide with the netplay launcher's on a
 * machine running both, and the page never learns the number anyway — it talks
 * to `/api` on its own origin.
 *
 * Null when `MTG_NETPLAY_PORT` is already set, which means `netplay.ts` spawned
 * this process and its server is holding a table it already dealt and printed
 * links for. That server deals nothing on request, so the Play page there says a
 * table is running rather than offering to start a second one.
 *
 * Three dealers, because there are three games to start: a table whose decks are
 * already built, a room the two people cut their own decks in, and a room they
 * draft those decks out of first. The page reads which of them this server
 * offers off `/api/health` rather than assuming a server that deals also rooms
 * or drafts — a lab older than the build screen answers the first and 404s the
 * other two, and that is a state somebody is running today.
 */
async function startTableServer(
  set: ResolvedSet,
  precons: PreconSearch,
  webPort: number,
  recorder: GameplayRecorder,
  observed: ObservedDealer | undefined,
): Promise<RunningServer | null> {
  if (process.env['MTG_NETPLAY_PORT'] !== undefined) return null;
  return startTableService({
    set,
    precons,
    webPort,
    port: 0,
    recorder,
    ...(observed === undefined ? {} : { observed }),
  });
}

/**
 * The server that keeps the decks somebody saves, when this run is the one to
 * start it.
 *
 * Spawned rather than imported: `@mtg/ui` may not depend on `@mtg/decklab`,
 * which reaches `better-sqlite3` through `@mtg/data`. `./deck-server.ts` argues
 * the ownership rule and the port, and the launcher it names has no build route
 * at all, so nothing started here can spend model budget.
 *
 * Its failure is not this lab's failure. A page whose saves do not persist is
 * worse than one that never offered to save, but it is still a lab somebody can
 * play a game in, and taking the whole run down over a port would be the wrong
 * trade. So a child that dies says so on stdout and Vite keeps serving.
 */
function startDeckLibrary(plan: DeckServerPlan): ChildProcess | null {
  if (plan.kind !== 'start') return null;
  const child = spawn('npx', deckLibraryArgv(REPO_ROOT, plan.port), {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  child.on('error', (cause: Error) => {
    process.stdout.write(`\nThe deck library did not start (${cause.message}); decks will not save.\n`);
  });
  child.on('exit', (code) => {
    if (code === 0 || code === null) return;
    process.stdout.write(`\nThe deck library stopped (exit ${String(code)}); decks will not save.\n`);
  });
  return child;
}

/**
 * The backend-neutral HTTP endpoint used only by the printed-cube journey.
 *
 * The Forge adapter remains a separately executed JVM. When its pinned
 * artifact is absent, the gateway still starts and reports the selected
 * backend as missing instead of turning one browser click into a fetch error.
 */
interface BackendStage {
  readonly gateway: RunningBackendGateway | null;
  readonly message: string;
  /** What a LAN Forge table opens its game on; null when this run has no observed backend. */
  readonly observed: ObservedFormats | null;
  readonly close: () => Promise<void>;
}

/**
 * The LAN Forge dealer over the started backend, or nothing when a configured
 * gateway elsewhere owns the backend: that process holds the Forge session and
 * this one cannot seat a table on a backend it does not have.
 */
function observedDealerFor(
  backend: BackendStage,
  webPort: number,
  printed: readonly SeatFormat[],
  recorder: GameplayRecorder,
): ObservedDealer | undefined {
  if (backend.observed === null) return undefined;
  return observedDealer({
    backend: backend.observed.backend,
    formats: backend.observed.formats,
    printed,
    webPort,
    interfaces: networkInterfaces,
    mint: randomUUID,
    // A LAN table is the third way a game finishes here, and it is kept like
    // the other two. The table hands over the game unprojected and says
    // nothing about which arm saw it, so the source is added here: this one is
    // the table server's, not the gateway's (`@mtg/netplay`'s `gameplay.ts`).
    onFinished: (capture) => {
      void recorder.record({ source: 'netplay-forge', ...capture });
    },
    // mtg-72fjo: a table that ends without a result (backend-failure, timeout,
    // disconnect, a seat leaving) already tells both seats through their own
    // polled frame; this is the launcher's own copy of that failure, so a
    // wedged LAN game leaves a line here instead of nothing at all.
    onEnded: (table, reason, message) => {
      if (reason !== 'backend-failure') return;
      process.stderr.write(`\nnpm run play: LAN table ${table.id} ended (${reason}): ${message}\n\n`);
    },
  });
}

async function startBackendServer(
  printedAdmissions: readonly NonNullable<ReturnType<typeof loadPrintedAdmissionSource>>[],
  recorder: GameplayRecorder,
): Promise<BackendStage> {
  if (process.env['MTG_BACKEND_GATEWAY_PORT'] !== undefined) {
    readBackendPort(['--port', process.env['MTG_BACKEND_GATEWAY_PORT']]);
    return {
      gateway: null,
      message: `Legacy Cube backend: using the configured gateway on port ${process.env['MTG_BACKEND_GATEWAY_PORT']}.`,
      observed: null,
      close: () => Promise.resolve(),
    };
  }
  return startBackendService({
    repoRoot: REPO_ROOT,
    port: 0,
    printedAdmissions,
    recorder,
  });
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

/**
 * The official sets' icons, onto this origin, for the seal on every face.
 *
 * The roster is what this run staged and nothing else: the set library's
 * official rows and every printed format's catalogs. `stage-set-icons.ts` says
 * why a custom set is never asked for and why one missing icon costs one set.
 */
function stageSetIconSet(codes: readonly string[]): Promise<StagedSetIcons> {
  return stageSetIcons({
    codes,
    cacheDir: join(REPO_ROOT, DEFAULT_IMAGE_CACHE_DIR),
    publicDir: join(UI_ROOT, 'public', SET_ICON_DIR),
  });
}

async function main(): Promise<void> {
  const args = readPlayArgs(process.argv.slice(2));
  // Resolved here rather than beside the busy-port check further down, because
  // the claim below is the first thing this run does and it has to say where
  // this page would be. `MTG_WEB_PORT` is `netplay.ts`, which spawned this
  // process after printing that number in two links.
  const webPort = args.port === undefined ? process.env['MTG_WEB_PORT'] : String(args.port);
  const port = webPort === undefined ? DEFAULT_WEB_PORT : Number(webPort);
  // Before the set is even resolved: staging clears a sibling launcher's deck
  // and art out from under a page it is still serving, so the refusal has to
  // come before the first thing that deletes. `launcher-lock.ts` argues it.
  const publicDir = join(UI_ROOT, 'public');
  mkdirSync(publicDir, { recursive: true });
  const claim = claimPublicDir(publicDir, 'npm run play', port, new Date().toISOString());
  if (!claim.ok) fail(claim.message);
  process.on('exit', () => {
    releaseLauncherClaim(publicDir, process.pid);
  });
  const named = args.set;
  // A named path plays whatever it names, including the prototype. That is the
  // whole escape hatch, and it is why the filter is not applied to it.
  const candidates = named === undefined ? flagshipOnly(SET_CANDIDATES) : SET_CANDIDATES;
  const result = resolveSet(candidates, named);
  if (!result.ok) fail(result.message);
  const { formats: installedFormats, admissions: printedAdmissions } = installedPrintedAdmissions(REPO_ROOT);
  const printedReleaseDates = storeReleaseDates(
    REPO_ROOT,
    installedFormats.flatMap((format) => format.catalogs.map((catalog) => catalog.code)),
  );
  const stageable = stageableFormats(installedFormats, printedReleaseDates.storePresent);
  const printedFormats = stageable.kept;
  const printedDraftRatings = await buildInstalledPrintedDraftRatings(printedFormats);
  const deckWinRates = readDeckWinRates(deckWinRatesPath(REPO_ROOT));
  const headToHead = readHeadToHead(headToHeadPath(REPO_ROOT));
  const printedIndex = await stagePrintedFormats(printedFormats, publicDir, {
    releaseDateOf: printedReleaseDates.releaseDateOf,
    draftRatings: printedDraftRatings.artifacts,
    ...(deckWinRates === undefined ? {} : { deckWinRates }),
    ...(headToHead === undefined ? {} : { headToHead }),
  });
  const legacyCube = await stageLegacyCubeCatalog(
    join(REPO_ROOT, 'packages', 'data', 'data', LEGACY_CUBE_CATALOG_FILENAME),
    join(publicDir, LEGACY_CUBE_CATALOG_FILENAME),
  );
  const legacyCubeForgeReady = await stageLegacyCubeForgeReadyPool(
    join(REPO_ROOT, 'packages', 'data', 'data', LEGACY_CUBE_CATALOG_FILENAME),
    join(REPO_ROOT, 'packages', 'data', 'data', 'legacy-cube-2021-forge-decisions-v1.json'),
    join(publicDir, LEGACY_CUBE_FORGE_READY_FILENAME),
  );
  const legacyCubeTokens = await stageLegacyCubeTokenPrintings(
    join(REPO_ROOT, 'packages', 'data', 'data', LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME),
    join(publicDir, LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME),
  );
  const calibration = buildThenStagePlayDocuments(result, publicDir);
  // Every set on disk, not only the one this run opens. The resolution above is
  // still the whole of what a filter and a named path decide; what changed is
  // that the sets it did not pick are staged beside the one it did, so the page
  // can be switched to them without another server. `stage-set-bundles.ts`
  // argues the bundle and its raster keying.
  // Before the library is read, not after: `referenceSetCandidates` walks
  // `out/reference`, and what belongs there is what the emitter produces today
  // rather than whatever the last run of it left. `refresh-reference.ts` argues
  // the cost and every failure it swallows.
  const reference = refreshReferenceSets(REPO_ROOT);
  const library = readSetLibrary(libraryCandidates(REPO_ROOT), result);
  // One recorder for every server this run starts, built over every set it
  // staged: a finished game names its set by the cards it was dealt from, and
  // the page can be switched to any set in the library without another server.
  const gameplayRoot = resolveDataDir(gameplayDir(REPO_ROOT), REPO_ROOT);
  const recorder = gameplayRecorder({ root: gameplayRoot, sets: setIdentitySources(library.entries) });
  const bundles = await stageSetBundles(library, publicDir, REPO_ROOT, args.artManifest);
  // Nothing writes the flat manifest any more; a copy left by an older launcher
  // run beside a fresh index is another set's art under this set's card ids,
  // which is the exact failure the bundle exists to end.
  rmSync(join(publicDir, ART_MANIFEST_FILENAME), { force: true });
  // And the directory it named. Clearing the manifest without the rasters left
  // every older run's copy on disk for good — `stage-art.ts` argues the rest.
  const clearedFlatArt = describeClearedFlatArt(clearStagedFlatArt(publicDir));
  const selected = bundles.bundles.find((bundle) => bundle.row.stem === bundles.index.selected);
  const precons = stagePrecons(result);
  const symbols = await stageSymbolSet();
  const setIcons = await stageSetIconSet(
    setIconRoster(
      bundles.bundles.map((bundle) => bundle.row),
      printedCatalogIconRoster(printedFormats, publicDir),
    ),
  );
  // The Analysis tab's statistics log, chosen rather than produced: a run that
  // would yield one is thousands of games, so this either finds this set's or
  // clears the last set's and lets the tab say nothing was measured.
  const runLog = stageRunLog(result);
  // A deck artifact staged by an earlier `npm run lab`, which Customize's Decks
  // section would otherwise offer beside this set's own decks. `stage-deck.ts` argues
  // why that one is removed outright rather than searched for a match.
  const clearedDeck = describeClearedDeck(clearStagedDeck(publicDir));
  // The Replay section's log, played through the kernel here rather than committed;
  // `stage-replay.ts` says why. Half a second at most, and the only staging
  // step that needs nothing from outside this repository.
  const events = stageEventLog(join(publicDir, EVENT_LOG_FILENAME), dealFor(result, precons));
  // The Analysis tab's evidence section: every ledger under `out/` and every
  // recorded game under `data/gameplay/`, scanned into one file. Metadata only,
  // except a trials file whose comparison was never written; `stage-evidence.ts`
  // says what that costs and how it is bounded.
  const evidence = await stageEvidence(
    join(REPO_ROOT, 'out'),
    join(REPO_ROOT, 'data', 'gameplay'),
    publicDir,
  );
  // Printed before anything else the staging run did, because it changes what
  // every later line means: 123 cards from a reduced M11 (a count it once had)
  // is a complete stage of an incomplete set, and a reader who does not know
  // that reads the sheet depths as a bug. An ordinary set has no reduction
  // record and prints nothing; a build that dropped nothing says it is whole.
  const reduction = describeSetReduction(result);

  process.stdout.write(
    `\nPlaying ${String(result.cardCount)} cards from ${result.what}.\n` +
      `  ${result.path}\n` +
      (reduction === '' ? '' : `${reduction}\n`) +
      `${calibration.summary}\n` +
      `${selected === undefined ? '' : `${describeArt(selected.art)}\n`}` +
      `${describeBundles(bundles)}\n` +
      `${describeReferenceRefresh(reference)}\n` +
      `${describePrecons(precons)}\n` +
      `${describeSymbols(symbols)}\n` +
      `${describeSetIcons(setIcons)}\n` +
      `${describePrintedDraftRatings(printedDraftRatings)}\n` +
      `${describeDeckWinRates(deckWinRates, printedIndex)}\n` +
      `${describeHeadToHead(headToHead, printedIndex)}\n` +
      `${describePrintedReleaseDates(printedIndex, printedReleaseDates)}\n` +
      (stageable.skipped.length === 0
        ? ''
        : `Printed formats skipped, because their catalog is built from the card store (data/store/mtg.sqlite) and this checkout has none: ${stageable.skipped.join(', ')}.\n`) +
      `${describeRunLog(runLog)}\n` +
      `${describeEventLog(events)}\n` +
      `${describeEvidence(evidence)}\n` +
      `${describeLegacyCubeStage(legacyCube)}\n` +
      `Legacy Cube Forge-ready pool: ${String(legacyCubeForgeReady.cards)} accepted cards, ${String(legacyCubeForgeReady.seats)} seats (Forge ${legacyCubeForgeReady.forgeVersion}).\n` +
      `${describeLegacyCubeTokenStage(legacyCubeTokens)}\n` +
      (clearedFlatArt === '' ? '' : `${clearedFlatArt}\n`) +
      (clearedDeck === '' ? '\n' : `${clearedDeck}\n\n`) +
      (precons.chosen === null
        ? 'Opening the lab. The Play tab deals a sealed pool: build a deck, then start a game\n' +
          'against a bot that opened its own packs. No API key and no Forge required.\n'
        : 'Opening the lab. The Play tab offers the preconstructed decks: pick one, pick what\n' +
          'sits across the table, and play. A sealed pool is one button away. No API key and\n' +
          'no Forge required.\n') +
      // Not said when `netplay.ts` spawned this process: that launcher has
      // already dealt a table and printed its links, and this one deals none.
      (process.env['MTG_NETPLAY_PORT'] === undefined
        ? 'Playing someone on this network takes no second command: the Play tab has a\n' +
          'button that deals the table and draws their link, with a code to scan.\n\n'
        : '\n'),
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
  if (Number.isInteger(port) && (await portIsBusy(port))) fail(portBusyMessage(port));
  // Decided against 127.0.0.1 rather than the wildcard, because that is where
  // the deck server binds and where Vite's proxy sends the page.
  const deckPlan = planDeckServer({
    envPort: process.env['MTG_DECK_PORT'],
    busy: await portIsBusy(DEFAULT_DECK_PORT, '127.0.0.1'),
  });
  process.stdout.write(`${deckPlan.message}\n\n`);
  // The feedback server, on the same terms as the deck server: a singleton on
  // a known port, told to Vite before Vite boots (`feedback/plan.ts`).
  const feedback = await launchFeedback({
    repoRoot: REPO_ROOT,
    staged: `${result.what} (${result.path})`,
    envPort: process.env['MTG_FEEDBACK_PORT'],
    portIsBusy,
    model: args.feedbackModel,
  });
  process.stdout.write(`${feedback.message}\n\n`);
  // Started before Vite because Vite is told its port. The page reaches it at
  // `/api` on its own origin and never learns the number.
  const services = await startPlayServices({
    startDecks: () => startDeckLibrary(deckPlan),
    startBackend: () => startBackendServer(printedAdmissions, recorder),
    startTables: (backend) =>
      startTableServer(
        result,
        precons,
        port,
        recorder,
        observedDealerFor(backend, port, printedIndex.formats, recorder),
      ),
  });
  const { tables, backend } = services;
  process.stdout.write(`${backend.message}\nRecording finished games under ${gameplayRoot}\n\n`);
  const viteArgs = viteArgsFor(webPort);
  const vite = spawn('npx', viteArgs, {
    cwd: UI_ROOT,
    stdio: 'inherit',
    // The set the page paints with, decided by what the staging run achieved
    // rather than compiled in; `../vite.config.ts` turns it into a substitution.
    env: {
      ...process.env,
      MTG_SYMBOL_SET: symbols.set,
      // The set icons that were served, named the same way and for the same reason.
      MTG_SET_ICONS: setIconsEnv(setIcons),
      ...(tables === null ? {} : { MTG_NETPLAY_PORT: String(tables.port) }),
      // Spelled even when it equals the proxy's own default, so the page and
      // this process cannot disagree about where the decks are being kept.
      MTG_DECK_PORT: String(deckPlan.port),
      ...feedback.env,
      ...(backend.gateway === null ? {} : { MTG_BACKEND_GATEWAY_PORT: String(backend.gateway.port) }),
    },
  });
  const closeAll = (): Promise<void> =>
    Promise.all([services.close(), feedback.close()]).then(() => undefined);
  vite.on('error', (cause: Error) => {
    void closeAll().then(
      () => fail(`could not start Vite (${cause.message}). Install dependencies at the repo root first.`),
      (cleanup: unknown) =>
        fail(`could not start Vite (${cause.message}); cleanup failed: ${String(cleanup)}`),
    );
  });
  vite.on('exit', (code) => {
    // The deck library is this process's child and outlives it otherwise: it is
    // a listener with nothing watching it, holding the port the next `npm run
    // play` would want.
    // Held polls keep sockets open for the length of a wait, and the backend
    // gateway holds a Forge subprocess, so both are closed rather than left to
    // the process exiting out from under them.
    void closeAll().then(
      () => {
        process.exit(code ?? 0);
      },
      (cause: unknown) => {
        fail(
          `could not shut down the play services (${cause instanceof Error ? cause.message : String(cause)})`,
        );
      },
    );
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
