/**
 * Holding a game in React state.
 *
 * Sessions are immutable values, so this is a `useState` and nothing more: a
 * choice produces a new session and React re-renders. There is no reducer, no
 * effect, and no subscription, because the kernel has no clock of its own and
 * never advances behind the player's back. Bot turns are played inside `choose`,
 * synchronously, before the next render.
 *
 * The choice list is kept as well as the session, so the game a player is
 * halfway through can be written down as a seed plus integers and picked up
 * again later.
 *
 * **Undo is that list read the other way** (`mtg-bz2.13`). Rewinding is a replay
 * of a shorter prefix, so it needs the setup this hook already holds and nothing
 * else; how short a prefix is allowed is the kernel's call, and `@mtg/kernel`'s
 * `undo.ts` argues the boundary set. This layer owns only the two halves a
 * person touches: the press, and the refusal reaching the error line. That is a
 * different mechanism from the one `selection.ts` holds, and the two must not be
 * confused — changing a declaration before it is submitted is interaction state
 * that never reached the kernel, and taking a submitted one back is this.
 *
 * Which seat the board is drawn from is decided here too, by `seatOnDeck`. It
 * belongs with the session rather than with the configuration because it is a
 * fact about the game's current position, not about how the game was set up.
 */
import { useCallback, useMemo, useState } from 'react';
import type {
  AutoPassSettings,
  BeatSet,
  Choice,
  Beat,
  GameSession,
  GameSetup,
  PlayerId,
  Seat,
  SessionOptions,
  YieldBoundary,
} from '@mtg/kernel';
import {
  advance,
  canUndo as anyUncommitted,
  choose as applyChoice,
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_BEATS,
  undo as undoToBoundary,
  yieldPriority,
} from '@mtg/kernel';
import type { SeatNames } from './position';

export interface PlayConfig {
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  /**
   * Whose side of the table is drawn nearest while nobody is being asked — the
   * seat the game opens on, and the one it settles back to once it is over.
   * While a decision is pending the board follows the seat that owes it.
   */
  readonly viewer: PlayerId;
  readonly names: SeatNames;
  /** Replayed on start, so a recorded game can be resumed. */
  readonly choices?: readonly Choice[] | undefined;
  /**
   * Which priorities the human seat is asked about. Absent takes the default
   * stop set, which is what a player who has configured nothing should get.
   */
  readonly autoPass?: AutoPassSettings | undefined;
  /**
   * Which moments of a combat the game pauses at so they can be watched. Absent
   * takes all three, which is what `mtg-0sn` is: a combat that resolved inside
   * one click showed the player nothing at all.
   *
   * Held here rather than in `autoPass` because it is not a stop and the kernel
   * keeps the two apart for a reason `@mtg/kernel`'s `beats.ts` argues at
   * length. It is the *opening* setting: `mtg-885` put a toggle at the end of
   * the step bar, so this seeds a value the player can then change, exactly as
   * `autoPass` does.
   */
  readonly watchBeats?: BeatSet | undefined;
}

export interface PlaySessionHandle {
  readonly session: GameSession;
  /** The seat the board should be drawn from right now. */
  readonly viewer: PlayerId;
  /**
   * The combat moment the game is paused on, or null when it is not paused.
   *
   * Lifted out of `session` so a component takes it beside `onContinue` rather
   * than reaching into a session for one field; `PlayView` draws a `SessionView`
   * and a beat is not on one, for the reason given there.
   */
  readonly beat: Beat | null;
  /** Picks the game up from a pause. A no-op when it is not paused. */
  readonly resume: () => void;
  readonly choose: (choice: Choice) => void;
  readonly restart: () => void;
  /** Set when the last choice threw, so the UI can say so instead of blanking. */
  readonly error: string | null;
  /** The live auto-pass settings, and the one way to change them. */
  readonly autoPass: AutoPassSettings;
  readonly setAutoPass: (next: AutoPassSettings) => void;
  /**
   * Which combat moments the game pauses at, and the one way to change them.
   *
   * Beside `autoPass` rather than inside it, which is the same separation the
   * kernel keeps: a stop is a question and a beat is a pause, and `SessionOptions`
   * carries them as two fields for a reason `beats.ts` argues at length. Both are
   * options rather than state, so neither reaches `GameState`, neither is
   * recorded, and a game played with the pauses off replays byte for byte as one
   * played with them on.
   */
  readonly watchBeats: BeatSet;
  readonly setWatchBeats: (next: BeatSet) => void;
  /** Passes to a boundary; see `yieldPriority`. A no-op with nothing pending. */
  readonly yieldTo: (boundary: YieldBoundary) => void;
  /**
   * Takes every decision back to the last commit boundary, or puts the reason it
   * cannot on `error`. Never a no-op: see the comment on the callback.
   */
  readonly undo: () => void;
  /**
   * Whether a press would move the game. For drawing the control, not for
   * guarding it — pressing it while this is false is what produces the stated
   * reason, so a control that refused to call `undo` here would be the silence
   * the whole feature is against.
   */
  readonly canUndo: boolean;
}

/**
 * The session and the seat its board is drawn from, held as one value.
 *
 * They are one value because the seat is not always derivable from the session.
 * While a decision is pending it is exactly the seat that owes it; while the
 * game is paused on a combat beat nobody owes anything, and the answer has to be
 * "whoever we were already showing".
 *
 * With one person at the screen the distinction is invisible: the only seat the
 * session ever stops on is theirs. With two people at one screen it is the whole
 * ball game — the revealed hand belongs to whoever is being asked, so a viewer
 * that fell back to a configured seat would put player 0's hand on a screen
 * player 1 is holding, every time a beat paused a combat player 1 was in.
 * Hidden information is this surface's whole job and it fails silently: nothing
 * on screen says the hand you are looking at is not yours to see.
 *
 * Private to this module. It is the rule `usePlaySession` applies rather than a
 * question a caller gets to ask separately: a caller that could compute its own
 * viewer is a caller that could disagree with the session about whose hand to
 * show, which is the one bug this whole file exists to make unavailable.
 */
interface HeldGame {
  readonly session: GameSession;
  readonly viewer: PlayerId;
}

function held(session: GameSession, previous: PlayerId): HeldGame {
  return { session, viewer: session.pending?.player ?? previous };
}

/**
 * Deals the game and settles it, replaying any recording on the way.
 *
 * **The replay runs at full control and the settling does not**, which is the
 * one ordering fact this function carries. An auto-passed priority is recorded
 * as a choice, so replaying it under auto-pass would consume the decision
 * without consuming the integer that recorded it and every choice after would
 * land one question late; `replaySession` in the kernel says the same thing at
 * more length. So the recorded prefix is spent with every priority asked about,
 * and only then does `advance` hand the tail to the settings.
 *
 * The settling honors the combat beats, so resuming a recording that ends inside
 * a combat opens on the beat rather than past it. That is the same sentence as
 * everywhere else here: the pause is where the game is, not a thing the surface
 * decides to do about it.
 */
function start(config: PlayConfig, options: SessionOptions): GameSession {
  let session = createSession(config.setup, config.seats);
  for (const choice of config.choices ?? []) {
    if (session.pending === null) break;
    session = applyChoice(session, choice);
  }
  return advance(session, options);
}

export function usePlaySession(config: PlayConfig): PlaySessionHandle {
  const [autoPass, setSettings] = useState<AutoPassSettings>(config.autoPass ?? DEFAULT_AUTO_PASS);
  const [watchBeats, setBeats] = useState<BeatSet>(config.watchBeats ?? DEFAULT_BEATS);
  const [game, setGame] = useState<HeldGame>(() =>
    held(start(config, { autoPass: config.autoPass ?? DEFAULT_AUTO_PASS, watchBeats }), config.viewer),
  );
  const session = game.session;
  const [error, setError] = useState<string | null>(null);

  /**
   * Every path that moves the session, wrapped once.
   *
   * A throw from any of them is a bug in this layer rather than an illegal move
   * — a chosen index came from the list the kernel just handed out, and a
   * settings change cannot make an action illegal — so it is surfaced instead of
   * losing the game in progress.
   */
  const moveSession = useCallback((move: (current: GameSession) => GameSession): void => {
    setError(null);
    setGame((current) => {
      try {
        return held(move(current.session), current.viewer);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return current;
      }
    });
  }, []);

  const options: SessionOptions = useMemo(
    (): SessionOptions => ({ autoPass, watchBeats }),
    [autoPass, watchBeats],
  );

  const choose = useCallback(
    (choice: Choice): void => {
      moveSession((current) => applyChoice(current, choice, options));
    },
    [moveSession, options],
  );

  /**
   * Changing the settings re-settles the session rather than waiting for the
   * next click. Turning full control off while sitting on a priority nobody has
   * anything to do with should move the game on, which is what the player just
   * asked for; `advance` is exported for exactly this and touches no state that
   * a choice would not have.
   */
  const setAutoPass = useCallback(
    (next: AutoPassSettings): void => {
      setSettings(next);
      moveSession((current) => advance(current, { autoPass: next, watchBeats }));
    },
    [moveSession, watchBeats],
  );

  /**
   * Turning the pauses off, or back on, mid-game.
   *
   * It re-settles for the same reason `setAutoPass` does, and here the reason is
   * sharper: a player who turns the beats off is very often looking at one, and
   * "stop pausing" has to mean the game moves rather than that the next combat
   * behaves differently. `advance` clears the beat on entry, so the same call
   * that changes the setting is also the resume. Turning them back on settles an
   * already settled position, which costs nothing and pauses nowhere.
   *
   * Nothing recorded changes either way. A beat produces no choice, so the seed
   * and the choice list are identical whichever way this is set, which is what
   * keeps `replaySession` and `stateFingerprint` blind to it.
   */
  const setWatchBeats = useCallback(
    (next: BeatSet): void => {
      setBeats(next);
      moveSession((current) => advance(current, { autoPass, watchBeats: next }));
    },
    [moveSession, autoPass],
  );

  /**
   * Picks the game up from a combat beat.
   *
   * `advance` on a paused session is the resume — the kernel clears the beat and
   * runs the loop on — and on a session that is not paused it settles a position
   * that is already settled, which is why this needs no guard of its own.
   */
  const resume = useCallback((): void => {
    moveSession((current) => advance(current, options));
  }, [moveSession, options]);

  const yieldTo = useCallback(
    (boundary: YieldBoundary): void => {
      moveSession((current) => yieldPriority(current, boundary, options));
    },
    [moveSession, options],
  );

  /**
   * The rewind, and the one place on this surface where a throw is not a bug.
   *
   * `moveSession` already turns anything thrown into the error line and leaves
   * the session alone, which is exactly the behavior a refused undo wants:
   * `UndoRefusedError` carries the boundary's own sentence, so the player is
   * told which event closed the game behind them rather than watching a button
   * do nothing. The kernel decides; `@mtg/kernel`'s `undo.ts` argues the set.
   *
   * It rewinds through `config.setup`, the same seed `start` deals from, so the
   * landed position is the one the game actually stood in rather than a
   * reconstruction of it.
   */
  const undo = useCallback((): void => {
    moveSession((current) => undoToBoundary(config.setup, current, options));
  }, [moveSession, config.setup, options]);

  const restart = useCallback((): void => {
    setError(null);
    setGame(held(start(config, { autoPass, watchBeats }), config.viewer));
  }, [config, autoPass, watchBeats]);

  const viewer = game.viewer;

  return useMemo(
    (): PlaySessionHandle => ({
      session,
      viewer,
      beat: session.beat,
      resume,
      choose,
      restart,
      error,
      autoPass,
      setAutoPass,
      watchBeats,
      setWatchBeats,
      yieldTo,
      undo,
      canUndo: anyUncommitted(session),
    }),
    [
      session,
      viewer,
      resume,
      choose,
      restart,
      error,
      autoPass,
      setAutoPass,
      watchBeats,
      setWatchBeats,
      yieldTo,
      undo,
    ],
  );
}
