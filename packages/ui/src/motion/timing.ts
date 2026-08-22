/**
 * Every number the motion layer spends, in one file, each with the reason it is
 * the number it is.
 *
 * `mtg-ncg` asked for the other three surfaces `mtg-81a` left out — your own
 * plays, the stack, and departures — and the moment a card has to travel *from*
 * somewhere the timing stops being one constant in a stylesheet. A move, a mark
 * and the gap between two of them are three different budgets, and a chain of
 * triggers spends them one after another. Scattering them across the runner and
 * the planner would make the pace of the table an emergent property of four
 * files; here it is a table a reader can argue with.
 *
 * The constraint every number below is written against is the playtester's, from the
 * bead that opened this lane: effects happening automatically are jarring, and
 * Magic Online is the reference. Magic Online is deliberate and not slow. The
 * ceiling is therefore not "how long does it look good for" but "how long may a
 * player who has seen this a thousand times be made to wait", and that ceiling
 * is `MOTION_BUDGET_MS`.
 *
 * **None of it is game state.** The same rule `@mtg/kernel`'s `beats.ts` holds
 * for the combat pauses and `../styles/board/arrival.ts` holds for the arrival:
 * nothing here appends to `choices`, reaches a `GameState` field, or can be seen
 * by `stateFingerprint`. The game does not wait for any of it — a cue that is
 * still in flight when the next decision is submitted is canceled, not awaited.
 */
import { ARRIVAL_MS } from '../styles/board/arrival';

/**
 * How long a card takes to travel between two zones.
 *
 * The same 240ms an arriving permanent already spends, imported rather than
 * restated so the two cannot drift: a card that fell into its slot in 240ms and
 * crossed the table in 400 would read as two vocabularies. `arrival.ts` argues
 * the number and the argument is unchanged by the longer distance — under about
 * 150ms a movement reads as a jump rather than as travel, and past about 300ms
 * it is something you wait for.
 */
export const MOVE_MS: number = ARRIVAL_MS;

/**
 * How long a mark on a permanent that is not going anywhere lasts: damage
 * landing, a counter arriving, a trigger naming it.
 *
 * 180ms is `--mtg-duration`, the scale's own middle step, and it is shorter than
 * a move on purpose. A move has to be *followed* — the eye tracks it from one
 * zone to another — and a mark only has to be *noticed*, which is a shorter job.
 * It covers a rise and a fall, so the highlight is at full strength for one
 * frame in the middle rather than held; holding it turns a beat into a state,
 * and what is lasting about damage is the number the board already prints.
 */
export const MARK_MS = 180;

/**
 * The same, for the marks a player has already read a thousand times.
 *
 * Tapping is the one that earns this: it is the most frequent thing on the
 * table, it happens two or three times per land drop, and the board says it
 * outright by rotating the card. So the highlight is a third shorter — enough to
 * say which permanent, not enough to make anyone wait through a mana payment.
 */
export const MARK_FAST_MS = 120;

/**
 * The pace between two cues in one chain — the third acceptance criterion:
 * several triggers resolving read as several things, in order.
 *
 * Below roughly 60ms two starts land inside three frames of each other and the
 * eye reads one event, which is the complaint this lane exists to answer. 90ms
 * lets three triggers read as three inside a third of a second, and the beats
 * overlap rather than queue: the second starts 90ms after the first starts, not
 * 90ms after it ends, so a chain of five moves is 600ms and not 1.65s.
 */
export const BEAT_GAP_MS = 90;

/**
 * The pace between a cue and one that repeats it: the same object moving again,
 * or a second tap in one payment.
 *
 * A third of the full gap. The order still reads, and the case this protects is
 * the sweep — a board wipe, a mass mill, an eight-permanent combat damage step —
 * where paying the full gap per object would spend the whole budget on the first
 * six of them.
 */
export const ECHO_GAP_MS = 30;

/**
 * The hard ceiling on a single chain, from the first cue starting to the last
 * one starting.
 *
 * 900ms. Past about a second a player who knows what is happening is waiting on
 * an animation rather than reading one, and the surface has to be usable at the
 * thousandth repetition rather than the first. Cues past the ceiling are not
 * dropped — dropping one would make the board and the log disagree about
 * whether something happened — they all start at the ceiling, so a sweep of
 * thirty cards paces out for the first stretch and then moves as one wave.
 */
export const MOTION_BUDGET_MS = 900;

/**
 * Decelerating, and the same curve `../styles/board/arrival.ts` chose: the card
 * covers most of the distance early and settles. A linear or accelerating
 * travel reads as a card being dragged into place by something rather than as a
 * card being put down.
 */
export const MOVE_EASING = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
