/**
 * Arrival: a permanent the opponent plays comes down onto the table instead of
 * being there on the next frame.
 *
 * The playtester, 2026-08-13: "I would like to have a little bit of transition when
 * things happen in the game from the opponent so it does not just instantly
 * appear." The board is a projection of kernel state, so the other seat's play
 * used to be a card that simply existed on the next render — nothing to catch
 * the eye, nothing saying which object was new, no beat in which to read it.
 * The game log already *reports* it; this is what makes it *seen*.
 *
 * **It is a little bit, and the size is the design.** One motion, on one class
 * of object, for `ARRIVAL_MS`: the card fades up while dropping `ARRIVAL_RISE_REM`
 * into its slot. Nothing else on the table moves, nothing waits for it, and a
 * player who is not looking loses nothing, because the movement is the only thing
 * the animation carries and the log's sentence is still the record. Four things
 * were deliberately not built, and each is a bead rather than a guess at what
 * "a little bit" includes: your own plays and a card leaving the table
 * (`mtg-ncg`), a lasting mark on the newest object (`mtg-exe`), a timing a player
 * can turn (`mtg-kwu`), and the one false positive below (`mtg-wwy`).
 *
 * **The stack came off that list** (`mtg-atq`). the playtester asked that a spell she
 * has to let resolve "show it go onto the stack", and an object that is simply
 * present on the next frame is exactly what she is describing the absence of. It
 * takes the same keyframes, the same duration and the same easing as a permanent
 * landing — one motion vocabulary, so this and the lane moving attackers into the
 * divider compose rather than competing — and it earns them for the same reason:
 * a stack entry is reconciled by the kernel object id, so an entry already on the
 * stack keeps its element across every re-render and only a genuinely new object
 * gets a new one. Both seats' objects move, unlike the battlefield rule below,
 * because the stack is the one box on the table whose whole subject is *change*:
 * your own spell going onto it is the thing you are about to be asked about.
 *
 * **Nothing here is game state.** The animation is a stylesheet rule fired by an
 * element entering the document, so it appends nothing to `choices`, reaches no
 * `GameState` field, and cannot be seen by `stateFingerprint` or `replaySession`.
 * That is the rule `@mtg/kernel`'s `beats.ts` already holds for the combat
 * pauses — pacing is not state — and it is held here the cheaper way, by there
 * being no JavaScript at all: no timer, no ref, no view state, nothing a render
 * could get wrong and nothing a test has to wait for.
 *
 * **Fired by insertion rather than by a diff.** React reconciles the battlefield
 * by `permanent.key`, which is the kernel object id, so a permanent already on
 * the table keeps its DOM node across every re-render — a tap, a counter, a
 * combat mark all change attributes on an element that stays put, and none of
 * them re-runs an animation. Only a card that was not there before gets a new
 * element, and a new element starts its animation once. That is what makes a
 * marking pass unnecessary, and it is also what makes the effect immune to the
 * failure a marking pass has: an attribute set for one render and cleared by the
 * next unrelated re-render would cancel the animation halfway.
 *
 * The one place that gives a false positive is honest and asserted in
 * `test/play/arrival.test.ts`: equipping a creature moves it inside the
 * `.mtg-attach` tray (`../../board/Battlefield.ts`, `attachedGroup`), which is a
 * new parent and therefore a new element, so the host arrives a second time. An
 * opponent equipping something is an opponent doing something, so the motion is
 * not lying about whether an event happened; it names the wrong one.
 *
 * **Two properties, both of them free.** `opacity` and `translate` are the whole
 * animation, and neither touches a layout box. That is not a preference —
 * `./slot.ts` pairs `aspect-ratio` with `min-height: 0` on `.mtg-slot > .mtg-card`
 * to make every face on the board one height (a box with a preferred aspect ratio
 * takes its content as its automatic minimum size, CSS Sizing 4, and a minimum
 * beats a maximum), and an arrival that animated width, height, margin or padding
 * would reintroduce the uneven-row bug that pair exists to close. Measured after
 * this change in chrome-headless-shell 151 at 1440x900 over the flagship set: one
 * face height per row and a spread of 0 at four, eight and twelve permanents a
 * side, unchanged from before it, and unchanged again while an arrival was in
 * flight.
 *
 * What that costs, and it is worth stating because a reader watching one arrive
 * will see it: the row still refits on the frame the permanent is inserted, so
 * the cards already on the table take their new width at once while the new one
 * is still falling. At eight permanents going to nine, measured, that is 136.1px
 * faces becoming 119.7px in one frame. Smoothing it would mean animating a
 * length on every card in the row, which is exactly the thing the paragraph
 * above rules out, so the reflow is left instant and only the arriving card
 * moves — the same trade `./slot.ts` makes when a permanent taps.
 *
 * The transform lands on the *card* rather than on the slot, for the reason
 * `./slot.ts` already gives about the filter: a transform makes an element a
 * containing block for fixed-position descendants, and the hover zoom is
 * `position: fixed` precisely so the scrolling well cannot clip it. The zoom is a
 * sibling of the face and a child of the slot, so a transform on the face is free
 * and a transform on the slot would have trapped the zoom inside the card.
 *
 * The corner marks travel with the card rather than popping in over it, so a
 * creature arrives already wearing its hourglass. **They no longer travel by
 * animating**, and that is `mtg-swr1`. `./slot.ts` anchors the row to the card's
 * own art window, and an anchor rectangle is the anchor's box *after* its
 * transforms, so the row already follows every pixel the card moves for free.
 * Giving it a copy of the keyframes on top of that spent the rise twice:
 * measured in chrome-headless-shell at 1440x900, four permanents a side, the
 * row sits 26px below the card's top edge at rest and was at -1.6px one
 * millisecond into the arrival, which is 28px too high — through the title bar
 * and onto the name that `mtg-9edk` had just cleared. So the row fades in place
 * and the card is what moves.
 *
 * Where anchor positioning is unavailable the row keeps the full travel, because
 * there it is positioned against the *slot*, the slot does not transform, and
 * without its own copy of the keyframes the badges would hang in the finished
 * position while the card fell in under them. The `@supports` question is asked
 * with `./slot.ts`'s own exported ident so the two branches cannot drift: this
 * rule moves the row exactly where that file did not glue it down.
 *
 * The offset is stated in `rem` and not as a percentage for the reason that
 * still applies to the fallback: a percentage on `translate` resolves against
 * the element's own box, so the card would move a card's worth and the badge a
 * badge's worth.
 *
 * **Reduced motion shows the card, in place, on the first frame.** Under
 * `prefers-reduced-motion: reduce` the rule below sets `animation: none`, so the
 * permanent simply appears exactly as it did before this change — no drop, no
 * fade, no delay, and nothing hidden while a transition it will never see plays
 * out. `../base.ts` already clamps every animation on the page to 1ms under that
 * query, so this is what happens either way; it is written out because a
 * behavior nobody declared is a behavior nobody checked, and because the
 * animation must be *off*, not merely fast: a 1ms fade from `opacity: 0` is a
 * frame of blank card, which is a flash rather than a reduction. Legibility never
 * depended on the motion — the log narrates the play, the card is on the board,
 * and every mark it wears is text.
 *
 * The timing is one named constant rather than a value in the sheet, which is
 * the configurability this lane took: `ARRIVAL_MS` is the number, it is
 * interpolated once, and `test/play/arrival.test.ts` reads it back out of the
 * shipped sheet. Handing it to a player as a setting means putting presentation
 * timing beside the stops in `SessionOptions`, which is a session-shaped change
 * and is filed rather than assumed.
 */
import { cssNumber } from '../number';
import { ART_ANCHOR } from './slot';

/**
 * How long an arriving permanent takes to land.
 *
 * 240ms is chosen against both ends. Below roughly 150ms a movement reads as a
 * jump rather than as travel, which would spend the whole change and buy back
 * the complaint; past about 300ms it is something you wait for, and a bot turn
 * that plays a land and a creature would put half a second of animation between
 * a player and their own priority. Arrivals overlap rather than queue — they are
 * independent elements each running their own copy — so two permanents in one
 * render still cost 240ms, not 480.
 */
export const ARRIVAL_MS = 240;

/**
 * How far above its slot the card starts, in `rem`.
 *
 * Downward, because the opponent's hand is off the top of the mat: a card that
 * drops into the far band came from where their cards come from, and one that
 * rose out of the table came from nowhere. 1.75rem is 28px, about a fifth of a
 * board face's height at the counts a played game reaches — far enough to be
 * unmistakably travel, short enough that the card never appears over the seam or
 * inside the other seat's band on its way in.
 */
export const ARRIVAL_RISE_REM = 1.75;

/**
 * Decelerating, and asymmetric on purpose: the card covers most of the distance
 * early and settles into the slot. An `ease-in` or a linear arrival reads as a
 * card being dragged into place by something.
 */
const ARRIVAL_EASING = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/**
 * The battlefield, and only the battlefield.
 *
 * `[data-layout='board']` is the battlefield zone's body and nothing else's
 * (`../../board/Zone.ts`) — the hand and the stack are `rail`, the graveyard
 * wraps. The scope is load-bearing rather than tidy: a bot game reveals the
 * opponent's hand on purpose (`../../routes/play/position.ts`), so a rule that
 * reached every `.mtg-card` under the far seat would animate seven hand cards
 * every draw step, which is a firehose and not a little bit.
 */
const FAR_BATTLEFIELD =
  ".mtg-board__side[data-seat='opponent'] .mtg-zone__body[data-layout='board'] .mtg-slot";

/**
 * An object arriving on the stack, either seat's.
 *
 * The whole entry rather than something inside it, because a stack entry is a
 * row of text and a button and not a card in a slot: there is no picture to move
 * independently of its badges. It is safe to transform the box itself here for
 * the reason the battlefield rule cannot transform its slot — nothing inside a
 * stack entry is `position: fixed`, so no containing block is being created for
 * anything that needs the viewport.
 */
const STACK_ENTRY = '.mtg-stack__entry';

/**
 * The boards this rule still owns.
 *
 * `mtg-ncg` built the general layer this rule was the conservative first half
 * of: `../../motion/` animates every zone movement, both seats and departures
 * included, by measuring the laid-out page. Where that layer is running, this
 * one must not — the two animate the same object with different properties
 * (`translate` here, `transform` there), so together they read as one card doing
 * two things. `../../motion/runner.ts` writes `data-motion='on'` on the board it
 * drives, in a layout effect, before the browser has painted the commit that
 * inserted the card; a board with no runner over it — the replay route's, and
 * any read-only render of `../../board/Board.ts` — keeps exactly the arrival it
 * has had since `mtg-81a`.
 *
 * A `:not()` rather than deleting the rule, because that fallback is worth
 * keeping: it is the only motion on this surface that needs no script at all.
 */
const UNDRIVEN = ".mtg-board:not([data-motion='on'])";

/** What actually crosses the table: the card, and a stack entry. */
function traveling(indent: string): string {
  return [`${indent}${UNDRIVEN} ${FAR_BATTLEFIELD} > .mtg-card`, `${indent}${UNDRIVEN} ${STACK_ENTRY}`].join(
    ',\n',
  );
}

/** The badges over the arriving card's corner. */
function marksRow(indent: string): string {
  return `${indent}${UNDRIVEN} ${FAR_BATTLEFIELD} > .mtg-slot__marks`;
}

export const ARRIVAL_CSS = `
@keyframes mtg-arrive {
  from { opacity: 0; translate: 0 -${cssNumber(ARRIVAL_RISE_REM)}rem; }
  to { opacity: 1; translate: 0 0; }
}
/* The same arrival with the travel taken out, for anything already being carried
   by the thing that travels. */
@keyframes mtg-arrive-in-place {
  from { opacity: 0; }
  to { opacity: 1; }
}
${traveling('')} {
  animation: mtg-arrive ${cssNumber(ARRIVAL_MS)}ms ${ARRIVAL_EASING};
}
${marksRow('')} {
  animation: mtg-arrive-in-place ${cssNumber(ARRIVAL_MS)}ms ${ARRIVAL_EASING};
}
@supports not (anchor-scope: ${ART_ANCHOR}) {
${marksRow('  ')} {
    animation: mtg-arrive ${cssNumber(ARRIVAL_MS)}ms ${ARRIVAL_EASING};
  }
}
/* No fill mode, so the moment the animation ends the element is back on its own
   declared styles and the keyframes hold nothing. That matters more than it
   looks: a filling animation's values sit in the animation origin, which beats
   every author declaration, so a forwards-filled 'translate: 0' would outrank
   ./slot.ts's hover rule for the rest of the card's life on the table. */
@media (prefers-reduced-motion: reduce) {
${traveling('  ')},
${marksRow('  ')} {
    animation: none;
  }
}
`;
