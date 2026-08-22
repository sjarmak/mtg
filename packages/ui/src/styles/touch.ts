/**
 * The second input model, on the axis that is geometry.
 *
 * `mtg-yg8`. Everything else about touch on this surface is a gesture and lives
 * in `../card/press.ts`; this is the part that is a number, and it has a sheet
 * of its own for the reason `./board/index.ts` gives its blocks one — every rule
 * in here has to come after the sheet that sizes the control it floors, and a
 * floor mixed into the file that sets a padding is a floor nobody can find.
 *
 * **Gated on `(pointer: coarse)`, which is what keeps this from being a
 * restyle.** Apple's 44pt minimum is about a fingertip; WCAG 2.5.8 AA asks 24
 * CSS px of a pointer and every control measured here already clears that. A
 * mouse reads not one changed declaration inside the query, which is the whole
 * reason the surface everybody uses today cannot regress from this file: it is
 * inert unless the primary input is coarse. `(pointer: coarse)` rather than
 * `(any-pointer: coarse)` for the same reason in the other direction — a laptop
 * with a touchscreen is driven from its trackpad, and sizing its move list for a
 * finger would cost that player rows of the list for a gesture they never make.
 *
 * Measured in chrome-headless-shell 151.0.7922.47 under a touch-capable device
 * metrics override, on `../../tools/touch-targets.ts`'s two pages, at 1440x900,
 * 1280x800, 1024x768 (which is also the iPad in landscape) and 810x1080 (the
 * iPad in portrait). Every number below was read there.
 *
 * **What that rig cannot settle.** Chrome's touch emulation is not WebKit on an
 * iPad. `(pointer: coarse)` matching under an emulated device says the query is
 * written correctly; it does not say iPadOS answers it the same way, and in
 * particular says nothing about an iPad with a Magic Keyboard attached, where a
 * trackpad is present and touch is still the primary input. That reading is
 * `mtg-yg8`'s device session, and until it is taken every number here is a
 * statement about Chromium.
 */

/**
 * The floor, in CSS px, both axes.
 *
 * Apple's Human Interface Guidelines put the minimum comfortable target at 44pt,
 * and on an iPad one point is one CSS px — the device pixel ratio moves the
 * rasters, not the layout units — so 44 is that number in the units this sheet
 * writes. Android's guidance is 48dp and WCAG 2.5.8 AA is 24 CSS px; the
 * strictest of the three is the one worth stating once.
 *
 * Exported because three places must agree about it: this sheet, the test that
 * reads it, and `../../tools/touch-targets.ts`, which measures a browser against
 * it. A number written in the rig and again in the sheet is a number the two can
 * disagree about while both look right.
 */
export const TOUCH_TARGET_PX = 44;

/**
 * And the floor under the floor, for the one axis a short table cannot pay 44 on.
 *
 * WCAG 2.5.8 AA, in CSS px, both axes. It is not a second opinion about comfort
 * — 44 above is still what every control on this surface is sized to — it is the
 * bound below which a target stops being conformant at all, and it exists here
 * because `../styles/board/rail.ts` spends the *width* of two collapsed strips on
 * a landscape phone that has 844px of it. the playtester, 2026-08-22: "reclaim the
 * width a bit by making the borders on the left and right where the panes are
 * expandable and collapsible more narrow".
 *
 * A strip narrowed to this keeps 44 on the other axis, so the target is 24x44
 * rather than 24x24: the reduction is one-dimensional and it is spent on the
 * axis the board is poor in.
 */
export const WCAG_TARGET_PX = 24;

/**
 * The controls the floor is spent on, with what each one measured before it.
 *
 * A list rather than `button { min-height: 44px }`, and the difference matters
 * twice. A universal rule would reach the deck lab and the analysis route, which
 * this bead has measured nothing on; and it would reach controls whose size is
 * set by the thing they are drawn on — a card face is as big as the card it
 * draws, and every one already clears the floor (48px at its shortest, at
 * 810x1080, where the hand is at its most crowded). So each entry is a surface
 * the audit measured short, and the note beside it is what it measured.
 *
 * `min-height` rather than `height`: each of these may be taller than the floor
 * already — a move whose label wraps to two lines lays out at 55.7px — and a
 * fixed height would clip exactly the labels a narrow viewport produces.
 */
const COARSE_TARGETS: readonly { readonly selector: string; readonly note: string }[] = [
  {
    // The control a whole game is played through, in the move list and in a
    // card's own picker alike. 36.8px at every viewport measured, which is the
    // friction audit's "37px", and 5 of the 11 options on a parked priority.
    selector: '.mtg-choice',
    note: 'the move list and a card picker; 36.8px',
  },
  {
    // Pass, Continue, New game, the log's three density levels, the sealed
    // builder's controls. 28.8px.
    selector: '.mtg-btn',
    note: 'the chrome buttons, Pass among them; 28.8px',
  },
  {
    // The turn badge that discloses the stop settings, in the toolbar. The
    // shortest control on the route.
    //
    // Qualified by the element, because `.mtg-badge` is not one thing. The
    // disclosure is a `<button>` (`../routes/play/TurnStops.ts`); every other
    // badge in the app is a `<span>` that says a word — Active, Priority, fail,
    // missed, chose, a win reason — and nobody presses those. Flooring them cost
    // the phone the reading this lane is about: the seat pod's two tags wrap, so
    // 44px each made a 92px block of two 19px words inside a 390px-tall
    // landscape viewport, and the viewer's own life total went under the fold
    // behind it. A floor on a label is not an accessibility gain; it is a
    // 44px-tall word.
    selector: 'button.mtg-badge',
    note: 'the turn badge and its disclosure; 19px',
  },
  {
    // Both graveyards and the game log: the whole head is the press target.
    selector: '.mtg-browser__head',
    note: 'the zone and log disclosures; 17.9px',
  },
  {
    // A card inside an open zone browser, which is how a card in a graveyard is
    // read. Neither browser is open on either page the rig draws, so this one is
    // floored from the same reasoning rather than from a measurement.
    selector: '.mtg-browser__row',
    note: 'a card in an open graveyard; not drawn on either measured page',
  },
  {
    // The shell's own route links, which is how a player gets back to the table
    // after looking at the cards.
    selector: '.mtg-modes__item',
    note: "the shell's route links; 26.8px",
  },
  {
    // The step bar, which is where a stop is set. Height only, and that is a
    // trade rather than an oversight: the nodes are `flex: 1 1 0` inside an
    // `overflow-x: auto` strip, so a 44px min-width would make the bar scroll at
    // both iPad viewports — 13 nodes and their gaps want 596px against the 558px
    // the strip has at 1024x768 and the 372px it has at 810x1080, which hides
    // five of them — and a step bar that hides the step you are standing in has
    // lost the one thing it is for. The nodes measure 41.1px and 28px wide by
    // 33.9px tall; the height is what this fixes, and the width is a reading for
    // the device rather than a number to guess at here.
    selector: '.mtg-phasebar__node',
    note: 'the step bar; 33.9px tall, and 28px wide at 810x1080',
  },
];

/** The floors, one rule per surface, in the order the list states them. */
function coarseRules(): string {
  return COARSE_TARGETS.map(
    ({ selector, note }) => `  /* ${note} */\n  ${selector} { min-height: ${String(TOUCH_TARGET_PX)}px; }`,
  ).join('\n');
}

/** Everything a finger presses on the played table, for the two rules below. */
const PRESSABLE =
  ".mtg-card[data-interactive='true'], .mtg-choice, .mtg-btn, button.mtg-badge, .mtg-phasebar__node";

/**
 * The sheet.
 *
 * Two things beside the floor, and both are about what the browser does with a
 * press rather than about how big the target is.
 *
 * `touch-action: manipulation` takes double-tap-to-zoom off the pressable
 * surfaces, which is what lets a second press be a second press instead of a
 * gesture the browser withholds the first one waiting to complete. It sits
 * outside the media query because it names a behavior a fine pointer does not
 * have: a mouse reads it and nothing changes.
 *
 * `-webkit-touch-callout` and `user-select` are what a long press on a card must
 * not do. Left alone, iOS answers a held finger with the selection callout and a
 * text selection dragged across the rules box, on top of whatever
 * `../card/press.ts` decided the press meant — two menus for one gesture, which
 * is the thing `../card/Card.ts` already suppresses the browser's own context
 * menu to avoid. Inside the query, because selecting a card's rules text with a
 * mouse is something somebody may want and no mouse gesture is intercepted here.
 */
export const TOUCH_CSS = `
/* mtg-yg8: the second input model. A fine pointer reads nothing here but the
   touch-action rule, which describes a gesture it does not make. */
${PRESSABLE} { touch-action: manipulation; }
@media (pointer: coarse) {
${coarseRules()}
  .mtg-card[data-interactive='true'] {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
}
`;

/** The selectors the floor is spent on, for the test that reads this sheet. */
export const TOUCH_TARGET_SELECTORS: readonly string[] = COARSE_TARGETS.map((target) => target.selector);
