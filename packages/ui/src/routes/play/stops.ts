/**
 * One step's stop, as the four states a single control can cycle through.
 *
 * The kernel already models stops, and this adds no model (`@mtg/kernel`'s
 * `autopass.ts`): `StopSet` is two sets of steps, one per turn side, and every
 * function here is a reading or a rewriting of that pair through `hasStop` and
 * `toggleStop`. Nothing about a stop is stored twice, and nothing here reaches
 * `GameState` — a stop set travels in `SessionOptions` and stays out of the
 * fingerprint, the fork and the replay, which is a hard invariant that module
 * states at length.
 *
 * **Four states rather than three, because the model has four.** The playtester's
 * sketch (`mtg-bz2.1`) names three marks — no stop, a stop on your turn, a stop
 * on your opponent's — and adds that "advanced settings could allow separate
 * stops for your turn and your opponent's turn". A pair of independent booleans
 * has four settings, not three, and a player holding a counterspell wants their
 * own end step *and* their opponent's often enough that the fourth is the one
 * they reach for. So the advanced setting is not a second surface: it is the
 * fourth position of the same cycle, and every state the kernel can represent is
 * four presses or fewer away on the node that owns it. A control that cannot
 * reach a representable state is a bug, and the cheapest way not to have one is
 * to make the cycle the whole product.
 *
 * **The order is none → own turn → opponent's turn → both → none**, and the
 * reasoning is that each press adds rather than removes until the last one
 * clears. A player who presses once has said "ask me here on my turn", twice
 * "on theirs instead", three times "on both"; the fourth press is the way out
 * and returns the node to where it started, so no press is unrecoverable and
 * none of them needs a modifier key. Own turn comes before the opponent's
 * because the default set stops on two of the player's own steps and none of
 * anybody else's: the first press should move a node the way the defaults
 * already lean.
 *
 * **Four states press, two rows read** (`mtg-rgc.2`). The cycle above is how a
 * node is *set* and it has not moved. What changed is how a node is *read*: the
 * four states used to be four glyphs in one slot, so telling a filled circle
 * from a filled diamond from a diamond with a filled center was the whole of
 * knowing whose turn a stop was for. Magic Online does not encode it in the
 * shape at all — it draws two rows of triangles, one per player, above and below
 * the step name, and whose stop it is comes from *which row the mark is in*.
 * That is two independent bits at two fixed positions instead of one four-way
 * shape, and it maps onto `StopSet` exactly, since a stop set is already two
 * sets keyed by side. So the marks below are per row, and the state table is
 * what says which rows a state fills.
 */
import type { AutoPassSettings, Step, TurnSide } from '@mtg/kernel';
import { hasStop, toggleStop } from '@mtg/kernel';

/** What one node on the phase bar is set to. */
export type StopState = 'none' | 'yourTurn' | 'theirTurn' | 'both';

/** The cycle, in press order. Exported so the tests read the order rather than restating it. */
export const STOP_CYCLE: readonly StopState[] = ['none', 'yourTurn', 'theirTurn', 'both'];

/**
 * Which halves of the stop set a state names.
 *
 * Exported because the bar reads it to decide which of a node's two rows carry
 * a filled mark, and a second table saying the same thing is a second table free
 * to disagree with the writer below.
 */
export const STOP_STATE_SIDES: Readonly<Record<StopState, readonly TurnSide[]>> = {
  none: [],
  yourTurn: ['yourTurn'],
  theirTurn: ['theirTurn'],
  both: ['yourTurn', 'theirTurn'],
};

/**
 * The state a node is in, read off the kernel's two sets.
 *
 * Derived on every render rather than held beside them, so the bar cannot
 * disagree with the settings the session is actually being advanced with.
 */
export function stopStateOf(settings: AutoPassSettings, step: Step): StopState {
  const yours = hasStop(settings.stops, 'yourTurn', step);
  const theirs = hasStop(settings.stops, 'theirTurn', step);
  if (yours && theirs) return 'both';
  if (yours) return 'yourTurn';
  if (theirs) return 'theirTurn';
  return 'none';
}

/** The next state one press reaches, wrapping at the end of the cycle. */
export function nextStopState(state: StopState): StopState {
  const at = STOP_CYCLE.indexOf(state);
  return STOP_CYCLE[(at + 1) % STOP_CYCLE.length] ?? 'none';
}

/**
 * Settings with one step set to exactly `state`, built out of the kernel's own
 * toggle rather than by writing a `StopSet` here.
 *
 * `toggleStop` is the one function that knows how to copy a stop set, so going
 * through it twice is what keeps this module from being a second implementation
 * of the model it is a control for. The input is untouched, as it is there.
 */
export function withStopState(settings: AutoPassSettings, step: Step, state: StopState): AutoPassSettings {
  const wanted = STOP_STATE_SIDES[state];
  let next = settings;
  for (const side of ['yourTurn', 'theirTurn'] as const) {
    if (hasStop(next.stops, side, step) !== wanted.includes(side)) next = toggleStop(next, side, step);
  }
  return next;
}

/** What one press of a node does. */
export function cycleStop(settings: AutoPassSettings, step: Step): AutoPassSettings {
  return withStopState(settings, step, nextStopState(stopStateOf(settings, step)));
}

/**
 * Each state as a word, which is the state a screen reader gets.
 *
 * A mark is a shape, and a shape has no accessible name; these are what go in
 * the node's own name and in the announcement after a press. "Own turn" and
 * "opponent's turn" rather than "yours" and "theirs", for the reason the seat
 * names and the prompt copy stopped saying "you": two people share this screen
 * and the seat a pronoun resolves against changes every time the question
 * crosses the table. A stop set is one-sided relative to whoever is being asked,
 * which is what those two words mean here.
 */
export const STOP_STATE_WORDS: Readonly<Record<StopState, string>> = {
  none: 'no stop',
  yourTurn: 'stop on own turn',
  theirTurn: "stop on opponent's turn",
  both: 'stop on both turns',
};

/**
 * The two rows a node draws, top to bottom, in the order the board draws the
 * seats.
 *
 * The opponent's row is above the step name and the player's own is below it,
 * which is where each of those two people already is: `board/Board.ts` puts the
 * opponent's side at the top of the mat and the viewer's at the bottom. A bar
 * that reversed them would be asking a player to hold two opposite conventions
 * on one screen.
 */
export const STOP_ROWS: readonly [TurnSide, TurnSide] = ['theirTurn', 'yourTurn'];

/** One row's two marks: a stop set there, and a step that could hold one. */
export interface RowMarks {
  readonly set: string;
  readonly unset: string;
}

/**
 * Each row's marks, which is what an eye gets from across the strip.
 *
 * A triangle pointing at the step name it belongs to, filled when the stop is
 * set and hollow when it is not — Magic Online's own encoding, and the reason it
 * survives twenty years of use is that the two facts a player wants ("is there a
 * stop" and "whose") come off two different channels instead of one four-way
 * shape. Hollow rather than absent, because a blank says two different things at
 * once: this step holds no stop, and this step can hold none. Untap and cleanup
 * draw no row at all, which is the second of those.
 *
 * Fill carries the meaning and color only reinforces it, so the marks stay
 * legible with no color at all — WCAG 1.4.1. They are `aria-hidden` wherever
 * they are drawn and `TurnStops.ts` prints `MARK_LEGEND` beside them, because a
 * shape nobody has been told the meaning of is decoration.
 */
export const STOP_ROW_MARKS: Readonly<Record<TurnSide, RowMarks>> = {
  theirTurn: { set: '▼', unset: '▽' },
  yourTurn: { set: '▲', unset: '△' },
};

/**
 * The mark for a step the game *pauses* in, which is the third kind and belongs
 * to neither row.
 *
 * A beat is not a stop (`@mtg/kernel`'s `beats.ts`): it asks nothing, records
 * nothing, and is not set by pressing the node it appears on. So it takes
 * neither player's row and neither player's shape — it sits on the name line, in
 * the pause glyph, which is the one mark on the bar that means "the client
 * stops here to show you something" rather than "you will be asked here".
 *
 * Three kinds of mark, three places, three shapes: above and triangular is the
 * opponent's stop, below and triangular is yours, and inline and vertical is a
 * pause. None of them is a state of either of the others.
 */
export const BEAT_MARK = '‖';

/** One line of the panel's legend. */
export interface MarkMeaning {
  readonly key: string;
  readonly mark: string;
  readonly meaning: string;
}

/**
 * What every mark on the bar means, as the words a sighted player has nowhere
 * else to read.
 *
 * The rows and the pause in one list because they are one picture: a player
 * looking at the damage node sees up to three marks on it and needs all three
 * named. Order matches the node's own, top to bottom, with the pause last
 * because it is the one that is not a setting.
 */
export const MARK_LEGEND: readonly MarkMeaning[] = [
  {
    key: 'theirTurn',
    mark: STOP_ROW_MARKS.theirTurn.set,
    meaning: `above the step: ${STOP_STATE_WORDS.theirTurn}`,
  },
  {
    key: 'yourTurn',
    mark: STOP_ROW_MARKS.yourTurn.set,
    meaning: `below the step: ${STOP_STATE_WORDS.yourTurn}`,
  },
  {
    key: 'none',
    mark: `${STOP_ROW_MARKS.theirTurn.unset}${STOP_ROW_MARKS.yourTurn.unset}`,
    meaning: `hollow in either row: ${STOP_STATE_WORDS.none} there yet`,
  },
  {
    key: 'beat',
    mark: BEAT_MARK,
    meaning: 'on the step name: the game pauses to show combat, which is not a stop and is not set here',
  },
];
