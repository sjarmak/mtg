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
 * them holding a tenth of the record. `ReplayRoute` is still exported and still
 * tested; where it belongs is beside its own log, as the per-game drill-down of
 * the run the Analysis tab summarizes, which is `mtg-2ayr`.
 */
import { createElement, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { App } from '../app/App';
import type { UiViews } from '../app/App';
import { analysisView } from '../routes/analysis';
import type { AnalysisRunView, AnalysisRunsState } from '../routes/analysis';
import { AnalysisDataError, readAnalysisRun } from '../routes/analysis';
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
import type { CardsSource } from '../routes/CardsRoute';
import { DeckRoute } from '../routes/DeckRoute';
import type { DeckState } from '../routes/DeckRoute';
import { DraftRoute } from '../routes/DraftRoute';
import type { DraftSetState } from '../routes/DraftRoute';
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
import { SetPicker } from '../app/SetPicker';
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
  readonly title?: string;
  readonly subtitle?: string;
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
 */
function useStagedSet(url: string | undefined, fallback: readonly DslCard[]): StagedSet {
  const [read, setRead] = useState<StagedRead>(
    url === undefined ? { status: 'absent' } : { status: 'loading' },
  );
  // Back to `loading` before the fetch, not merely at first mount. The url is a
  // constant for the page that has no picker, and was for as long as the lab
  // showed one set; with a picker it changes under the reader, and a hook that
  // kept the previous set's `ready` across the change would hand the play route
  // a pool it could deal from the set that is no longer on screen. A dealt pool
  // is not something a later render can take back, which is `mtg-c4h`.
  useEffect(() => {
    if (url === undefined) return undefined;
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
        state: { status: 'ready', cards: read.cards, collation: read.collation },
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
 */
async function loadDeck(url: string): Promise<DeckState> {
  // `catch(() => null)` rather than a `Response`-typed local: the workspace
  // tsconfig has no `lib: dom`, so the DOM type is not nameable here.
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok) return { status: 'absent' };
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
    if (url === undefined) return undefined;
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
    if (url === undefined) return undefined;
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
  if (response === null || !response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  const parsed = readArtManifest(body, url);
  return parsed.ok ? artResolver(parsed.manifest) : null;
}

function useArt(url: string | undefined): ArtResolver | null {
  const [resolver, setResolver] = useState<ArtResolver | null>(null);
  useEffect(() => {
    if (url === undefined) return undefined;
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
  if (response === null || !response.ok) return { status: 'absent' };
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
  if (response === null || !response.ok) return { status: 'absent' };
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
  if (response === null || !response.ok) return { status: 'absent' };
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

export function LabApp(props: LabAppProps): ReactElement {
  const analysis = useAnalysis(props.analysisUrl);
  const setIndex = useSetIndex(props.setIndexUrl);
  const [chosenStem, setChosenStem] = useState<string | null>(null);
  const sources = setSources(setIndex, chosenStem, props);
  // The statistics log and the recorded event log are staged once, for the set
  // the launcher opened, and neither carries a check that would reject another
  // set's — the log is chosen by set code and the recorded game is played from
  // whichever decks that set had. So they are withheld while a different set is
  // selected, and both tabs fall to their own "nothing measured / nothing
  // recorded" state, which is the true statement about the set on screen. The
  // calibration artifact needs no such rule: it is addressed by the fingerprint
  // of the exact document it was drawn against and refuses a mismatch by name.
  const showsDefaultSet =
    setIndex.status !== 'ready' || sources.row === null || sources.row.stem === setIndex.index.selected;
  const runLog = useReplayLog(showsDefaultSet ? props.replayUrl : undefined);

  // The staged set when there is one, the example cards otherwise, so the Play
  // tab always has something to deal — but as a state, so the Play tab can tell
  // "not yet" from "not at all" and deal nothing until it knows which.
  const fetchedSet = useStagedSet(sources.setUrl, props.cards);
  const stagedSet = sources.pending ? SET_PENDING : fetchedSet;
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
  const cardsTabSource: CardsSource =
    stagedSet.state.status === 'ready' ? { status: 'ready', name: stagedSet.name } : stagedSet.state;
  const deck = useDeck(props.deckUrl);
  const fetchedPrecons = usePrecons(sources.preconUrl);
  const precons: PreconState = sources.pending ? { status: 'loading' } : fetchedPrecons;
  const artFor = useArt(sources.artUrl);
  const events = useEventLog(showsDefaultSet ? props.eventLogUrl : undefined);

  const draftSet: DraftSetState =
    stagedSet.state.status === 'absent'
      ? { status: 'absent' }
      : stagedSet.state.status === 'ready'
        ? { status: 'ready', cards: stagedSet.state.cards }
        : stagedSet.state;

  const views: UiViews = {
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
    // this tab is the hot-seat lab it has always been.
    // `?deck=` and `?vs=` name the two preconstructed decks at the table, and
    // they ride beside `?seed=` because they are the same kind of thing: with a
    // fixed list on both sides, the seed and the two ids are the entire input
    // to the deal, so the three of them together name a game that can be
    // reopened. Pressing Play writes the two deck ids and *no* seed, so the
    // link is to a table rather than to one shuffle and opening it again deals
    // a fresh game; `Kaelen to this game` at the table adds the seed and pins it,
    // and `Reshuffle` takes it back off. Seed present means pinned, seed absent
    // means fresh, and `PreconGame`'s docblock argues why.
    play: (router) =>
      createElement(PlayRoute, {
        set: stagedSet.state,
        sourceHint: STAND_IN_HINT,
        precons: {
          state: precons,
          ...(router.route.params['deck'] === undefined ? {} : { deckId: router.route.params['deck'] }),
          ...(router.route.params['vs'] === undefined ? {} : { opponentDeckId: router.route.params['vs'] }),
          onSelect: (selection: PreconSelection): void => {
            // An absent seed is written *away* rather than left alone: an empty
            // value deletes the key (`setParams`), so a reshuffle cannot leave a
            // stale `?seed=` in the bar naming a game nobody is playing.
            router.setParams({
              deck: selection.deck,
              vs: selection.vs,
              seed: selection.seed ?? '',
            });
          },
        },
        ...(router.route.params['seed'] === undefined ? {} : { seed: router.route.params['seed'] }),
        ...(router.route.params['table'] === undefined ? {} : { table: router.route.params['table'] }),
        ...(artFor === null ? {} : { artFor }),
      }),
    draft: (router) =>
      createElement(DraftRoute, {
        set: draftSet,
        params: {
          ...(router.route.params['seed'] === undefined ? {} : { seed: router.route.params['seed'] }),
          ...(router.route.params['picks'] === undefined ? {} : { picks: router.route.params['picks'] }),
        },
        onSetParams: router.setParams,
        ...(artFor === null ? {} : { artFor }),
      }),
    deck: () =>
      createElement(DeckRoute, {
        state: deck,
        precons,
        ...(stagedSet.state.status === 'ready' ? { cards: stagedSet.state.cards } : {}),
        ...(artFor === null ? {} : { artFor }),
      }),
    // The dashboard over measured documents, with the statistics log alongside
    // it as its `games` section. Both are four-state and neither is flattened.
    analysis: (router) => analysisView(analysis, runLog, calibration, retune)(router),
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
      createElement(CardsRoute, {
        cards: cardsTabSet,
        source: cardsTabSource,
        route: router.route,
        onSetParams: router.setParams,
        ...(artFor === null ? {} : { artFor }),
      }),
  };

  return createElement(App, {
    views,
    // The staged set names the shell, because "MTG Lab" over a named set tells
    // a person nothing about what they are looking at. No set staged, or a set
    // with no name yet, falls back to the generic mark.
    title: stagedSet.name ?? props.title ?? 'MTG Lab',
    subtitle: props.subtitle ?? 'foundation',
    aside: shellAside(analysis, runLog),
    // Drawn on every route, the play route included: every tab reads the staged
    // set, so a picker that lived on one of them would leave the others showing
    // the set somebody just switched away from.
    ...(setIndex.status === 'ready'
      ? {
          setPicker: createElement(SetPicker, {
            sets: setIndex.index.sets,
            selected: sources.row?.stem ?? setIndex.index.selected,
            onSelect: setChosenStem,
          }),
        }
      : {}),
    // A reduced reference build has collector positions missing and renders
    // exactly like a set that does not, so the shell says which on every route
    // rather than only on stdout at launch (`mtg-h2rj`). Absent for every
    // ordinary set, which is the ordinary case rather than a failure.
    ...(stagedSet.reduction === null ? {} : { notice: reducedNoticeText(stagedSet.reduction) }),
  });
}

/**
 * The one line of numbers the whole lab wears, and it names the set they are
 * about.
 *
 * `mtg-ihtz`: this badge used to read the statistics log alone, so a lab opened
 * on the flagship carried "3 games · seed slice/v0" on every route — three
 * games of a different set, from a file nothing stages and nothing clears. The
 * number was not wrong; the missing subject was. A count with no set beside it
 * reads as a count about whatever is on screen.
 *
 * So the measured analysis leads when there is one, because that is the file a
 * person produced on purpose, and both branches name their set code. Neither
 * claims to be about the staged set: they say which set they measured and let
 * the reader see it differs.
 */
function shellAside(analysis: AnalysisRunsState, runLog: AnalysisLogState): string {
  if (analysis.status === 'ready') {
    const latest = analysis.runs.at(-1);
    if (latest !== undefined) {
      return `${latest.run.set.code} · ${latest.run.health.games.toLocaleString('en-US')} games analyzed`;
    }
  }
  if (runLog.status === 'ready') {
    // The set code lives on the rows rather than the header, so an empty log
    // has none to name and says so instead of inventing one.
    const expansion = runLog.log.games[0]?.metadata.expansion ?? 'no set';
    return `${expansion} · ${String(runLog.log.games.length)} games · seed ${runLog.log.runSeed}`;
  }
  return 'no set analyzed yet';
}
