/**
 * A beat drawn as the motion it is about, with its acknowledgment on the board.
 *
 * # The complaint
 *
 * The playtester, 2026-08-20, on watching an opponent kill one of her creatures:
 * "really we should be seeing the card animation of them playing the removal
 * spell, and my card being destroyed and during that animation I have the option
 * to continue."
 *
 * Both halves of that were already built and neither was wired to the other.
 * `../../motion/plan.ts` turns the batch of events a beat stopped on into cues —
 * the removal spell traveling from a hand to the stack, the creature traveling
 * from the battlefield to a graveyard — and plays them on the table. `./rail.ts`'s
 * `beatPanel` says the same thing in a sentence, in a panel, in a column, and the
 * player has to read the sentence and press the button *before* the game moves
 * on. So the surface reported one event twice, in two vocabularies, and the
 * slower one gated the faster one. The panel was not describing the animation; it
 * was interrupting it.
 *
 * This file is the other arrangement: the animation is the report, and the one
 * control it needs is drawn over the board while the animation runs.
 *
 * # Which beats can be one
 *
 * `beatShowsMotion` decides it structurally rather than by taste, and the answer
 * falls out of what a beat carries. A `death` and a `departure` **name
 * permanents** (`@mtg/kernel`'s `beats.ts`), and those are exactly the permanents
 * whose `zoneChanged` events sit in the same batch — `destruction.ts` emits
 * `permanentDestroyed` and then moves the object, in one reduce — so there is
 * always something on the table for the continue to be offered *during*. The
 * three combat beats carry no payload at all: `attackers`, `blockers` and
 * `damage` are the game stopping at a step boundary so the board can be read, and
 * the board is already still. There is no movement, so there is nothing for a
 * control to be drawn over, and those fall back to the panel.
 *
 * It is a total switch on `BeatKind` and not a set membership test, so a sixth
 * kind does not compile until somebody has said which of the two it is. That is
 * the whole point of writing it this way: the failure mode of a default branch
 * here is a new beat silently landing in one arrangement or the other, and only
 * one of those two mistakes is visible to a reader of the diff.
 *
 * # Three things it must not break
 *
 * **Reduced motion is not a lesser version of this.** Under
 * `prefers-reduced-motion: reduce` the plan is empty by construction, so a beat
 * routed here would draw a Continue over a board that never moved, next to no
 * report of what happened. `./PlayView.ts` asks `useBoardMotion` what the query
 * currently says and sends the beat to the panel when it says reduce, which is
 * the same path a combat beat takes. A player who asked for less motion gets the
 * sentence and the button, never a pause with nothing in it.
 *
 * **The continue cuts the motion short.** It is offered during the animation, so
 * pressing it has to end the animation rather than leave the next commit racing
 * a chain of cues nobody is watching. `../../motion/runner.ts`'s `cut` is that,
 * and it is deliberately not `reset`: the snapshot of where every card is
 * survives, so the commit the player pressed Continue to see is itself animated.
 *
 * **The sentence survives as text.** The motion is pixels, and pixels are not
 * available to a screen reader, so the accessible half of a beat may not be the
 * half that got replaced. `beatSentence` — the same function the panel prints,
 * not a second wording of it — is in the document in a named `role="status"`
 * region on this path too. The region is named for the reason every other one on
 * this table is (`../PhaseBar.ts`'s `PHASE_BAR_STATUS_LABEL`): unnamed regions
 * collide into one channel. It is not on screen because the board is saying the
 * same thing in movement, and one report in two places is what this bead is
 * removing.
 *
 * # Where it is drawn
 *
 * On `.mtg-board__divider`, the seam between the two battlefields — the one
 * horizontal band of the table that is not a card row, so the control does not
 * cover the permanents the animation is about. It is handed to the band as a
 * child rather than positioned over it from the lanes, which is the arrangement
 * `../../styles/board/stack.ts` already argues for the stack strip: the element
 * that decides whether combat is open is the element anything on that seam has
 * to agree with. Out of flow, at the end of the band rather than its middle,
 * above the mat and below the card menus on the z scale — every one of those is
 * a decision with a reason, and `../../styles/board/beat.ts` has them.
 *
 * A `div` with a button in it rather than a `dialog`: nothing here is modal, the
 * board under it is the thing being watched, and a focus trap over a running
 * animation would be the interruption in a new shape.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Beat, GameState } from '@mtg/kernel';
import type { SeatNames } from './position';
import { beatSentence, CONTINUE_LABEL } from './rail';

/**
 * The live region's own name, so this channel is distinguishable from the four
 * the table already has. See the docblock above, and `../PhaseBar.ts` for the
 * rule.
 */
export const BEAT_MOTION_STATUS_LABEL = 'Paused on the board';

/**
 * Whether this beat has something on the table to be watched.
 *
 * Total on `BeatKind` on purpose — the docblock above says why a sixth kind
 * should fail to compile rather than fall into a default.
 */
export function beatShowsMotion(beat: Beat): boolean {
  switch (beat.kind) {
    // Named permanents, and therefore zone changes in the same batch that
    // `../../motion/plan.ts` turns into cues.
    case 'death':
    case 'departure':
      return true;
    // A step boundary with a still board. Nothing moved, so there is nothing for
    // the acknowledgment to be offered during.
    case 'attackers':
    case 'blockers':
    case 'damage':
      return false;
  }
}

/**
 * The whole of a beat that plays as motion: one control, and the sentence in a
 * form a reader can reach.
 */
export function beatOnBoard(
  beat: Beat,
  state: GameState,
  names: SeatNames,
  onContinue: () => void,
): ReactElement {
  return createElement(
    'div',
    // Keyed, because `../../board/CombatZone.ts` puts this in the band's child
    // array beside the stack strip.
    { key: 'beat', className: 'mtg-beat', 'data-beat': beat.kind },
    // Carrying its text from the moment it is inserted, the way `./rail.ts`'s
    // own explain paragraph does. The element exists only while the game is
    // paused, so its arrival and the pause are the same event.
    createElement(
      'span',
      {
        className: 'mtg-sr-only',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': BEAT_MOTION_STATUS_LABEL,
      },
      beatSentence(beat, state, names),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn mtg-beat__continue',
        'data-variant': 'primary',
        onClick: onContinue,
      },
      CONTINUE_LABEL,
    ),
  );
}
