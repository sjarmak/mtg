/**
 * How fast the table moves, as one setting rather than as ten constants.
 *
 * `mtg-kwu`: `@mtg/ui`'s `motion/timing.ts` argues every duration the motion
 * layer spends, and argues them well, but it argues them for one player — the
 * one the numbers were tuned against. A player who has seen a thousand board
 * wipes wants them over with; a player learning what a trigger even is wants to
 * watch one land. Both are asking for the same thing, a multiplier, and neither
 * is asking for a different set of constants.
 *
 * So this file holds a scale and nothing else. `motion/timing.ts` keeps every
 * number and every reason; a pace multiplies them. That split is what keeps the
 * setting honest: `slow` cannot make a mark outlast a move, and `quick` cannot
 * collapse the gap between two triggers below the point where they read as one,
 * because the *ratios* those numbers encode are not the setting's to change.
 *
 * **None of it is game state**, which is the acceptance criterion of the bead
 * and the reason this lives here rather than in `SessionOptions`. A pace scales
 * how long a rendering takes; it appends nothing to `choices`, reaches no
 * `GameState` field, and `stateFingerprint` over a game is the same whatever it
 * is set to. The combat beats are the near miss worth naming: those are also
 * pacing, they are also the playtester's complaint about things happening too fast,
 * and they are *not* here — a beat is dismissed by the player, so it has no
 * duration to scale. `still` is the same distinction one step further: motion
 * off is off, never a one-millisecond travel.
 */

/**
 * The four settings, in the order a control cycles them.
 *
 * Four rather than a slider. A slider over a multiplier invites a player to pick
 * 1.37 and then to wonder whether 1.42 is better, which is a question with no
 * answer; four named speeds are four decisions someone can actually make. The
 * order is the order of increasing patience, so cycling forward always means
 * "slower" and a player who overshoots knows which way to keep going.
 */
export const PACES = ['still', 'quick', 'normal', 'slow'] as const;

/** One of `PACES`. */
export type Pace = (typeof PACES)[number];

/**
 * What an unconfigured surface moves at: the pace `motion/timing.ts`'s numbers
 * were argued at, so a player who never finds the control sees exactly the
 * table this lane was tuned to produce.
 */
export const DEFAULT_PACE: Pace = 'normal';

/**
 * The multiplier each pace applies to every duration in `motion/timing.ts` and to
 * every animation in the board's sheets.
 *
 * `quick` is 0.7, and the two floors `motion/timing.ts` states are what fixed it
 * rather than a preference for round numbers. That file names roughly 60ms as
 * the point below which two starts land inside three frames of each other and
 * the eye reads one event, and roughly 150ms as the point below which a movement
 * reads as a jump rather than as travel. 0.7 puts `BEAT_GAP_MS` at 63ms and
 * `MOVE_MS` at 168ms, which clears both; the obvious 0.5 puts them at 45 and
 * 120, which clears neither, and a speed setting that silently breaks the
 * acceptance criteria of the lane it belongs to is not a setting. There is no
 * faster setting than this one for the same reason — the next one down is
 * `still`, which is honest about being off.
 *
 * `slow` is 1.6, and it deliberately spends past a ceiling `motion/timing.ts`
 * holds: a chain runs to 1.44s rather than the 900ms that file argues nobody
 * should be made to wait through. That ceiling is written against a player who
 * has seen the interaction a thousand times, and this setting exists for the
 * player who has not. It is chosen, once, by the person who waits for it, which
 * is the whole difference. The number is not larger than 1.6 because past there
 * a chain of triggers stops reading as several things happening and starts
 * reading as an interface that has hung.
 *
 * `still` is 0, and it is not "very fast". A scale of zero is the empty plan
 * and the instant sheet: nothing travels, nothing pulses, the board simply is
 * what it became. That is the same answer `@mtg/ui`'s
 * `motion/reduced-motion.ts` gives the operating system, reached through a
 * control instead of a media query.
 */
const SCALE: Readonly<Record<Pace, number>> = {
  still: 0,
  quick: 0.7,
  normal: 1,
  slow: 1.6,
};

/** The multiplier `pace` applies. */
export function paceScale(pace: Pace): number {
  const scale = SCALE[pace];
  return scale;
}

/**
 * `ms` at `pace`, rounded to a whole millisecond.
 *
 * Rounded because these numbers reach `setTimeout` and a stylesheet, and a
 * duration of `144.00000000000003ms` in either is noise in a diff and in a test
 * assertion for no gain — nothing on a 60Hz display can tell 144 from 144.0001.
 */
export function paced(ms: number, pace: Pace): number {
  return Math.round(ms * paceScale(pace));
}

/** Whether `value` names a pace. Narrow a stored string with this. */
export function isPace(value: unknown): value is Pace {
  return typeof value === 'string' && (PACES as readonly string[]).includes(value);
}

/**
 * The custom property the board's sheets multiply their durations by.
 *
 * A custom property rather than a rebuilt stylesheet, because the sheets are
 * assembled once at module load and handed to a `<style>` element: re-emitting
 * them per setting would mean either four sheets in the document or a sheet that
 * is rewritten under a live animation. A property inherits from the element it
 * is set on to every rule underneath, so one write reaches all ten interpolation
 * sites, and it composes with `prefers-reduced-motion`, whose rules set
 * `animation: none` outright and are unaffected by what they are multiplied by.
 */
export const PACE_VAR = '--mtg-pace';

/**
 * The attribute a surface writes its pace on, which is how `PACE_VAR` gets its
 * value.
 *
 * An attribute rather than an inline `style.setProperty`, because the element
 * the motion layer holds is a `MotionNode` — a structural interface with
 * `setAttribute` on it and no `style` — and widening that interface to reach a
 * custom property would put a browser's CSSOM inside the one seam this layer
 * keeps replaceable by a test. The four rules that turn the attribute into the
 * property live in `@mtg/ui`'s `styles/board/motion.ts` and are generated from
 * `PACES` and `paceScale`, so a fifth pace cannot exist in the scale and be
 * missing from the sheet.
 *
 * It is read by inheritance, not by descent: the rules match the attribute
 * alone, so the surface may write it on the board, on a wrapper above the board,
 * or on the page, and every duration underneath answers.
 */
export const PACE_ATTRIBUTE = 'data-mtg-pace';

/**
 * `ms` as a stylesheet duration that answers to `PACE_VAR`.
 *
 * The fallback is `1`, so a sheet rendered somewhere the property was never
 * written — a screenshot tool, a test mounting one component, a surface outside
 * the play route — draws at the pace the constants were argued at rather than at
 * zero. Every duration in the board's sheets goes through this function rather
 * than writing the `calc()` out, because the failure mode of writing it out is a
 * site that silently keeps its constant while the other nine move.
 */
export function paceCss(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new Error(`pace: expected a finite duration, got ${typeof ms} ${String(ms)}`);
  }
  return `calc(${String(ms)}ms * var(${PACE_VAR}, 1))`;
}

/**
 * The word a control shows for each pace: one word, because the control is one
 * button in a bar that is already dense, and a word beats an icon here — there
 * is no glyph that reads as "1.6 times as long".
 */
export const PACE_WORDS: Readonly<Record<Pace, string>> = {
  still: 'Still',
  quick: 'Quick',
  normal: 'Normal',
  slow: 'Slow',
};

/** The pace after `pace`, wrapping. */
export function nextPace(pace: Pace): Pace {
  const at = PACES.indexOf(pace);
  const next = PACES[(at + 1) % PACES.length];
  if (next === undefined) throw new Error('pace: the cycle is empty');
  return next;
}
