/**
 * The replay viewer: watch a bot game one kernel decision at a time.
 *
 * The whole view is a function of two URL parameters — which game and which
 * step — over a log file that was written once. Nothing here re-runs the
 * engine, which is what makes "step forward then back" return the identical
 * frame rather than a recomputed one, and what makes a link to a step a link to
 * the same thing tomorrow.
 *
 * Playback is a timer that advances the same parameter a click would, so paused
 * and playing are the same code path and there is no second source of truth for
 * where in the game you are. Every hand step pauses it, for the same reason:
 * two writers of one cursor would otherwise move the frame out from under the
 * reader who just stepped to look at it. The keys are in `playback-keys.ts` and
 * the frame's own pacing is `steps.ts`'s `dwellMillis`.
 *
 * # The arrangement, and why it is the played table's (`mtg-ryix`)
 *
 * The playtester, 2026-08-14, watching one: "I'd want the sizing to match the play
 * sizing view so you don't need to scroll around so much, and to have the panel
 * on the right be collapsible."
 *
 * This file used to render the same `Board` the play route renders, in ordinary
 * document flow: a head, a transport, a caption, the board, and three panels in
 * an `mtg-grid` under it. Measured in chrome-headless-shell 151.0.7922.34 on
 * game 0 seq 120 of `tools/stage-replay.ts`'s log, the board came out 1038.7px
 * tall at every one of 1440x900, 1280x800, 1024x768 and 810x1080 — it is sized
 * by what its cards want — so the page ran 2,209 to 2,984px and *neither*
 * battlefield was whole at any of them. A game you are watching was a page you
 * scrolled.
 *
 * So the board is now on the play route's own height chain (`styles/views.ts`'s
 * `FIT`, `styles/board/fit.ts` under `board/geometry.ts`'s `TABLE`) rather than
 * on a second set of numbers that happened to agree. The three strips above it
 * are `flex: none` and the table takes what is left, which is the whole of
 * `.mtg-play`'s shape one route over.
 *
 * **The three panels go into the two slots `Board` already offers**, which is
 * where the played table put the same three kinds of block in `mtg-rgc.4`: what
 * is being *asked* goes in the pod column between the two seats, and what has
 * already *happened* goes in the side rail. The decision is this frame's ask, so
 * it takes the ask column and wears `mtg-prompt` — the class the played table's
 * move list wears, so the compact head, the floored body and the cut-edge
 * scroll shadows all arrive from one declaration in `styles/views.ts`. "What
 * happened" and the turn rail are both history, so both take the rail, under the
 * stack and over the graveyards, exactly where the game log sits on the played
 * table. Nothing is under the board any more, and the page does not scroll.
 *
 * The alternative was leaving them in a grid below the fold. It fits the same
 * acceptance criterion and is a different product: the decision panel is what
 * this frame *is*, and a reader who has to leave the board to find out what was
 * chosen is doing the scrolling the bead is about.
 */
import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { UiRoute } from '../../app/router';
import { Board } from '../../board/Board';
import { renderCopy } from '../../copy';
import type { PositionArt } from '../play/position';
import { railToggle, useRailCollapse } from '../play/rail-collapse';
import { DecisionPanel, actionSummary } from './DecisionPanel';
import { EventPanel } from './EventPanel';
import { boardFrame, boardNotes } from './frame';
import { describeResult, namesFor, stepWords } from './narrate';
import type { EventLog, ReplayGameLog } from './read-log';
import { usePlaybackKeys } from './playback-keys';
import { DEFAULT_SPEED_ID, clampSeq, dwellMillis, seqForTurn, speedById, turnsOf } from './steps';
import { Transport } from './Transport';
import { TurnRail } from './TurnRail';

/**
 * The four states a log fetch can be in, which is the same four `DeckRoute`
 * models and for the same reason: a checkout that has never staged one wants
 * the command, and a file that failed the reader wants the line number. A
 * single nullable log makes those one blank page.
 */
export type ReplayState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly log: EventLog }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface ReplayViewerProps {
  readonly state: ReplayState;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  /** What to run to get a log; shown in the `absent` state. */
  readonly sourceHint?: string;
  /**
   * The art manifest's resolver, or absent.
   *
   * The same prop `PlayRoute` takes and for the same reason: a board face always
   * draws its window, so a set with art staged shows it here too. Absent is an
   * ordinary state — a set that has never been through the art pipeline paints
   * the labeled pending frame on every face, which is the true thing to say
   * about it — but it was the *only* state until `mtg-6hrz`, because this
   * component computed a frame and never handed the resolver to it. Which
   * illustration a permanent draws is settled in `./frame.ts`.
   */
  readonly artFor?: PositionArt;
}

const DEFAULT_HINT =
  'Run `npm run play`, which records three bot games into packages/ui/public/replay.events.jsonl before it opens the lab.';

function intParam(route: UiRoute, key: string, fallback: number): number {
  const raw = route.params[key];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : fallback;
}

function emptyState(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

function gamePicker(log: EventLog, index: number, onPick: (index: number) => void): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field' },
    createElement('span', { className: 'mtg-field__label' }, 'Game'),
    createElement(
      'select',
      {
        className: 'mtg-select',
        'aria-label': 'Game',
        value: String(index),
        onChange: (event: { target: { value: string } }) => {
          const picked = Number.parseInt(event.target.value, 10);
          if (Number.isInteger(picked)) onPick(picked);
        },
      },
      ...log.games.map((game) =>
        createElement(
          'option',
          { key: game.index, value: String(game.index) },
          `${game.index + 1}. ${game.seats[0].deck} vs ${game.seats[1].deck} · ${game.result.endedOnTurn} turns`,
        ),
      ),
    ),
  );
}

function lifeCeilingOf(game: ReplayGameLog): number {
  let ceiling = 20;
  for (const step of game.steps) {
    for (const seat of step.state.seats) ceiling = Math.max(ceiling, seat.life);
  }
  return ceiling;
}

export function ReplayViewer(props: ReplayViewerProps): ReactElement {
  const { state, route, onSetParams } = props;
  const hint = props.sourceHint ?? DEFAULT_HINT;
  const log = state.status === 'ready' ? state.log : null;

  const [playing, setPlaying] = useState(false);
  const rail = useRailCollapse();
  const setParams = useRef(onSetParams);
  useEffect(() => {
    setParams.current = onSetParams;
  }, [onSetParams]);

  const games = log?.games ?? [];
  const gameIndex = Math.max(0, Math.min(games.length - 1, intParam(route, 'game', 0)));
  const game = games[gameIndex] ?? null;
  const seq = game === null ? 0 : clampSeq(game, intParam(route, 'seq', 0));
  const speed = speedById(route.params['speed'] ?? DEFAULT_SPEED_ID);
  const stepCount = game?.steps.length ?? 0;

  // How long *this* frame is held. Per frame rather than per tick, because a
  // step is one kernel decision and decisions are unequal amounts of game
  // (`steps.ts`'s `dwellMillis`).
  const current = game?.steps[seq] ?? null;
  const dwell = current === null ? speed.millis : dwellMillis(current, speed);

  useEffect(() => {
    if (!playing) return undefined;
    if (seq >= stepCount - 1) {
      // The log ran out. Stopping here rather than on a dead timer is what puts
      // the control back to Play, which is the only sign a watcher gets that
      // the game is over rather than paused.
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setParams.current({ seq: String(seq + 1) });
    }, dwell);
    return () => {
      clearTimeout(timer);
    };
  }, [playing, seq, stepCount, dwell]);

  // One toggle, shared by the button and the space bar, so there is no second
  // answer to what a press means at the last frame: playback that cannot go
  // forward does not start.
  const togglePlay = useCallback(() => {
    setPlaying((running) => (running ? false : seq < stepCount - 1));
  }, [seq, stepCount]);

  // A hand step always pauses. The two controls would otherwise fight: the
  // timer would move the frame out from under the reader who just stepped to
  // look at it.
  const stepBy = useCallback(
    (delta: number) => {
      if (game === null) return;
      setPlaying(false);
      setParams.current({ seq: String(clampSeq(game, seq + delta)) });
    },
    [game, seq],
  );

  usePlaybackKeys({ onTogglePlay: togglePlay, onStep: stepBy });

  // Rebuilt per step rather than per game, because a target is said as its
  // controller's and control is a fact about a moment (`narrate.ts`).
  const names = useMemo(() => (game === null ? null : namesFor(game, seq)), [game, seq]);
  const turns = useMemo(() => (game === null ? [] : turnsOf(game)), [game]);
  const ceiling = useMemo(() => (game === null ? 20 : lifeCeilingOf(game)), [game]);

  if (log === null || game === null || names === null) {
    switch (state.status) {
      case 'loading':
        return emptyState('Loading the replay', 'Reading the event log.');
      case 'absent':
        return emptyState('No replay recorded yet', hint);
      case 'failed':
        return emptyState('That event log could not be read', state.message);
      case 'ready':
        return emptyState('That event log holds no games', hint);
    }
  }
  const step = game.steps[seq];
  if (step === undefined) {
    return emptyState('That game records no steps', `Game ${gameIndex + 1} of this log is empty.`);
  }

  const nextDecision = game.steps[seq + 1]?.decision ?? null;
  const priority = nextDecision !== null && nextDecision.kind === 'priority' ? nextDecision.player : null;
  const board = boardFrame(game, step.state, step.active, priority, names, props.artFor ?? null);
  const notes = boardNotes(game, step.state, names);

  const head: ReactNode = createElement(
    'div',
    { className: 'mtg-toolbar' },
    gamePicker(log, gameIndex, (picked) => {
      setPlaying(false);
      onSetParams({ game: String(picked), seq: '0' });
    }),
    createElement(
      'span',
      { className: 'mtg-badge', 'data-tone': game.result.winner === null ? 'pending' : 'positive' },
      describeResult(game.result, names),
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement('span', { className: 'mtg-page-note' }, `${log.source} · seed ${game.seed}`),
  );

  const transport = createElement(Transport, {
    seq,
    stepCount,
    turns,
    currentTurn: step.turn,
    playing,
    speedId: speed.id,
    onSeq: (next: number) => {
      setPlaying(false);
      onSetParams({ seq: String(clampSeq(game, next)) });
    },
    onTurn: (turn: number) => {
      setPlaying(false);
      onSetParams({ seq: String(seqForTurn(game, turn)) });
    },
    onTogglePlay: togglePlay,
    onSpeed: (id: string) => {
      onSetParams({ speed: id });
    },
  });

  const caption = createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement(
      'span',
      { className: 'mtg-page-title' },
      `Turn ${step.turn} · ${stepWords(step.step)} · ${names.player(step.active)}`,
    ),
    createElement('span', { className: 'mtg-page-note' }, actionSummary(step.action, names)),
  );

  const onTurn = (turn: number): void => {
    setPlaying(false);
    onSetParams({ seq: String(seqForTurn(game, turn)) });
  };

  return createElement(
    'div',
    {
      className: 'mtg-replay',
      'data-replay-game': String(gameIndex),
      'data-replay-seq': String(seq),
    },
    head,
    transport,
    caption,
    createElement(
      'div',
      { className: 'mtg-replay__table' },
      createElement(Board, {
        ...board,
        railCollapsed: rail.collapsed,
        railHead: railToggle(rail),
        // The ask column: what the kernel put to this seat at this step, and
        // what it chose. `mtg-prompt` is the played table's move list, and this
        // is the same block read from the other end of the game.
        prompt: createElement(DecisionPanel, {
          decision: step.decision,
          names,
          emptyText:
            'This frame is the opening position: shuffles, opening hands, and the first turn beginning.',
        }),
        // The rail: what has already happened, at two scales. `Board` draws the
        // stack over this and the two graveyards under it.
        rail: createElement(
          Fragment,
          null,
          createElement(EventPanel, { events: step.events, notes, names }),
          createElement(TurnRail, {
            turns,
            currentTurn: step.turn,
            names,
            lifeCeiling: ceiling,
            onTurn,
          }),
        ),
      }),
    ),
  );
}
