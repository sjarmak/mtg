/**
 * What one run actually played: the statistics log, summarized.
 *
 * Every rate is printed beside its denominator, and a matchup with too few
 * games says so rather than reporting a 100% win rate off two games.
 *
 * This reads `@mtg/sim`'s statistics JSONL, which is a different log from the
 * one the Analysis tab's dashboard reads — that one takes measured *documents*
 * carrying gate verdicts and their bands, and this one takes per-game rows of
 * 17lands columns. Both are about a run, so `RunSummaryPanels` is exported
 * headless and the dashboard mounts it as its `games` section: the master half
 * of `mtg-2ayr`. The detail half — `ReplayRoute`'s per-game turn walk over the
 * same log — belongs directly under it and is still open.
 *
 * `AnalysisRoute` keeps the heading and the panels together for the callers
 * that render it as a whole route, which is every test that checks this
 * package draws exactly one `h1` per screen.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderCopy } from '../copy';
import { matchupRows, ratePercent, summarizeLog } from '../replay/summary';
import type { MatchupRow, ReplaySummary } from '../replay/summary';
import { END_REASONS } from '../replay/columns';
import type { ReplayLog } from '../replay/types';

/** Below this many games a matchup rate is reported as under-sampled. */
export const MIN_MATCHUP_GAMES = 30;

/**
 * The four states reading a statistics log can be in (`mtg-ey8g`).
 *
 * The same four `DeckState`, `ReplayState` and `PlaySetState` model. This route
 * took `ReplayLog | null` instead, and its one caller held a real three-state
 * load and flattened it here — so a log still being read and a log the reader
 * refused drew the same empty page, separated only by prose in a hint, and
 * there was no `absent` at all. A checkout that has never produced a log is the
 * commonest state of the three and was the one that could not be said.
 */
export type AnalysisLogState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly log: ReplayLog }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface AnalysisRouteProps {
  readonly state: AnalysisLogState;
  /** Where a log would come from, shown in the `absent` state. */
  readonly sourceHint?: string;
}

function panel(title: string, note: string, body: ReactNode): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, title),
      createElement('span', { className: 'mtg-panel__note' }, note),
    ),
    createElement('div', { className: 'mtg-panel__body' }, body),
  );
}

function definitions(rows: readonly (readonly [string, string])[]): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-dl' },
    ...rows.flatMap(([key, value]) => [
      createElement('span', { key: `${key}-k`, className: 'mtg-dl__key' }, key),
      createElement('span', { key: `${key}-v`, className: 'mtg-dl__value' }, value),
    ]),
  );
}

/**
 * Which set these games were played in.
 *
 * The `mtg-ihtz` half that belongs to the page. A statistics log is about one
 * set, the page never said which, and the two things a person has to hand — the
 * lab's own staged set and the run in front of them — looked like the same
 * thing. They were not: the served log was three games of TGR under whatever
 * set had been opened. The launcher refuses that now, but a log put in
 * `public/` by hand still reaches this panel, so the panel names its subject.
 *
 * Read off the games rather than the header, because the header does not carry
 * a set; a log whose rows disagree says so instead of picking one.
 */
function subject(log: ReplayLog): string {
  const codes = [...new Set(log.games.map((game) => game.metadata.expansion))];
  return codes.length === 0 ? 'no games in file' : codes.join(', ');
}

/**
 * The Run panel's note: the count, and whether it is the whole run.
 *
 * A file holding fewer games than its header declares is a slice of a run, and
 * every rate below it is a rate over the slice. This used to be two unremarked
 * rows of the list — "games read 3", "games declared in header 135" — which is
 * the whole difference stated and none of it said.
 */
function runNote(summary: ReplaySummary, log: ReplayLog): string {
  if (summary.games >= log.declaredGames) return `${summary.games} games`;
  return `${summary.games} of ${log.declaredGames} games in the run`;
}

function overview(summary: ReplaySummary, log: ReplayLog): ReactElement {
  const rows: (readonly [string, string])[] = [
    ['set', subject(log)],
    ['games read', String(summary.games)],
    ['run seed', log.runSeed],
    [
      'seat 0 (user) wins',
      `${summary.winsBySide.user} · ${ratePercent(summary.winsBySide.user, summary.games)}`,
    ],
    [
      'seat 1 (oppo) wins',
      `${summary.winsBySide.oppo} · ${ratePercent(summary.winsBySide.oppo, summary.games)}`,
    ],
    ['draws', String(summary.draws)],
    ['on the play wins', `${summary.onPlayWins} · ${ratePercent(summary.onPlayWins, summary.games)}`],
    ['turns (min/median/max)', `${summary.turns.min} / ${summary.turns.median} / ${summary.turns.max}`],
    ['mean turns', summary.turns.mean.toFixed(2)],
    ['mean decisions per game', summary.meanDecisions.toFixed(1)],
  ];
  return definitions(rows);
}

function endReasons(summary: ReplaySummary): ReactElement {
  return definitions(
    END_REASONS.map(
      (reason) =>
        [
          reason,
          `${summary.endReasons[reason]} · ${ratePercent(summary.endReasons[reason], summary.games)}`,
        ] as const,
    ),
  );
}

function matchupTable(rows: readonly MatchupRow[]): ReactElement {
  const head = createElement(
    'tr',
    null,
    createElement('th', { key: 'm' }, 'Matchup'),
    createElement('th', { key: 'g', 'data-align': 'right' }, 'Games'),
    createElement('th', { key: 'w', 'data-align': 'right' }, 'Seat 0 wins'),
    createElement('th', { key: 'r', 'data-align': 'right' }, 'Rate'),
  );
  const body = rows.map((row) =>
    createElement(
      'tr',
      { key: row.key },
      createElement('td', { key: 'm' }, `${row.userDeck} vs ${row.oppoDeck}`),
      createElement('td', { key: 'g', 'data-align': 'right', className: 'mtg-num' }, String(row.games)),
      createElement('td', { key: 'w', 'data-align': 'right', className: 'mtg-num' }, String(row.userWins)),
      createElement(
        'td',
        { key: 'r', 'data-align': 'right', className: 'mtg-num' },
        row.games < MIN_MATCHUP_GAMES
          ? `${ratePercent(row.userWins, row.games)}*`
          : ratePercent(row.userWins, row.games),
      ),
    ),
  );
  return createElement(
    'div',
    { className: 'mtg-scroll' },
    createElement(
      'table',
      { className: 'mtg-table' },
      createElement('thead', null, head),
      createElement('tbody', null, ...body),
    ),
  );
}

/**
 * The page title, in every state.
 *
 * A route that drops its heading when it has no data leaves a person reading
 * the shell to work out where they are, and leaves the document with no
 * landmark at all. The note is the only part that varies.
 */
function pageHead(note: string | null): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Run analysis'),
    note === null ? null : createElement('span', { className: 'mtg-page-note' }, note),
  );
}

function empty(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

export interface RunSummaryPanelsProps {
  readonly state: AnalysisLogState;
  readonly sourceHint?: string;
}

export const NO_LOG_HINT =
  'Run `npm run slice` to produce `out/slice/logs/replay.jsonl`, then load it into this view.';

/**
 * The panels without the page heading, so another route can mount them.
 *
 * Each of the three non-ready states is drawn as itself rather than as one
 * blank page: `absent` names the command that writes a log, `failed` carries
 * the reader\'s own message, and `loading` says it is still reading.
 */
export function RunSummaryPanels(props: RunSummaryPanelsProps): ReactElement {
  const { state } = props;
  if (state.status === 'loading') return empty('Reading the statistics log…', 'One moment.');
  if (state.status === 'absent') return empty('Nothing measured yet', props.sourceHint ?? NO_LOG_HINT);
  if (state.status === 'failed') return empty('That statistics log could not be read', state.message);

  const { log } = state;
  const summary = summarizeLog(log);
  const rows = matchupRows(log.games);
  const underSampled = rows.some((row) => row.games < MIN_MATCHUP_GAMES);

  return createElement(
    'div',
    { className: 'mtg-grid' },
    panel('Run', runNote(summary, log), overview(summary, log)),
    panel('How games ended', `${summary.games} games`, endReasons(summary)),
    panel(
      'Matchups',
      underSampled ? `* fewer than ${MIN_MATCHUP_GAMES} games` : `${rows.length} pairings`,
      matchupTable(rows),
    ),
  );
}

export function AnalysisRoute(props: AnalysisRouteProps): ReactElement {
  const { state } = props;
  return createElement(
    'div',
    null,
    pageHead(state.status === 'ready' ? `schema ${state.log.schemaVersion}` : null),
    createElement(RunSummaryPanels, props),
  );
}
