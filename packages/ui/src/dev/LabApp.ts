/**
 * The reference wiring: the default views over two logs and one card list, in
 * one shell.
 *
 * This is what `vite build` builds and what `vite dev` serves. It is also the
 * worked example for the surfaces built on this package — each of them replaces
 * one entry in `views` and inherits everything else.
 *
 * # Two logs, and which tab each one answers for
 *
 * `analysisUrl` is what the Analysis tab reads: measured runs, each carrying a
 * `@mtg/metrics` health block and the fairness verdict over it, written by
 * `npm run analyze`. That tab used to summarize the statistics JSONL below
 * instead, which could say how long games ran but never whether the set was
 * fair, because the bands a gate is judged against are not in that log.
 *
 * `replayUrl` is `@mtg/sim`'s statistics JSONL: one row per game of 17lands
 * columns, per-turn aggregates and nothing per action. `AnalysisRoute` reads it
 * and is where the per-game drill-down belongs (`mtg-2ayr`); it is not the
 * Analysis tab's own input any more.
 *
 * `eventLogUrl` is the decision-level event log (`tools/record-replay.ts`): one
 * record per kernel decision, with the enumerated options, the events and a
 * board snapshot. The Replay tab reads that one, because "what happened in this
 * game" is a question about actions and the statistics log holds none — the
 * per-game view over it printed an em dash for everything it does not carry,
 * and the two views were competing for one tab on the same question with one of
 * them holding a tenth of the record. The per-game walk over the statistics log
 * now sits beside its own log, as the drill-down under the Analysis tab's Games
 * section (`../routes/analysis/game-detail.ts`), and the route that used to
 * hold it is gone: `mtg-2ayr`.
 */
import { createElement, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { GameBackend } from '@mtg/engine';
import { App } from '../app/App';
import type { UiView, UiViews } from '../app/App';
import { analysisView } from '../routes/analysis';
import type { AnalysisRunView, AnalysisRunsState } from '../routes/analysis';
import { AnalysisDataError, readAnalysisRun } from '../routes/analysis';
import { readEvidenceSnapshot } from '../routes/analysis/evidence-record';
import type { EvidenceState } from '../routes/analysis/evidence-record';
import {
  canonicalJsonText,
  classifyCalibration,
  classifyRetune,
  sha256Text,
} from '../routes/analysis/calibration-read';
import type {
  CalibrationArtifact,
  CalibrationState,
  RetuneState,
} from '../routes/analysis/calibration-model';
import type { AnalysisLogState } from '../routes/AnalysisRoute';
import { PlayRoute } from '../routes/PlayRoute';
import type { PlaySetState, PreconState } from '../routes/PlayRoute';
import type { PreconSelection } from '../routes/play/PreconGame';
import { readPreconFile } from '../lab/precon-file';
import { CardsRoute } from '../routes/CardsRoute';
import { DesignRoute } from '../routes/design/DesignRoute';
import { DECK_OPEN_PARAM } from '../routes/deck/open';
import type { CardsLibrary, CardsLibrarySet, CardsSource } from '../routes/CardsRoute';
import { useShelfPresence } from '../routes/play/built-decks';
import { DeckRoute } from '../routes/DeckRoute';
import type { DeckState } from '../routes/DeckRoute';
import { DraftRoute } from '../routes/DraftRoute';
import type { DraftSetState } from '../routes/DraftRoute';
import { httpObservedBackend } from '../net/backend-gateway';
import { useGatewayReadiness } from '../net/gateway-readiness';
import { parsePrintedTokenPrintings } from '@mtg/printed-card';
import { LegacyCubeRoute } from '../routes/legacy-cube/LegacyCubeRoute';
import { CUBE_SET_NAME, CubeCardsRoute } from '../routes/legacy-cube/CubeCardsRoute';
import {
  printedFormatRows,
  usePrintedFormatIndex,
  usePrintedSelection,
} from '../routes/printed/use-printed-format';
import { AGAINST_PARAM } from '../routes/play/availability';
import type { AvailabilityFacts } from '../routes/play/availability';
import { LanForgeStart, lanForgeSection } from '../routes/play/LanForgeStart';
import { PLAY_UNNAMED_SET, PlayLanding } from '../routes/play/PlayLanding';
import { preconLanPlay } from '../routes/printed/lan-precon';
import { PRECON_DECK_PARAM } from '../routes/printed/PrintedPreconRoute';
import { forgeFormatId, movedCommanderSource, playSources, resolvePlaySource } from '../routes/play/sources';
import type { ForgeSource } from '../routes/play/sources';
import { preconMatchRules } from '../routes/printed/precon-match';
import { useTableServer } from '../net/invite';
import { DEFAULT_TABLE_BASE } from '../routes/PlayRoute';
import {
  playOpponentProps,
  playSub,
  printedSelection,
  routeSeats,
  routeSeatsObserved,
  routeTakesThePage,
  seatParams,
} from './section-views';
import { useAdvisorCalibration } from '../routes/legacy-cube/calibration';
import type {
  LegacyCubeCatalogState,
  LegacyCubeForgeReadyState,
} from '../routes/legacy-cube/LegacyCubeRoute';
import { readLegacyCubeForgeReadyPool } from '../routes/legacy-cube/model';
import { LEGACY_CUBE_FORMAT, readLegacyCubeCatalog } from '../routes/legacy-cube/model';
import { ReplayViewer } from '../routes/replay/ReplayViewer';
import type { ReplayState } from '../routes/replay/ReplayViewer';
import { EventLogError, readEventLog } from '../routes/replay/read-log';
import { readDeckArtifact } from '../lab/deck-artifact';
import { artResolver, readArtManifest } from '../lab/art-manifest';
import type { ArtResolver } from '../lab/art-manifest';
import { readReduction, reducedNoticeText } from '../lab/reduced-notice';
import type { SetReduction } from '../lab/reduced-notice';
import { readStagedCollation } from '../lab/staged-collation';
import type { StagedCollation } from '../lab/staged-collation';
import { readSetIndex, selectedRow } from '../lab/set-index';
import type { SetIndex, StagedSetRow } from '../lab/set-index';
import { setDisplayName, setKindFact } from '../lab/set-label';
import { setKindLabel } from '../lab/set-origin';
import { SetPicker } from '../app/SetPicker';
import { useHashRoute } from '../app/router';
import type { UiRouter } from '../app/router';
import { DeckGallery } from '../routes/cards/DeckGallery';
import { readReplayLog } from '../replay/timeline';

export interface LabAppProps {
  /** URL of a statistics JSONL written by `@mtg/sim`; the Analysis tab reads it. */
  readonly replayUrl?: string;
  /**
   * URL of a decision-level event log, staged by `npm run play`. Absent leaves
   * the Replay tab naming the command that records one, which is the state of a
   * checkout that has only ever run `vite dev`.
   */
  readonly eventLogUrl?: string;
  readonly cards: readonly DslCard[];
  /**
   * URL of a set document to deal sealed packs from, staged by `npm run play`.
   * Absent or missing falls back to dealing from `cards`, which keeps the dev
   * server useful without a generated set — and says so on the tab, because a
   * pool nobody can tell apart from the staged one is `mtg-c4h`.
   *
   * The fallback for a page with no staged *index*: when `setIndexUrl` resolves,
   * every set url on this page comes off the selected row instead.
   */
  readonly setUrl?: string;
  /**
   * URL of the staged set index, written by `npm run play` alongside the
   * bundles it stages. Its rows carry the set, art and precon urls for each
   * staged set, and the shell draws a picker over them.
   *
   * Absent or missing leaves this component exactly as it was: the flat
   * `setUrl`/`artUrl`/`preconUrl` props, and no picker. That is the state of a
   * plain `vite dev`, and of a page staged by a launcher older than the index.
   */
  readonly setIndexUrl?: string;
  /**
   * URL of a deck artifact, staged by `npm run lab`. Absent or missing leaves
   * the Deck tab telling you how to stage one, which is the normal state of a
   * checkout that has only ever run `npm run play`.
   */
  readonly deckUrl?: string;
  /**
   * URL of a precon document for the staged set, staged by `npm run play`.
   * Absent or missing leaves the Play tab exactly as it was: a sealed pool and
   * nothing else, which is the state of a set nobody has written decks for.
   */
  readonly preconUrl?: string;
  /**
   * URL of an art manifest for the staged set, staged by `npm run play`. Absent
   * or missing renders every card's pending frame, which is the honest state of
   * a set whose art has not been generated.
   */
  readonly artUrl?: string;
  /**
   * URL of the analysis documents, written by `npm run analyze`. Absent or
   * missing leaves the Analysis tab naming that command, which is the state of
   * a checkout that has never measured a set.
   */
  readonly analysisUrl?: string;
  /** Checked static reference evidence staged for the same set by `npm run play`. */
  readonly calibrationUrl?: string;
  /** Optional before/after proposal; a missing file is an explicit absent state. */
  readonly retuneUrl?: string;
  /**
   * The evidence snapshot `npm run play` scans from the ledgers under `out/`
   * and the recorded games under `data/gameplay/`. Absent or missing leaves the
   * Analysis tab's evidence section naming the command that writes it.
   */
  readonly evidenceUrl?: string;
  /** Portable printed-card artifact staged independently of executable set.json. */
  readonly legacyCubeUrl?: string;
  readonly printedFormatIndexUrl?: string;
  readonly legacyCubeCalibrationUrl?: string;
  /** Read-only admission projection staged beside the printed-card artifact. */
  readonly legacyCubeForgeReadyUrl?: string;
  /** The token sheet staged beside the catalog; without it no cube token draws its art. */
  readonly legacyCubeTokensUrl?: string;
  /** Injectable in tests; the page ordinarily uses the observed HTTP Forge gateway. */
  readonly legacyCubeBackend?: GameBackend;
  readonly title?: string;
}

/**
 * What the play tab says over a pool it opened from the example cards.
 *
 * A checkout that has never staged a set is a real and ordinary state, and the
 * lab is worth opening in it: the DSL's example cards fill six boosters and play
 * a whole game. What is not acceptable is that pool being indistinguishable from
 * the staged one, which is what `mtg-c4h` was — so the tab names the cards it
 * dealt and the command that stages a real set, and `npm run play` prints every
 * place it looked for one on the way past.
 */
const STAND_IN_HINT =
  'No set is staged, so this pool was opened from the DSL example cards. Run `npm run play` to stage a generated set and deal from that instead.';

/**
 * What a kernel section says when the only thing staged is a printed format.
 *
 * `mtg-a982g.5`. The four Play sections no longer play the same things
 * (`../routes/play/sources.ts`): a lab holding printed formats and no generated
 * set has a Constructed section with nothing to deal and three sections that
 * deal. The stand-in sentence is the wrong one to draw there. It says no set is
 * staged when one is, and it names example cards this page did not open,
 * because a lab with something staged does not fall back to them at all.
 */
const PRINTED_ONLY_HINT =
  'No generated set is staged, so this section has nothing to deal. The staged printed formats are drafted on Draft, opened on Sealed and played on Commander; run `npm run play` to stage a generated set as well.';

/**
 * What the staged-set fetch knows, split by who reads it.
 *
 * `state` is the play route's four-state union, because that route deals a pool
 * off it and must not deal one from a guess. `name` is the shell title's, and it
 * is beside the union rather than inside it so `PlaySetState` stays the set of
 * facts the route acts on: the route never draws the set's name, and a field
 * only the caller reads is a field the next reader has to rule out.
 */
interface StagedSet {
  readonly state: PlaySetState;
  /** The set's own name, when the staged document names one; the shell title reads this. */
  readonly name: string | null;
  /** The artifact boundary uses this to reject another set's calibration. */
  readonly code: string | null;
  /** Content address of the exact staged set document, independent of whitespace. */
  readonly fingerprint: string | null;
  /**
   * The reduction record when the staged document is a reduced reference build,
   * `null` for every ordinary set and for a block too damaged to compose a
   * sentence from. The shell draws a disclosure off this on every route.
   */
  readonly reduction: SetReduction | null;
}

/** The checked identity carried beside `@mtg/setgen`'s executable card list. */
function setIdentityOf(raw: object): { readonly code: string | null; readonly name: string | null } {
  if (!('set' in raw)) return { code: null, name: null };
  const { set } = raw as { set: unknown };
  if (typeof set !== 'object' || set === null) return { code: null, name: null };
  const value = set as { readonly code?: unknown; readonly name?: unknown };
  return {
    code: typeof value.code === 'string' && value.code.length > 0 ? value.code : null,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name : null,
  };
}

/**
 * Is this response a JSON document, or the dev server's fallback page?
 *
 * **A missing `set.json` under `vite dev` is a 200, not a 404**, measured in
 * chrome-headless-shell against this package's own server: Vite answers any
 * unmatched path with `index.html` so a deep link into the app reloads, and
 * `public/set.json` is gitignored, so the clean-checkout state is a request for
 * a file that does not exist yet. Reading the status alone therefore calls that
 * "a staged set", and the parse then fails on a leading `<` — which reports a
 * broken set to somebody who has never staged one. The content type is what
 * actually separates the two, so it is checked rather than inferred.
 *
 * A response with no discoverable content type parses anyway: the useful default
 * is to try, and a body that is genuinely not a set fails the parse below with a
 * message about the set. Only a type that is present and is not JSON is treated
 * as nothing having been staged.
 *
 * Reached structurally, because the workspace tsconfig has no `lib: dom` and
 * `Headers` is not nameable here — the same reason `loadDeck` never types its
 * `Response`.
 */
function servesJson(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || !('headers' in response)) return true;
  const { headers } = response as { headers: unknown };
  if (typeof headers !== 'object' || headers === null || !('get' in headers)) return true;
  const { get } = headers as { get: unknown };
  if (typeof get !== 'function') return true;
  const value: unknown = (get as (name: string) => unknown).call(headers, 'content-type');
  if (typeof value !== 'string') return true;
  return value.toLowerCase().includes('json');
}

/**
 * Whether the server answered with the page instead of the file asked for.
 *
 * `servesJson`'s question turned around, for the two readers that ask for a
 * `.jsonl` and therefore cannot ask for JSON: Vite answers a missing file under
 * `public/` with `index.html` at 200, and it labels a real `.jsonl` with no
 * content type at all, so "is this JSON" calls a staged event log missing while
 * "is this the page" does not.
 */
function servesPage(response: unknown): boolean {
  if (typeof response !== 'object' || response === null || !('headers' in response)) return false;
  const { headers } = response as { headers: unknown };
  if (typeof headers !== 'object' || headers === null || !('get' in headers)) return false;
  const { get } = headers as { get: unknown };
  if (typeof get !== 'function') return false;
  const value: unknown = (get as (name: string) => unknown).call(headers, 'content-type');
  if (typeof value !== 'string') return false;
  return value.toLowerCase().includes('text/html');
}

/**
 * Reads a staged set document, keeping absent apart from broken.
 *
 * The same split `loadDeck` and `loadEventLog` make below, and it matters more
 * here than on either of them: nothing staged means nobody has run `npm run
 * play` and the lab should still open, while a document that fails `parseCard`
 * means somebody staged one and it is wrong, and dealing the example cards on
 * top of that would hand them a game they had every reason to think was theirs.
 *
 * Every card goes through `parseCard`, so a set that has drifted from the DSL
 * fails here with a message rather than halfway through rendering a board.
 */
async function loadSet(url: string): Promise<StagedRead> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  try {
    const raw: unknown = await response.json();
    if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
      throw new Error(`${url} has no "cards" array`);
    }
    const { cards } = raw as { cards: unknown };
    if (!Array.isArray(cards) || cards.length === 0) {
      throw new Error(`${url} has an empty "cards" array`);
    }
    const identity = setIdentityOf(raw);
    const parsed = cards.map((card) => parseCard(card));
    return {
      status: 'ready',
      cards: parsed,
      name: identity.name,
      code: identity.code,
      fingerprint: `sha256:${await sha256Text(canonicalJsonText(raw))}`,
      reduction: readReduction(raw),
      // Read here rather than at the route, because the answer depends on both
      // halves of this document: a sheet names a card id, and whether that id is
      // printed is a fact about the list that was just parsed. The reader probes
      // the pack opener rather than restating its rules, so a collation this
      // page accepts is one it has already dealt once.
      collation: readStagedCollation(raw, parsed),
    };
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', message: `${url} could not be read: ${detail}` };
  }
}

/**
 * What the fetch found, before anything stands in for it.
 *
 * The stand-in is applied on render rather than stored, which keeps the effect
 * below watching `[url]` alone the way `useDeck` and `useEventLog` do. Folding
 * the fallback array into the stored state would put it in the dependency list,
 * and a caller that maps its card list every render would then refetch forever.
 */
type StagedRead =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly cards: readonly DslCard[];
      readonly name: string | null;
      readonly code: string | null;
      readonly fingerprint: string;
      readonly reduction: SetReduction | null;
      readonly collation: StagedCollation;
    }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * The staged set, as a state rather than a value.
 *
 * `loading` is the first render, and answering it with the fallback cards is the
 * whole of `mtg-c4h`: the play route dealt a sealed pool off that answer before
 * the fetch had said anything, and a dealt pool is not something a later render
 * can take back. A caller with no `setUrl` at all is `absent` from the start,
 * because nothing is on its way and there is nothing to wait for.
 *
 * The url arrives *late* on the page that has a picker, and the state has to
 * move with it in the same render rather than an effect later. The index is
 * fetched too, so the first render has no row and no set url, which is the
 * `absent` arm above; the render that learns the url used to keep the `absent`
 * it was born with until a passive effect corrected it, and the browser is free
 * to paint in between. It did: a screenshot of the Play tab over a staged
 * flagship set caught "No set is staged, so this pool was opened from the DSL
 * example cards" drawn under a heading naming the flagship set. Reconciling
 * during render re-renders before the paint, so the frame that says a false
 * thing about the set never reaches the screen.
 */
function useStagedSet(url: string | undefined, fallback: readonly DslCard[]): StagedSet {
  const [read, setRead] = useState<StagedRead>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  const [readUrl, setReadUrl] = useState<string | undefined>(url);
  if (readUrl !== url) {
    setReadUrl(url);
    setRead(url === undefined ? { status: 'absent' } : { status: 'loading' });
  }
  // Back to `loading` before the fetch, not merely at first mount. The url is a
  // constant for the page that has no picker, and was for as long as the lab
  // showed one set; with a picker it changes under the reader, and a hook that
  // kept the previous set's `ready` across the change would hand the play route
  // a pool it could deal from the set that is no longer on screen. A dealt pool
  // is not something a later render can take back, which is `mtg-c4h`.
  useEffect(() => {
    // A url that goes *away* clears just as hard as one that changes. Every row
    // in today's index carries a set url, so this arm is only the index going
    // pending — but the three hooks below share the shape and one of them is
    // `mtg-aqxi.13`, where the arm is reachable and the stale document was
    // drawn as a paragraph of somebody else's card ids.
    if (url === undefined) {
      setRead({ status: 'absent' });
      return undefined;
    }
    let live = true;
    setRead({ status: 'loading' });
    void loadSet(url).then((next) => {
      if (live) setRead(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  switch (read.status) {
    case 'ready':
      return {
        state: {
          status: 'ready',
          cards: read.cards,
          collation: read.collation,
        },
        name: read.name,
        code: read.code,
        fingerprint: read.fingerprint,
        reduction: read.reduction,
      };
    case 'absent':
      return {
        state: { status: 'absent', cards: fallback },
        name: null,
        code: null,
        fingerprint: null,
        reduction: null,
      };
    case 'failed':
      return {
        state: { status: 'failed', message: read.message },
        name: null,
        code: null,
        fingerprint: null,
        reduction: null,
      };
    case 'loading':
      return { state: { status: 'loading' }, name: null, code: null, fingerprint: null, reduction: null };
  }
}

/**
 * Reads the staged deck.
 *
 * A 404 is `absent` and a document that fails the schema is `failed`, because
 * the two want different things from the person reading the page: one is "run
 * the command", the other is "your artifact is stale, here is the field".
 *
 * `servesJson` is what keeps those two apart under a dev server, and it was
 * missing here while five other readers had it. A checkout that has never built
 * a deck asks for `deck.json`, Vite answers `index.html` at 200, and the Decks
 * tab said "That deck could not be read: deck.json is not valid JSON (Unexpected
 * token '<')" to somebody whose only mistake was not having staged one.
 */
async function loadDeck(url: string): Promise<DeckState> {
  // `catch(() => null)` rather than a `Response`-typed local: the workspace
  // tsconfig has no `lib: dom`, so the DOM type is not nameable here.
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', message: `${url} is not valid JSON (${detail}).` };
  }
  const parsed = readDeckArtifact(body, url);
  return parsed.ok ? { status: 'ready', deck: parsed.deck } : { status: 'failed', message: parsed.message };
}

/**
 * Reads the staged precon document.
 *
 * `servesJson` is checked here for the same measured reason `loadSet` checks
 * it: under `vite dev` a missing file in `public/` answers 200 with
 * `index.html`, so a clean checkout would otherwise report a broken precon file
 * to somebody who has never staged one.
 */
async function loadPrecons(url: string): Promise<PreconState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', message: `${url} is not valid JSON (${detail}).` };
  }
  const parsed = readPreconFile(body, url);
  return parsed.ok ? { status: 'ready', file: parsed.file } : { status: 'failed', message: parsed.message };
}

function usePrecons(url: string | undefined): PreconState {
  const [state, setState] = useState<PreconState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    // `mtg-aqxi.13`, and the one arm of this that a reader actually hit. Only
    // the flagship set is staged with decks, so selecting either reduced
    // reference set takes this url away rather than changing it — and the early
    // return left the flagship's precon file standing under Magic 2013, where
    // `PlayRoute`'s mismatch check measured it and printed sixteen `xmp-` ids
    // across the top of the page as if the reader had staged something broken.
    if (url === undefined) {
      setState({ status: 'absent' });
      return undefined;
    }
    let live = true;
    // For `useStagedSet`'s reason: the picker changes this url, and decks cut
    // from the set that just left the screen must not survive the change.
    setState({ status: 'loading' });
    void loadPrecons(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

function useDeck(url: string | undefined): DeckState {
  const [state, setState] = useState<DeckState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) {
      setState({ status: 'absent' });
      return undefined;
    }
    let live = true;
    void loadDeck(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * What the staged set index says, as the same four states everything else loads in.
 *
 * `absent` is the state of a plain `vite dev` and of any page staged by a
 * launcher older than the index, and it is not a failure: the flat `setUrl`,
 * `artUrl` and `preconUrl` props answer for that page exactly as they always
 * did, and no picker is drawn. `servesJson` is checked for the measured reason
 * `loadSet` checks it — under `vite dev` a missing file in `public/` answers 200
 * with `index.html`, so a status-only read would call the clean-checkout state a
 * broken index and say so to somebody who has never staged anything.
 */
type SetIndexState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly index: SetIndex }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

async function loadSetIndex(url: string): Promise<SetIndexState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', message: `${url} is not valid JSON (${detail}).` };
  }
  const parsed = readSetIndex(body, url);
  return parsed.ok ? { status: 'ready', index: parsed.index } : { status: 'failed', message: parsed.message };
}

function useSetIndex(url: string | undefined): SetIndexState {
  const [state, setState] = useState<SetIndexState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) return undefined;
    let live = true;
    void loadSetIndex(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * Reads the staged art manifest, or resolves to no art at all.
 *
 * Every failure is the same outcome here — pending frames — because every
 * failure has already been reported where someone can act on it: the launcher
 * validates the manifest before staging it and names what it could not stage.
 * This is the seam check, and a set with no art run is the ordinary case.
 */
async function loadArt(url: string): Promise<ArtResolver | null> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return null;
  const body: unknown = await response.json().catch(() => null);
  const parsed = readArtManifest(body, url);
  return parsed.ok ? artResolver(parsed.manifest) : null;
}

function useArt(url: string | undefined): ArtResolver | null {
  const [resolver, setResolver] = useState<ArtResolver | null>(null);
  useEffect(() => {
    // The row that names no manifest is the same statement as the row that
    // names a different one: this set's cards are not in the resolver we hold.
    if (url === undefined) {
      setResolver(() => null);
      return undefined;
    }
    let live = true;
    // Cleared first. Card ids are per-set and nothing makes them unique across
    // sets, so a resolver held over from the previous manifest does not merely
    // resolve nothing — it can resolve the *wrong picture* for an id both sets
    // happen to print. The pending frame is the true statement in the gap.
    setResolver(() => null);
    void loadArt(url).then((next) => {
      // Stored in a thunk: `setState` calls a function argument to compute the
      // next state, and the resolver *is* a function.
      if (live && next !== null) setResolver(() => next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return resolver;
}

/**
 * Every staged bundle's cards, for the one tab that browses across sets.
 *
 * `mtg-tewc.8`. The Play, Draft and Deck tabs read the selected bundle and
 * nothing else, because dealing a pool out of two sets at once is not a thing
 * any of them means. The Cards tab is a browser, and a person who types a word
 * into a card browser means every card the lab holds.
 *
 * Read when the Cards tab is open and not before, which is the cost the bead
 * asked to watch: this checkout stages 371 + 162 + 145 cards, and a lab opened
 * on Play has no reason to have parsed the two sets it is not playing. Once read
 * it is kept, so moving off the tab and back does not refetch.
 *
 * A bundle that fails to parse is dropped rather than reported. The selected one
 * already has a route that says so in full (`CardsSource`), and a *second* set
 * failing is a sentence about a set nobody asked to look at; the set filter
 * simply does not offer it. Each entry carries its own art resolver for the
 * reason `useArt` clears its own: card ids are per-set, so one manifest over a
 * mixed gallery can paint the wrong picture rather than none.
 */
interface LibraryEntry {
  readonly row: StagedSetRow;
  readonly cards: readonly DslCard[];
  readonly artFor: ArtResolver | null;
}

async function loadLibraryEntry(row: StagedSetRow): Promise<LibraryEntry | null> {
  const read = await loadSet(row.setUrl);
  if (read.status !== 'ready') return null;
  const artFor = row.artUrl === undefined ? null : await loadArt(row.artUrl);
  return { row, cards: read.cards, artFor };
}

function useSetLibrary(index: SetIndexState, wanted: boolean): readonly LibraryEntry[] {
  const [entries, setEntries] = useState<readonly LibraryEntry[]>([]);
  // The urls rather than the rows: a new index object with the same bundles in
  // it is the same library, and the effect below refetches every set it names.
  const urls = index.status === 'ready' ? index.index.sets.map((row) => row.setUrl).join('\n') : '';
  const rows = index.status === 'ready' ? index.index.sets : null;
  useEffect(() => {
    if (!wanted || rows === null) return undefined;
    let live = true;
    void Promise.all(rows.map(loadLibraryEntry)).then((read) => {
      if (live) setEntries(read.filter((entry): entry is LibraryEntry => entry !== null));
    });
    return () => {
      live = false;
    };
    // `rows` is the value `urls` stands for, and it is a fresh array on every
    // render of a ready index; depending on it would refetch every set forever.
  }, [urls, wanted]);
  return entries;
}

/**
 * Reads the staged event log, keeping absent apart from broken.
 *
 * The same split `loadDeck` makes above, and the reason is the same one turn
 * further along: a 404 means nobody has recorded a game here yet and wants the
 * command, while a file that fails `readEventLog` wants the line the reader
 * refused — `EventLogError` carries one, and a person holding a stale log needs
 * to know which record went wrong rather than that something did.
 */
async function loadEventLog(url: string): Promise<ReplayState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || servesPage(response)) return { status: 'absent' };
  const text = await response.text().catch(() => null);
  if (text === null) return { status: 'failed', message: `${url} could not be read to the end.` };
  try {
    return { status: 'ready', log: readEventLog(text) };
  } catch (cause: unknown) {
    if (cause instanceof EventLogError) return { status: 'failed', message: `${url}: ${cause.message}` };
    throw cause;
  }
}

function useEventLog(url: string | undefined): ReplayState {
  const [state, setState] = useState<ReplayState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) return undefined;
    let live = true;
    void loadEventLog(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * The statistics log, as the same four states everything else here loads in.
 *
 * It used to be three, and the third was thrown away at the call site. A 404 is
 * `absent` — a checkout that has never run `npm run slice` has no log and
 * nothing is wrong — while a body the reader refuses is `failed` and carries
 * why.
 */
async function loadLog(url: string): Promise<AnalysisLogState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || servesPage(response)) return { status: 'absent' };
  try {
    return { status: 'ready', log: readReplayLog(await response.text()) };
  } catch (cause: unknown) {
    return { status: 'failed', message: `${url}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

function useReplayLog(url: string | undefined): AnalysisLogState {
  const [state, setState] = useState<AnalysisLogState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) return undefined;
    let live = true;
    void loadLog(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * The analysis documents, as a four-state load.
 *
 * `mtg-ey8g`: this is the hook whose three-state result used to be flattened
 * to `ReplayLog | null` plus a hint string at the call site, so "still reading"
 * and "could not read" reached the route only as prose and `absent` did not
 * exist at all. It exists here — a checkout that has never run `npm run
 * analyze` has no document, which is an ordinary state and a different one from
 * a document the reader refused.
 *
 * A 404 is `absent` rather than `failed` for the same reason `loadDeck` treats
 * it that way: nothing is wrong, the file has simply never been written.
 */
async function loadAnalysis(url: string): Promise<AnalysisRunsState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', message: `${url} is not valid JSON (${detail}).` };
  }
  const { runs } = (body ?? {}) as { runs?: unknown };
  if (!Array.isArray(runs)) {
    return { status: 'failed', message: `${url} has no "runs" array, so it is not an analysis document.` };
  }
  try {
    const views: readonly AnalysisRunView[] = runs.map((run, index) => ({
      run: readAnalysisRun(run, `runs[${String(index)}]`),
      // The set file is staged separately and keyed to whatever `npm run play`
      // opened, which is not necessarily the set this run measured. Composition
      // says so rather than charting one set's cards under another's label.
      set: null,
    }));
    return { status: 'ready', runs: views };
  } catch (cause: unknown) {
    const detail = cause instanceof AnalysisDataError ? cause.message : String(cause);
    return { status: 'failed', message: detail };
  }
}

function useAnalysis(url: string | undefined): AnalysisRunsState {
  const [state, setState] = useState<AnalysisRunsState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) return undefined;
    let live = true;
    void loadAnalysis(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * The evidence snapshot, read by the same rule as `loadAnalysis`: a 404 or a
 * non-JSON answer is `absent`, and a file the reader refuses carries the
 * reader's own sentence, which names the field it tripped on.
 */
async function loadEvidence(url: string): Promise<EvidenceState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', message: `${url} is not valid JSON (${detail}).` };
  }
  const read = readEvidenceSnapshot(body, url);
  return read.ok ? { status: 'ready', snapshot: read.snapshot } : { status: 'failed', message: read.message };
}

function useEvidence(url: string | undefined): EvidenceState {
  const [state, setState] = useState<EvidenceState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) return undefined;
    let live = true;
    void loadEvidence(url).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

async function loadCalibration(
  url: string,
  set: { readonly code: string; readonly fingerprint: string },
): Promise<CalibrationState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    return {
      status: 'invalid',
      message: `${url} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}).`,
    };
  }
  return classifyCalibration(body, set);
}

function useCalibration(
  url: string | undefined,
  setCode: string | null,
  setFingerprint: string | null,
  setStatus: PlaySetState['status'],
): CalibrationState {
  const [state, setState] = useState<CalibrationState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) return undefined;
    if (setStatus === 'loading') return undefined;
    if (setCode === null || setFingerprint === null) {
      setState({ status: 'absent' });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading' });
    void loadCalibration(url, { code: setCode, fingerprint: setFingerprint }).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [setCode, setFingerprint, setStatus, url]);
  return state;
}

async function loadRetune(url: string, calibration: CalibrationArtifact): Promise<RetuneState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause: unknown) {
    return {
      status: 'invalid',
      message: `${url} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}).`,
    };
  }
  return classifyRetune(body, calibration);
}

function useRetune(url: string | undefined, calibration: CalibrationState): RetuneState {
  const [state, setState] = useState<RetuneState>(
    calibration.status === 'ready' && url === undefined
      ? { status: 'absent' }
      : calibration.status === 'loading'
        ? { status: 'loading' }
        : calibration.status === 'ready'
          ? { status: 'loading' }
          : {
              status: 'blocked',
              message: 'Calibration must be ready before retune evidence can be examined.',
            },
  );
  useEffect(() => {
    if (calibration.status === 'loading') return undefined;
    if (calibration.status !== 'ready') {
      setState({
        status: 'blocked',
        message: 'Calibration must be ready before retune evidence can be examined.',
      });
      return undefined;
    }
    if (url === undefined) {
      setState({ status: 'absent' });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading' });
    void loadRetune(url, calibration.artifact).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [calibration, url]);
  return state;
}

/** The state a set is in while the index that names its url is still on its way. */
const SET_PENDING: StagedSet = {
  state: { status: 'loading' },
  name: null,
  code: null,
  fingerprint: null,
  reduction: null,
};

/**
 * The urls this render reads its set, art and decks from.
 *
 * A bundle answers for all three of its parts or for none of them, and the
 * `??` that would look natural here is the bug: a selected set with no art
 * manifest falling back to the flat `art.json` is the previous set's art
 * resolved against this set's card ids, which is exactly the failure the bundle
 * was introduced to end. So the flat props answer only when there is no index
 * at all.
 */
interface SetSources {
  readonly setUrl: string | undefined;
  readonly artUrl: string | undefined;
  readonly preconUrl: string | undefined;
  /** True while the index is still loading, so nothing is fetched or dealt yet. */
  readonly pending: boolean;
  /** The selected row, or null when nothing indexed this page. */
  readonly row: StagedSetRow | null;
}

function setSources(index: SetIndexState, stem: string | null, props: LabAppProps): SetSources {
  if (index.status === 'loading') {
    return { setUrl: undefined, artUrl: undefined, preconUrl: undefined, pending: true, row: null };
  }
  if (index.status !== 'ready') {
    return {
      setUrl: props.setUrl,
      artUrl: props.artUrl,
      preconUrl: props.preconUrl,
      pending: false,
      row: null,
    };
  }
  const row = selectedRow(index.index, stem);
  return {
    setUrl: row.setUrl,
    artUrl: row.artUrl,
    preconUrl: row.preconUrl,
    pending: false,
    row,
  };
}

/**
 * The kernel sets a Play section offers.
 *
 * `mtg-a982g.5`. The index is the list when there is one. Without an index
 * there is still a set when the launcher passed one flat, and it is a source
 * with no row: `setSources` already reads the empty stem as *the flat props*,
 * and one source draws no chips at all (`../routes/play/SourceChoice.ts`), so
 * the name it carries is only ever read when a printed format is staged beside
 * a flat set, which no launcher does.
 */
function kernelSourceRows(
  index: SetIndexState,
  props: LabAppProps,
): readonly Pick<StagedSetRow, 'stem' | 'name' | 'origin'>[] {
  if (index.status === 'ready') return index.index.sets;
  if (index.status === 'loading' || props.setUrl === undefined) return [];
  return [{ stem: '', name: PLAY_UNNAMED_SET, origin: 'custom' }];
}

/**
 * The catalog, and the token sheet when one is named. A named sheet that
 * cannot be read fails the cube rather than opening it: a cube whose tokens
 * silently draw the pending frame is the state the sheet exists to end.
 */
export async function loadLegacyCube(
  url: string,
  tokensUrl: string | undefined,
): Promise<LegacyCubeCatalogState> {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok || !servesJson(response)) return { status: 'absent' };
  try {
    const body: unknown = await response.json();
    const catalog = await readLegacyCubeCatalog(body);
    if (tokensUrl === undefined) return { status: 'ready', catalog };
    const sheet = await fetch(tokensUrl).catch(() => null);
    if (sheet === null || !sheet.ok || !servesJson(sheet)) {
      return { status: 'failed', message: `${tokensUrl} could not be read: the token sheet is not staged` };
    }
    return { status: 'ready', catalog, tokens: parsePrintedTokenPrintings(await sheet.json()).tokens };
  } catch (cause: unknown) {
    return {
      status: 'failed',
      message: `${url} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/** The official cube is an independent printed artifact, never a DSL-card fallback. */
function useLegacyCube(url: string | undefined, tokensUrl: string | undefined): LegacyCubeCatalogState {
  const [state, setState] = useState<LegacyCubeCatalogState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  useEffect(() => {
    if (url === undefined) {
      setState({ status: 'absent' });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading' });
    void loadLegacyCube(url, tokensUrl).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [url, tokensUrl]);
  return state;
}

function useLegacyCubeForgeReady(
  url: string | undefined,
  catalog: LegacyCubeCatalogState,
): LegacyCubeForgeReadyState {
  const [state, setState] = useState<LegacyCubeForgeReadyState>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  const catalogHash = catalog.status === 'ready' ? catalog.catalog.contentSha256 : null;
  useEffect(() => {
    if (url === undefined) {
      setState({ status: 'absent' });
      return undefined;
    }
    if (catalog.status !== 'ready') {
      setState({ status: 'loading' });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading' });
    void fetch(url)
      .then(async (response) => {
        if (!response.ok || !servesJson(response)) return { status: 'absent' } as const;
        const body: unknown = await response.json();
        return {
          status: 'ready',
          pool: await readLegacyCubeForgeReadyPool(body, catalog.catalog),
        } as const;
      })
      .catch((cause: unknown) => ({
        status: 'failed' as const,
        message: `${url} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      }))
      .then((next) => {
        if (live) setState(next);
      });
    return () => {
      live = false;
    };
  }, [url, catalogHash]);
  return state;
}

export function LabApp(props: LabAppProps): ReactElement {
  const analysis = useAnalysis(props.analysisUrl);
  const evidence = useEvidence(props.evidenceUrl);
  const setIndex = useSetIndex(props.setIndexUrl);
  const legacyCube = useLegacyCube(props.legacyCubeUrl, props.legacyCubeTokensUrl);
  const legacyCubeCalibration = useAdvisorCalibration(
    props.legacyCubeCalibrationUrl,
    legacyCube.status === 'ready' ? legacyCube.catalog.contentSha256 : undefined,
  );
  const legacyCubeForgeReady = useLegacyCubeForgeReady(props.legacyCubeForgeReadyUrl, legacyCube);
  const legacyForgeId =
    legacyCube.status === 'ready' ? `forge-${legacyCube.catalog.forgeVersion}` : 'forge-2.0.14';
  const defaultLegacyBackend = useMemo(() => httpObservedBackend({ id: legacyForgeId }), [legacyForgeId]);
  const legacyCubeBackend = props.legacyCubeBackend ?? defaultLegacyBackend;
  // The shell reads the same hash a moment later and this subscribes to it a
  // second time, which costs one listener: the whole of what this render needs
  // from the route is whether the Cards tab is the one being drawn, and that
  // decides whether the other staged bundles are fetched at all.
  // Three tabs read every staged set rather than one: the Cards gallery browses
  // them, the Constructed pool is their union (`mtg-nwn1`), and the Play tab
  // offers the decks the workbench built, which are not cut from the set this
  // tab happens to be showing — Vessari-v3 names four staged sets and its lands are
  // M11 printings (`mtg-pxdo`). Without them the union is empty there and every
  // built deck resolves to nothing.
  //
  // **Play pays that cost only when there is something to spend it on.**
  // `mtg-tewc.8` bought the read for the Cards tab on the argument that a lab
  // opened on Play has no reason to parse the two sets it is not playing, and
  // that argument still holds with no deck server: one cheap request settles it
  // before any set is fetched.
  const sourceRouter = useHashRoute();
  // Whether the Decks section has a game on its table, so the shell keeps its
  // standing notice off the board there the way it does on Play (`../app/App.ts`).
  const [seated, setSeated] = useState(false);
  // The same fact for a printed landing: the Commander decks seat a Forge table
  // in their own state rather than in the hash, so the frame is told rather than
  // reading it off the route (`../routes/play/PlayLanding.ts` drops its header
  // and its chips while a game is on).
  const [printedPlaying, setPrintedPlaying] = useState(false);
  const { mode: browsingMode, sub: browsingSub } = sourceRouter.route;
  const hasBuiltDecks = useShelfPresence();
  const browsing =
    browsingMode === 'cards' ||
    (browsingMode === 'customize' && browsingSub === 'decks') ||
    (browsingMode === 'play' && hasBuiltDecks);
  const printedIndex = usePrintedFormatIndex(props.printedFormatIndexUrl);
  const printedRows = printedFormatRows(printedIndex);
  const linkedStem =
    sourceRouter.route.params['cube'] === LEGACY_CUBE_FORMAT
      ? LEGACY_CUBE_FORMAT
      : (sourceRouter.route.params['source'] ?? null);
  /**
   * What this Play section can be played with, and which of them it is showing.
   *
   * `mtg-a982g.5`. The four sections do not offer the same things -- Constructed
   * is the kernel's, Draft adds every printed format that deals one and the
   * cube, Commander is the printed decks -- so the list is worked out per
   * section (`../routes/play/sources.ts`) and the hash is narrowed to it. A
   * `?source=` naming something this section does not offer is a link made on
   * another tab rather than an error, so it resolves to the staged set instead
   * of drawing a page that cannot deal.
   *
   * Off Play the hash still names the source outright: Cards and Customize
   * browse one set at a time and the header's picker is what chooses it there.
   */
  const playList = playSources(playSub(sourceRouter.route), {
    kernel: kernelSourceRows(setIndex, props),
    printed: printedRows,
    cube: props.legacyCubeUrl !== undefined,
  });
  const onPlay = sourceRouter.route.mode === 'play';
  // Nothing is resolved while the generated index is still on its way. A lab
  // that stages both would otherwise open a printed format for the one frame
  // before the index lands and then swap the page out from under the reader,
  // which is the same rule `setSources` follows for the set document itself.
  const playSource =
    onPlay && setIndex.status !== 'loading'
      ? resolvePlaySource(
          sourceRouter.route.params,
          playList,
          setIndex.status === 'ready' ? setIndex.index.selected : null,
        )
      : null;
  const chosenStem = onPlay ? (playSource?.stem ?? null) : linkedStem;
  const cubeSelected = chosenStem === LEGACY_CUBE_FORMAT;
  const printed = usePrintedSelection(printedIndex, chosenStem);
  const gatewayReadiness = useGatewayReadiness(onPlay && printed.selected ? printed.formatId : null);
  // Asked once, here rather than in the cell, because the answer decides whether
  // the network column is live at all and the cell that would ask is the one the
  // answer draws (`../routes/play/OpponentChoice.ts` mounts the open column's
  // body only when it can deal).
  const tableServer = useTableServer(DEFAULT_TABLE_BASE);
  // A precon table is Commander, and a table opened without saying so is a
  // twenty-life game with no command zone. Only the loaded selection knows the
  // format's rules, so they are read here and handed to the start control.
  const forgeRules =
    printed.state.status === 'ready' && printed.state.value.kind === 'constructed'
      ? preconMatchRules(printed.state.value.loaded.format)
      : undefined;
  const sources = setSources(setIndex, cubeSelected || printed.selected ? null : chosenStem, props);
  /**
   * Pressing a chip: the set this section plays, and nothing the last one left
   * behind.
   *
   * A seed, a pick list, a bot policy, a pool, a path and a deck all name
   * something inside the set being left, and a table or a room token is an
   * address at a game in it. `vs` stays: which opponent you are choosing is a
   * fact about the person rather than about the set. `?cube=` goes with them
   * because it is the older spelling of this same param and would outrank what
   * the press just wrote (`../app/router.ts`).
   */
  const chooseSource = (stem: string): void => {
    sourceRouter.setParams({
      source: stem,
      cube: '',
      seed: '',
      picks: '',
      bot: '',
      pool: '',
      path: '',
      deck: '',
      [AGAINST_PARAM]: '',
      table: '',
      room: '',
    });
  };
  // The evidence section's one join key: the cube's format id, a printed
  // format's id, or the staged set's code, whichever the picker has selected.
  const subjectKey = cubeSelected
    ? LEGACY_CUBE_FORMAT
    : printed.selected
      ? printed.formatId
      : (sources.row?.code ?? null);
  // The statistics log and the recorded event log are staged once, for the set
  // the launcher opened, and neither carries a check that would reject another
  // set's — the log is chosen by set code and the recorded game is played from
  // whichever decks that set had. So they are withheld while a different set is
  // selected, and each tab says so in the log's own words (`logSets` below). The
  // calibration artifact needs no such rule: it is addressed by the fingerprint
  // of the exact document it was drawn against and refuses a mismatch by name.
  const showsDefaultSet =
    !cubeSelected &&
    !printed.selected &&
    (setIndex.status !== 'ready' || sources.row === null || sources.row.stem === setIndex.index.selected);
  /**
   * The two sets behind a withheld log, or `null` when nothing is being withheld.
   *
   * `mtg-ahr5`. Withholding was already right; withholding silently was not.
   * Both tabs fell to their own empty state, which reads as "nobody has ever run
   * this" — a checkout that has never played a game and a lab whose log is one
   * picker move away drew the same page, and only one of them has anything to do
   * about it. So each log states its lifetime as a state of its own: it belongs
   * to the set it was recorded or measured against, it is withheld the moment
   * the picker leaves that set, and the tab names both sets and the way back.
   *
   * `null` when no log is staged at all, because "the log is another set's" is
   * only true when there is a log.
   */
  const dealtSetName =
    setIndex.status === 'ready' ? setDisplayName({ name: selectedRow(setIndex.index, null).name }) : null;
  const browsedSetName = printed.selected
    ? printed.title
    : cubeSelected
      ? CUBE_SET_NAME
      : sources.row === null
        ? null
        : setDisplayName({ name: sources.row.name });
  const logSets =
    showsDefaultSet || dealtSetName === null || browsedSetName === null
      ? null
      : { belongsTo: dealtSetName, showing: browsedSetName };
  const fetchedRunLog = useReplayLog(showsDefaultSet ? props.replayUrl : undefined);
  const runLog: AnalysisLogState =
    logSets === null || props.replayUrl === undefined ? fetchedRunLog : { status: 'elsewhere', ...logSets };

  // The staged set when there is one, the example cards otherwise, so the Play
  // tab always has something to deal — but as a state, so the Play tab can tell
  // "not yet" from "not at all" and deal nothing until it knows which.
  /**
   * What a section with no staged set deals from.
   *
   * The DSL example cards are a legitimate stand-in for a checkout that has
   * never run `npm run play`, and the wrong answer for a lab that has staged a
   * printed format: something is staged there, it is simply not what this
   * section plays, and a pool of example cards under it reads as the lab having
   * lost the set. `../routes/PlayRoute.ts` takes the stand-in from its caller
   * for exactly this decision, and an empty list is its empty state.
   */
  const standIn = printedRows.length > 0 ? [] : props.cards;
  const fetchedSet = useStagedSet(cubeSelected || printed.selected ? undefined : sources.setUrl, standIn);
  const stagedSet = sources.pending ? SET_PENDING : fetchedSet;
  // A printed-only preview has no generated default. Make its first displayed
  // choice the actual route source instead of silently dealing example cards.
  const defaultPrintedSource = printed.rows[0]?.stem;
  useEffect(() => {
    if (
      linkedStem !== null ||
      setIndex.status !== 'absent' ||
      stagedSet.state.status !== 'absent' ||
      defaultPrintedSource === undefined ||
      sourceRouter.route.params['room'] !== undefined ||
      sourceRouter.route.params['table'] !== undefined
    )
      return;
    sourceRouter.navigate({
      ...sourceRouter.route,
      params: { ...sourceRouter.route.params, source: defaultPrintedSource },
    });
  }, [linkedStem, setIndex.status, stagedSet.state.status, defaultPrintedSource, sourceRouter]);
  useEffect(() => {
    if (sourceRouter.route.mode !== 'play' || sourceRouter.route.sub !== 'commander') return;
    const moved = movedCommanderSource(sourceRouter.route.params, printedRows);
    if (moved === null) return;
    sourceRouter.goToSub(moved);
  }, [sourceRouter, printedRows]);
  // Without the `(reduced)` suffix the document carries in its own name: what
  // that suffix says is said by the kind line under it, and saying it twice put
  // a build word in the largest text on the page. `setDisplayName` is the one
  // place that decision lives (`../lab/set-label.ts`).
  const playSetRawName = sources.row?.name ?? stagedSet.name;
  const playSetName = playSetRawName === null ? null : setDisplayName({ name: playSetRawName });
  /**
   * The same list with the flat-props set named.
   *
   * `kernelSourceRows` has no index row to take a name off when the lab was
   * given a set document and nothing else, and by the time the chips are drawn
   * the document has usually arrived. A chip reading `This set` beside one
   * reading `Amonkhet / Hour of Devastation` says the wrong thing about a page
   * that is showing Magic 2011, so the name is filled in here, after the
   * document, rather than fed back into the resolution above -- which stem wins
   * is decided before any of them has a name.
   */
  const chipSources = playList.map((source) =>
    source.kind === 'kernel' && source.stem === '' && playSetName !== null
      ? { ...source, name: playSetName }
      : source,
  );
  const calibration = useCalibration(
    props.calibrationUrl,
    stagedSet.code,
    stagedSet.fingerprint,
    stagedSet.state.status,
  );
  const retune = useRetune(props.retuneUrl, calibration);
  // The Cards tab takes a list rather than a state, and that stays right for the
  // same reason the Play tab needed changing: a gallery is a pure function of its
  // cards, so a list that arrives one frame late redraws as the right list and
  // nothing was minted from the wrong one. Only a dealt pool cannot be taken back.
  const cardsTabSet =
    stagedSet.state.status === 'ready' || stagedSet.state.status === 'absent'
      ? stagedSet.state.cards
      : props.cards;
  // What the list *is*, which the list itself does not say (`mtg-ihtz`). The
  // route needs the set's name as well as the status, and the name lives beside
  // the union rather than in it, so the two are joined here.
  // Through `setDisplayName` for the reason the Play tab's heading goes through
  // it: the document's own name ends in `(reduced)`, and the page head is the
  // largest text on the route. What is missing is said by the notice above it.
  const cardsTabSource: CardsSource =
    stagedSet.state.status === 'ready'
      ? { status: 'ready', name: stagedSet.name === null ? null : setDisplayName({ name: stagedSet.name }) }
      : stagedSet.state;
  const deck = useDeck(props.deckUrl);
  const fetchedPrecons = usePrecons(cubeSelected ? undefined : sources.preconUrl);
  const precons: PreconState = sources.pending ? { status: 'loading' } : fetchedPrecons;
  const artFor = useArt(cubeSelected ? undefined : sources.artUrl);
  // The art of the set this lab's *server* deals, which is not always the set
  // this tab is reading.
  //
  // All three dealers are built once, from the set the launcher opened, before
  // a single bundle is staged (`tools/play.ts`), so switching the picker changes
  // what this tab browses and changes nothing about what a table or a room is
  // dealt from. `mtg-77i6` settled the cards that way round — the room serves
  // the set its own pool is printed in — and this is the same sentence about the
  // pictures: a room opened from a tab browsing another set drew the labeled
  // pending frame on every card in the pool, because the only manifest in hand
  // was keyed to the browsed set's ids (`mtg-5h78`).
  //
  // Fetched a second time only when the two rows name different manifests, which
  // is the only case this exists for. `null` is an answer here rather than a
  // missing one — the dealt set may have had no art run at all — so it is passed
  // down as itself instead of falling back to the browsed set's resolver, which
  // would paint one set's pictures onto another set's ids.
  const dealtRow = setIndex.status === 'ready' ? selectedRow(setIndex.index, null) : null;
  const dealtArtUrl = dealtRow?.artUrl;
  const dealtIsBrowsed = dealtArtUrl === sources.artUrl;
  const otherArtFor = useArt(dealtIsBrowsed ? undefined : dealtArtUrl);
  const dealtArtFor = dealtIsBrowsed ? artFor : otherArtFor;
  const libraryEntries = useSetLibrary(setIndex, browsing);
  // Undefined rather than an empty library, because the two say different
  // things to the route: no library at all is the page with no index, which
  // keeps the single-set gallery it always had.
  const selectedStem = sources.row?.stem ?? null;
  const library = useMemo<CardsLibrary | undefined>(() => {
    if (libraryEntries.length === 0 || selectedStem === null) return undefined;
    return {
      selected: selectedStem,
      sets: libraryEntries.map((entry): CardsLibrarySet => ({
        stem: entry.row.stem,
        // The display name, without the `(reduced)` the document carries: the
        // shell's notice already says what a reduced build is missing, and the
        // picker beside this one made the same cut for the same reason.
        name: setDisplayName(entry.row),
        origin: entry.row.origin,
        cards: entry.cards,
        ...(entry.artFor === null ? {} : { artFor: entry.artFor }),
      })),
    };
  }, [libraryEntries, selectedStem]);
  const fetchedEvents = useEventLog(showsDefaultSet ? props.eventLogUrl : undefined);
  const events: ReplayState =
    logSets === null || props.eventLogUrl === undefined ? fetchedEvents : { status: 'elsewhere', ...logSets };

  const draftSet: DraftSetState =
    stagedSet.state.status === 'absent'
      ? { status: 'absent' }
      : stagedSet.state.status === 'ready'
        ? { status: 'ready', cards: stagedSet.state.cards }
        : stagedSet.state;

  // One body per section, then the four modes dispatch on `route.sub` below.
  const sections = {
    // The art manifest reaches the table as well as the Cards tab: a board
    // face always draws its window, so a set with art staged shows it in play.
    // `?seed=` names a game. Without it the builder draws a fresh seed per
    // mount, so the lab deals a different sealed pool each time it is opened;
    // with it, an exact table comes back — the same bargain `#/replay?seq=`
    // makes. Passing the param through rather than generating one here keeps
    // the single unseeded call in `play/seed.ts` where it is documented.
    // `?table=` is a seat at a table on a server (`@mtg/netplay`), which is the
    // whole of what a second machine needs from this page: the link is the seat,
    // and everything else about the game is on the far side of it. Without it
    // this tab is the local lab it has always been: one person against a bot.
    // `?deck=` and `?against=` name the two preconstructed decks at the table, and
    // they ride beside `?seed=` because they are the same kind of thing: with a
    // fixed list on both sides, the seed and the two ids are the entire input
    // to the deal, so the three of them together name a game that can be
    // reopened. Pressing Play writes the two deck ids and *no* seed, so the
    // link is to a table rather than to one shuffle and opening it again deals
    // a fresh game; `Kaelen to this game` at the table adds the seed and pins it,
    // and `Reshuffle` takes it back off. Seed present means pinned, seed absent
    // means fresh, and `PreconGame`'s docblock argues why.
    play: (router): ReactElement =>
      createElement(PlayRoute, {
        set: stagedSet.state,
        sourceHint: printedRows.length > 0 ? PRINTED_ONLY_HINT : STAND_IN_HINT,
        // The mark in the corner and the Play tab both mean the same thing, and
        // neither of them can say it in the hash while a game is on. `router.ts`
        // argues the number; this is the one route that reads it.
        landing: router.landing,
        // Which section this is and which column is open, off the hash. Under
        // the Draft section the bot column is the staged set's own chooser.
        ...playOpponentProps(router),
        // The sets this section can play and which of them it is on, so the
        // chips above the landing are drawn from the same list the page was
        // resolved out of (`../routes/play/sources.ts`).
        sources: chipSources,
        selectedSource: playSource?.stem ?? null,
        onSource: chooseSource,
        ...(router.route.sub === 'draft' ? { draft: sections.draft(router) } : {}),
        // The same staged sets the Decks route takes, so the decks the workbench
        // built can be picked here beside the set's written ones, and drawn with
        // the art of whichever set each of their cards came from (`mtg-pxdo`).
        ...(library === undefined ? {} : { poolSets: library.sets }),
        // What the chooser's header says it is showing. The name comes off the
        // index row when there is one and off the document when there is not,
        // because the flat-props path has no row and still knows its own name;
        // the category comes only off the row, since `setOrigin` reads the
        // document the index was built from and nothing else here has read it.
        ...(playSetName === null ? {} : { setName: playSetName }),
        ...(sources.row === null ? {} : { setKind: setKindFact(sources.row) }),
        // The same reference the Decks route records on a saved deck, so a deck
        // kept off the sealed build screen shelves beside the ones built on the
        // Decks tab rather than under no set at all. Same condition as there:
        // both halves or neither, since an origin with no name is not a set
        // anybody can look up.
        ...(sources.row === null || playSetName === null
          ? {}
          : { setRef: { name: playSetName, origin: sources.row.origin } }),
        precons: {
          state: precons,
          ...(router.route.params['deck'] === undefined ? {} : { deckId: router.route.params['deck'] }),
          ...(router.route.params[AGAINST_PARAM] === undefined
            ? {}
            : { opponentDeckId: router.route.params[AGAINST_PARAM] }),
          onSelect: (selection: PreconSelection): void => {
            // An absent seed is written *away* rather than left alone: an empty
            // value deletes the key (`setParams`), so a reshuffle cannot leave a
            // stale `?seed=` in the bar naming a game nobody is playing.
            router.setParams({
              deck: selection.deck,
              [AGAINST_PARAM]: selection.against,
              seed: selection.seed ?? '',
            });
          },
        },
        ...(router.route.params['seed'] === undefined ? {} : { seed: router.route.params['seed'] }),
        ...(router.route.params['table'] === undefined ? {} : { table: router.route.params['table'] }),
        // `?room=` is the same kind of address one phase earlier: a seat in a
        // room, where both players cut a deck out of their own sealed pool
        // before there is a game — or draft for it first, which is the same
        // room one phase earlier still. Two params rather than one because the
        // link is what says which of the two a person followed.
        ...(router.route.params['room'] === undefined ? {} : { room: router.route.params['room'] }),
        // Pressing *Start a LAN table* deals one and hands back the host's
        // seat; writing it here is what turns that seat into an address, and
        // `seatParams` says what is written away in the same breath.
        onTable: (token: string): void => router.setParams(seatParams('table', token)),
        onRoom: (token: string): void => router.setParams(seatParams('room', token)),
        // A drafting room writes the same param, because it is the same seat:
        // the packs, the build screen and the game that follows them all answer
        // to this one token. What the screen draws is read off the room's phase
        // rather than off a second address nobody would keep in sync.
        onDraft: (token: string): void => router.setParams(seatParams('room', token)),
        ...(artFor === null ? {} : { artFor }),
        // Passed even when it is null, unlike `artFor` above: the two say
        // different things here, and "the dealt set has no art" has to reach the
        // room rather than be read as "nothing was passed".
        dealtArtFor,
      }),
    draft: (router): ReactElement => {
      if (printed.selected) return printedSelection(printed, 'draft', router, legacyCubeBackend);
      if (cubeSelected) {
        return createElement(LegacyCubeRoute, {
          catalog: legacyCube,
          calibration: legacyCubeCalibration,
          forgeReady: legacyCubeForgeReady,
          params: router.route.params,
          onSetParams: router.setParams,
          backend: legacyCubeBackend,
        });
      }
      return createElement(DraftRoute, {
        set: draftSet,
        params: {
          ...(router.route.params['seed'] === undefined ? {} : { seed: router.route.params['seed'] }),
          ...(router.route.params['picks'] === undefined ? {} : { picks: router.route.params['picks'] }),
        },
        onSetParams: router.setParams,
        // The printing's own sheets when the staged document carries them, so
        // this tab opens the pack the Play tab opens (`mtg-nmqp`).
        ...(stagedSet.state.status === 'ready' ? { collation: stagedSet.state.collation } : {}),
        // Named on the chooser so "New draft" says what it will deal; the chips
        // above the landing are what chooses it (`../routes/play/SourceChoice.ts`).
        ...(playSetName === null ? {} : { setName: playSetName }),
        // A drafted deck records the set it was drafted out of, on the same
        // terms as the sealed one above.
        ...(sources.row === null || playSetName === null
          ? {}
          : { setRef: { name: playSetName, origin: sources.row.origin } }),
        ...(artFor === null ? {} : { artFor }),
      });
    },
    decks: (router) =>
      printed.selected
        ? printedSelection(printed, 'decks', router, legacyCubeBackend)
        : cubeSelected
          ? cubeDecksNotice()
          : createElement(DeckRoute, {
              state: deck,
              precons,
              onPlayingChange: setSeated,
              ...(router.route.params[DECK_OPEN_PARAM] === undefined
                ? {}
                : { open: router.route.params[DECK_OPEN_PARAM] }),
              ...(stagedSet.state.status === 'ready' ? { cards: stagedSet.state.cards } : {}),
              // The set the decks tab shelves its decks under, and records on every
              // deck saved there. Off the index row rather than off the document, for
              // the reason the Play header's category is: `setOrigin` reads the
              // document the index was built from, and nothing else here has read it.
              // Absent on the flat-props path, where there is no row and so no honest
              // category to record.
              ...(sources.row === null || playSetName === null
                ? {}
                : { set: { name: playSetName, origin: sources.row.origin } }),
              ...(artFor === null ? {} : { artFor }),
              // The Constructed pool is every staged set, not only the header's
              // (`mtg-nwn1`). The set facet in the builder's pool pane was already
              // written for several and had never seen more than one.
              ...(library === undefined ? {} : { poolSets: library.sets }),
            }),
    // The dashboard over measured documents, with the statistics log alongside
    // it as its `games` section. Both are four-state and neither is flattened.
    analysis: (router) => analysisView(analysis, runLog, calibration, retune, evidence, subjectKey)(router),
    // `#/replay?game=&seq=` is the whole of where you are in a game: the frame
    // is a pure function of the log and those two numbers, so a link to a
    // decision is a link to the same decision tomorrow.
    replay: (router) =>
      createElement(ReplayViewer, {
        state: events,
        route: router.route,
        onSetParams: router.setParams,
        // The same resolver the Play and Cards tabs get. Without it every face
        // in a recorded game draws the labeled pending frame while the same
        // permanent, live, is painted.
        ...(artFor === null ? {} : { artFor }),
      }),
    // The staged set rather than the example cards, so the tab shows the set
    // being played and the art manifest — keyed by that set's card ids — has
    // something to resolve against. It is handed the state as well as the list,
    // because the two lists look alike and only one of them is a set.
    cards: (router) =>
      printed.selected
        ? printedSelection(printed, 'gallery', router, legacyCubeBackend)
        : cubeSelected
          ? createElement(CubeCardsRoute, {
              catalog: legacyCube,
              route: router.route,
              onSetParams: router.setParams,
            })
          : createElement(CardsRoute, {
              cards: cardsTabSet,
              source: cardsTabSource,
              ...(library === undefined ? {} : { library }),
              route: router.route,
              onSetParams: router.setParams,
              ...(artFor === null ? {} : { artFor }),
              // What this build left out, listed under the same search that narrows
              // the gallery (`mtg-f1b0`). Null for every set that is not a reduced
              // reference build.
              reduction: stagedSet.reduction,
            }),
    // The one tab that is about a set that does not exist yet, and the only one
    // that reads nothing off the staged document: a brief is written against the
    // generator's own schema, which answers over `/design-api` because it cannot
    // be bundled into a browser. With no server behind that prefix the tab still
    // edits and says which command starts one.
    design: () => createElement(DesignRoute),
  } satisfies Readonly<Record<string, UiView>>;

  /**
   * One landing, whatever the set is.
   *
   * `mtg-a982g.5`. A printed format and the cube used to draw pages of their
   * own -- a bare *Start draft* under a page title, a workspace notice with two
   * links -- and the staged set drew the boxed section with the two opponent
   * cells. The frame is the staged set's shape and this is where the other two
   * are put inside it: the route's own body becomes the bot column and
   * everything above it is drawn once (`../routes/play/PlayLanding.ts`).
   *
   * Whether this network can seat the game is the lab's fact rather than the
   * format's, so the answer is handed down from here, and what it is made of is
   * what the lab's own `/api/health` advertised: Forge seats a table for the
   * formats it lists and for no others (`../routes/play/LanForgeStart.ts`).
   *
   * `cells` is false on the one landing whose body carries both presses itself,
   * which is the Commander section's; `../routes/play/PlayLanding.ts` says why
   * a cell nobody can open is worse than no cell.
   */
  const landingFrame = (
    router: UiRouter,
    source: ForgeSource,
    body: ReactElement,
    cells: boolean = true,
  ): ReactElement => {
    const opponents = playOpponentProps(router);
    const row = printedRows.find((entry) => `printed:${entry.id}` === source.stem);
    const format = forgeFormatId(source);
    const facts: AvailabilityFacts = {
      lan: lanForgeSection(tableServer.running, tableServer.observed, format),
      ...(row === undefined ? {} : { printed: row.availability }),
    };
    return createElement(PlayLanding, {
      setName: source.name,
      // Both of these are Magic's own cards rather than a set this lab
      // generated, which is what the line under the name says (`../lab/set-origin.ts`).
      setLabel: setKindLabel('official'),
      setKind: source.kind,
      format: opponents.sub,
      sources: chipSources,
      selected: source.stem,
      onSource: chooseSource,
      opponent: opponents.opponent,
      onOpponent: opponents.onOpponent,
      facts,
      playing: printedPlaying,
      cells,
      bot: body,
      // The one mount of the start control. It used to be written into each of
      // the four routes that could seat a table, which drew it under the bot
      // column's body and once per page that offered the format; the cell it
      // belongs under is here, and the routes draw the seat rather than the
      // start (`../routes/play/ObservedSeat.ts`).
      lan: createElement(LanForgeStart, {
        base: DEFAULT_TABLE_BASE,
        format,
        content: { kind: 'printed', format },
        ...(forgeRules === undefined ? {} : { rules: forgeRules }),
        onStarted: (opened) => {
          router.setParams({ table: opened.host });
        },
      }),
    });
  };

  /**
   * Which body the Play page draws: the section's landing, or the thing the
   * section dealt.
   *
   * The staged set's route holds its own frame and its own game and decides
   * between them in state, so it is drawn whole; the one state it hands the
   * page back for is a dealt draft, which is the Draft route rather than a
   * column of the chooser. A printed format and the cube are routes beside
   * their landing rather than around it, so the landing wraps them until the
   * hash says something was dealt (`./section-views.ts` reads that).
   */
  const playView = (router: UiRouter): ReactElement => {
    const sub = playSub(router.route);
    const taken = routeTakesThePage(router.route);
    if (playSource === null) {
      return sub === 'commander' ? commanderNotice() : sections.play(router);
    }
    // A seat at a kernel table is `../routes/PlayRoute.ts`'s page whatever is
    // showing, but a seat at a Forge table over the network is not: its deck is
    // built out of the printed format or the cube it was dealt from, on that
    // source's own page, so it goes on down to the route below.
    if (playSource.kind === 'kernel' || (routeSeats(router.route) && !routeSeatsObserved(router.route))) {
      return sub === 'draft' && taken ? sections.draft(router) : sections.play(router);
    }
    // `mtg-r9vgk`, the playtester 2026-09-17. The Commander landing's two presses --
    // a Forge match on this machine and a Forge table over the network -- both
    // belong beside the deck they play, so the LAN one is built here, where the
    // lab's address and its `/api/health` answer already are, and handed down
    // to the route (`../routes/printed/lan-precon.ts`). The opponent cells go
    // with it: the column they chose between is the page's own head bar now.
    const lanPlay =
      sub === 'commander' && playSource.kind === 'printed'
        ? preconLanPlay({
            base: DEFAULT_TABLE_BASE,
            format: forgeFormatId(playSource),
            rules: forgeRules,
            availability: lanForgeSection(
              tableServer.running,
              tableServer.observed,
              forgeFormatId(playSource),
            ),
            // `mtg-ei4n5`. Token and deck in one write: the seat page reads its
            // deck off the route and falls back to the format's first one, so a
            // table opened alone came up on whichever deck ships first instead
            // of the one the host had just chosen.
            seat: (token, hostDeckId) => {
              router.setParams({ table: token, [PRECON_DECK_PARAM]: hostDeckId });
            },
          })
        : undefined;
    const body =
      playSource.kind === 'cube'
        ? sections.draft(router)
        : printedSelection(
            printed,
            sub,
            router,
            legacyCubeBackend,
            setPrintedPlaying,
            lanPlay,
            gatewayReadiness,
          );
    return taken ? body : landingFrame(router, playSource, body, lanPlay === undefined);
  };

  // Which body a section draws.
  const views: UiViews = {
    play: playView,
    customize: (router) => (router.route.sub === 'sets' ? sections.design() : sections.decks(router)),
    cards: (router) =>
      router.route.sub === 'decks'
        ? createElement(DeckGallery, {
            state: deck,
            precons,
            ...(stagedSet.state.status === 'ready' ? { cards: stagedSet.state.cards } : {}),
            // The set the gallery names on each precon tile and files a saved
            // deck under, on the same terms `sections.decks` above records it.
            ...(sources.row === null || playSetName === null
              ? {}
              : { set: { name: playSetName, origin: sources.row.origin } }),
          })
        : sections.cards(router),
    analysis: (router) =>
      router.route.sub === 'replay' ? sections.replay(router) : sections.analysis(router),
  };

  const partialNotice = stagedSet.reduction === null ? null : reducedNoticeText(stagedSet.reduction);
  return createElement(App, {
    views,
    seated,
    // The mark is the lab's name and it stays the lab's name (`mtg-aqxi.17`).
    // It used to be the staged set's, on the argument that "MTG Lab" over a
    // named set says nothing about what you are looking at. What that cost is
    // what the playtester read off a phone: the one fixed point in the chrome moved
    // every time the picker did, and the mark is now a control — the way back to
    // Play — so a caption that renames itself is a button that renames itself.
    // Which set is staged is on the picker beside it.
    //
    // Nothing else rides here. The bar used to carry `foundation` under the mark
    // and `XMP · 2,700 games analyzed` on the right, and both were descriptions
    // of the application aimed at somebody already inside it. The games count is
    // a measurement and it belongs on Analysis, which is the route that can say
    // which set it measured and when; see `../routes/analysis/AnalysisView.ts`.
    title: props.title ?? 'MTG Lab',
    // Never on Play. That section chooses its own set, out of what it can
    // actually deal, and the chips above the landing are that choice
    // (`../routes/play/SourceChoice.ts`). One dropdown naming a set for every
    // tab at once is what put the Starter Commander decks in a list of sets and
    // offered a printed format under a section that deals no draft.
    //
    // Drawn on every other route: Cards, Customize and Analysis each read one
    // staged set, so a picker that lived on one of them would leave the others
    // showing the set somebody just switched away from.
    ...(!onPlay &&
    (setIndex.status === 'ready' ||
      props.legacyCubeUrl !== undefined ||
      cubeSelected ||
      printed.selected ||
      printed.rows.length > 0)
      ? {
          setPicker: createElement(SetPicker, {
            sets: [
              ...(setIndex.status === 'ready' ? setIndex.index.sets : []),
              ...printed.rows,
              ...(props.legacyCubeUrl === undefined && !cubeSelected
                ? []
                : [
                    {
                      stem: LEGACY_CUBE_FORMAT,
                      name: CUBE_SET_NAME,
                      origin: 'official' as const,
                      cardCount: 600,
                    },
                  ]),
            ],
            selected: printed.selected
              ? (printed.stem ?? chosenStem!)
              : cubeSelected
                ? LEGACY_CUBE_FORMAT
                : (sources.row?.stem ?? ''),
            onSelect: (source: string) => {
              const params = sourceRouter.route.params;
              const room =
                source === LEGACY_CUBE_FORMAT || source.startsWith('printed:') ? undefined : params['room'];
              const table =
                source === LEGACY_CUBE_FORMAT || source.startsWith('printed:') ? undefined : params['table'];
              sourceRouter.navigate({
                mode: sourceRouter.route.mode,
                sub: sourceRouter.route.sub,
                params: {
                  source,
                  ...(room === undefined ? {} : { room }),
                  ...(table === undefined ? {} : { table }),
                },
              });
            },
          }),
        }
      : {}),
    // A reduced reference build has collector positions missing and renders
    // exactly like a set that does not, so the shell says which on every route
    // rather than only on stdout at launch (`mtg-h2rj`). Absent for every
    // ordinary set, which is the ordinary case rather than a failure.
    ...(cubeSelected || printed.selected || partialNotice === null ? {} : { notice: partialNotice }),
  });
}

/** The Customize tab's answer for the cube: there is nothing here to edit. */
export const CUBE_NO_DECKS_TITLE = 'The Legacy Cube ships no decks';
const CUBE_NO_DECKS_BODY =
  'Draft the cube on the Play tab to build one, or browse all 600 cards on the Cards tab.';

/** What the Commander section says with no constructed format staged. */
export const COMMANDER_UNSTAGED_TITLE = 'Commander decks are not staged';
const COMMANDER_UNSTAGED_BODY = 'Run `npm run play` to stage the Starter Commander decks.';

function emptyNotice(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('h2', { className: 'mtg-empty__title' }, title),
    createElement('p', { className: 'mtg-empty__body' }, body),
  );
}

/**
 * `mtg-a982g.5` deleted the workspace notice this replaces: a page title, a
 * paragraph and two links standing in for a section, drawn on Play and on
 * Customize both. The cube is drafted on Play and browsed on Cards, and both
 * of those are one press away in the bar, so what is left to say here is that
 * this tab has nothing for it.
 */
function cubeDecksNotice(): ReactElement {
  return emptyNotice(CUBE_NO_DECKS_TITLE, CUBE_NO_DECKS_BODY);
}

/**
 * The Commander section with nothing staged. The decks are a printed
 * constructed format (`../routes/play/sources.ts`), so a checkout that has
 * never staged one has no source at all rather than an empty deck list.
 */
function commanderNotice(): ReactElement {
  return emptyNotice(COMMANDER_UNSTAGED_TITLE, COMMANDER_UNSTAGED_BODY);
}
