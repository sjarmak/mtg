/**
 * A dealt game, held and drawn.
 *
 * Both entry points render this — the route when a caller hands it a ready-made
 * game, the sealed screen for the game it just dealt — so the session and the
 * error line live in one place rather than in two that drift.
 *
 * The board is drawn from the seat being asked, and in a one-person game that
 * seat never moves: the session only ever stops on that person's seat. The
 * card that once covered the table while a shared screen changed hands left
 * with the shared-screen arm; two human seats survive only as a test fixture.
 */
import { createElement, useCallback, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { GameplayReport } from '../../net/gameplay';
import type { PositionArt } from './position';
import { OpeningRollBeat } from './OpeningRoll';
import { openingRollText } from './opening-roll';
import { PlayView } from './PlayView';
import { useFeedbackSubject } from '../../feedback/subject';
import type { FeedbackSubject } from '../../feedback/wire';
import { useGameplayReport } from './use-gameplay-report';
import { usePlaySession } from './use-session';
import type { PlayConfig } from './use-session';

export interface LiveGameProps {
  readonly config: PlayConfig;
  /**
   * Where the finished game is reported, or null for a surface that records
   * nothing. Required rather than defaulted, so a new surface states which it
   * is; `../../net/gameplay.ts` builds one from the format it dealt.
   */
  readonly report: GameplayReport | null;
  /** Controls belonging to whatever dealt the game; they join `PlayView`'s own strip. */
  readonly toolbar?: ReactNode;
  /** Passed straight through to the table; see `PlayView`. */
  readonly artFor?: PositionArt;
}

export function LiveGame(props: LiveGameProps): ReactElement {
  const {
    session,
    viewer,
    beat,
    resume,
    choose,
    restart,
    error,
    autoPass,
    setAutoPass,
    watchBeats,
    setWatchBeats,
    yieldTo,
    triggerYields,
    yieldToTrigger,
    clearTriggerYield,
    undo,
    canUndo,
  } = usePlaySession(props.config);
  // Reported once per finished game, and said on the root so a rig can read
  // whether the lab kept it without a network of its own.
  const gameplay = useGameplayReport(session, props.config, props.report);
  const names = props.config.names;
  // What a feedback report written over this board says the board was: the
  // config and the choice list, which is the whole game, read at filing time.
  const latest = useRef({ session, config: props.config, beat });
  latest.current = { session, config: props.config, beat };
  const readSubject = useCallback(
    (): FeedbackSubject => ({
      kind: 'kernel-game',
      config: latest.current.config,
      choices: latest.current.session.choices,
      beat: latest.current.beat,
      finished: latest.current.session.result !== null,
    }),
    [],
  );
  useFeedbackSubject(readSubject);
  const [rolled, setRolled] = useState(false);
  const finishRoll = useCallback((): void => {
    setRolled(true);
  }, []);
  const roll = props.config.openingRoll;
  const rollBeat = roll !== undefined && (props.config.choices ?? []).length === 0 && !rolled;
  const rollNote =
    roll === undefined || session.state.turn.number > 1
      ? undefined
      : createElement('p', { className: 'mtg-page-note', role: 'status' }, openingRollText(roll, names));

  // Named for the same reason `PlayRoute`'s root is: this wrapper is a link in
  // the chain that carries the viewport's leftover height down to the table.
  return createElement(
    'div',
    {
      className: 'mtg-live',
      ...(gameplay === null ? {} : { 'data-mtg-gameplay': gameplay.status }),
      ...(gameplay?.status === 'recorded' ? { 'data-mtg-gameplay-id': gameplay.id } : {}),
      ...(gameplay?.status === 'refused' ? { 'data-mtg-gameplay-reason': gameplay.reason } : {}),
    },
    error === null ? null : createElement('p', { className: 'mtg-prompt__warning', role: 'alert' }, error),
    rollBeat
      ? createElement(OpeningRollBeat, { roll, names, viewer: props.config.viewer, onDone: finishRoll })
      : null,
    createElement(PlayView, {
      session,
      viewer,
      names,
      onChoose: choose,
      onNewGame: restart,
      beat,
      onContinue: resume,
      // The auto-pass controls belong to whoever holds the session, which is
      // this component: they are settings for the seat being asked.
      autoPass,
      onAutoPass: setAutoPass,
      // And the pauses, which belong to the same owner for the same reason
      // (`mtg-885`). One screen, one person's pacing: this is the component
      // that owns the session, so it is the one that can change an option on
      // it without the change reaching anything the game records.
      beats: watchBeats,
      onBeats: setWatchBeats,
      onYield: yieldTo,
      // The third yield, from the same owner and for the same reason
      // (`./trigger-yields.ts`, `mtg-bz2.7`). All three of these arrive
      // together: the prompt's pair sets an answer, the panel's list is the
      // only way back out of one, and a view given one half would offer a
      // setting a player could not undo.
      onTriggerYield: yieldToTrigger,
      triggerYields,
      onClearTriggerYield: clearTriggerYield,
      // The rewind, from the component that owns the session. Its refusal
      // reaches the alert this file already draws above the table, which is
      // the whole reason the control presses through where `canUndo` is
      // false; `./undo.ts` argues it.
      onUndo: undo,
      canUndo,
      ...(props.toolbar === undefined ? {} : { toolbar: props.toolbar }),
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
      ...(rollNote === undefined ? {} : { status: rollNote }),
    }),
  );
}
