/**
 * The draft screen on a phone held upright, and the three things the fitted
 * screen it inherits cannot be asked at that size.
 *
 * `mtg-dcxg.5`, 2026-08-23. `./panel.ts` builds this route as a *screen*: a page
 * that fills the viewport exactly once, with the pack scrolling inside its own
 * pane and the rail's commit button pinned under it. Every phone rule that
 * makes that arrangement fit is inside that sheet's `SCREEN_QUERY`, which is
 * `max-height: 34rem` — a phone held sideways. Held upright a phone is 844px
 * tall, none of it fires, and what draws is the desktop screen with its rail
 * stacked underneath. Measured in chrome-headless-shell at 390x844 over
 * `../../test/draft/pack-portrait.browser.test.ts`'s thirteen-card pack:
 *
 *  - `--thumb-w` was still the desktop's 13rem, so `auto-fill` resolved to a
 *    single 348px track. One card per row, thirteen rows, and a grid 1993.84px
 *    long over the DSL examples — longer still on the flagship set the
 *    2026-08-23 sweep photographs, whose faces carry art.
 *  - That grid scrolled inside `.mtg-work__scroll`, a 517.56px pane with
 *    1494px of overflow, while the shell's own main region scrolled too. Two
 *    scrollers on one axis, the inner one holding the whole subject of the page.
 *  - The rail's foot ran from y=770 to y=831 and `./mobile.ts`'s bottom
 *    navigation starts at y=799, so the one irreversible control on the route
 *    was 32px under the tab row.
 *
 * So on a portrait phone this route stops being a screen and becomes what every
 * other route on this phone already is: one document column in the shell's own
 * scroller, with the pack drawn as a grid of thumbnails and the commit pinned
 * above the tab row where a thumb is. The landscape tier is untouched — it is a
 * height query and this is a width one, and they cannot both match — and so is
 * the desk, where the screen is the right arrangement and has been since
 * `mtg-aqxi`.
 */
import { BOTTOM_NAV_REM } from './mobile';
import { TOUCH_TARGET_PX } from './touch';

/**
 * The draft *screen*, wherever it is drawn, rather than the draft route.
 *
 * `mtg-dcxg.12`, 2026-08-23. `.mtg-draft.mtg-screen` is built by exactly two
 * components: `../routes/draft/DraftPack.ts` on the draft route, and
 * `../routes/play/RemoteDraft.ts` on the play route, which is the same screen
 * dealt by a netplay table. Scoped to the draft section's attribute this sheet
 * reached the first and not the second, so a remote draft on an upright phone still
 * drew one card per row inside a nested scroller with its commit bar under the
 * tab row — the three defects below, in the route where two people are actually
 * drafting against each other.
 *
 * The class is the honest subject: these rules are about that screen's
 * arrangement, not about which route the shell happens to be on. Nothing else
 * in the app builds `.mtg-draft`, so the class is as narrow as the attribute
 * was and reaches one more place, which is the fix.
 */
const DRAFT = '.mtg-draft';

/** The phone tier, restated rather than imported as a selector fragment. */
const PHONE_MAX_REM = 40;

/**
 * What the bottom navigation and the safe area under it take at the foot of the
 * screen. `./mobile.ts` computes the same string for its own two uses and keeps
 * it private, and it is a measurement of `./touch.ts`'s 44px floor plus the
 * bar's frame rather than a number chosen to look right.
 */
const BOTTOM_NAV_SPACE = `calc(${String(BOTTOM_NAV_REM)}rem + env(safe-area-inset-bottom))`;

/**
 * Where the top of that navigation actually is.
 *
 * The reserve above is 3rem and carries slack on purpose — it is a clearance a
 * page keeps under its last line. A band drawn *at* it does not want slack: the
 * tab row measures 45px at 390x844 (`./touch.ts`'s 44px floor on the item plus
 * the one-pixel rule along its top), so a commit bar offset by 48 sits three
 * pixels high and the pack scrolls through the gap under it. Derived from the
 * same two numbers the bar is built from rather than from the 45.
 */
const BOTTOM_NAV_HEIGHT = `calc(${String(TOUCH_TARGET_PX)}px + 1px + env(safe-area-inset-bottom))`;

/**
 * The height of the pinned commit bar, derived from what is in it rather than
 * measured off it: `../styles/panel.ts` gives `.mtg-rail__foot` a `space-2` of
 * padding on each side of a button carrying `./touch.ts`'s floor, and one pixel
 * of rule along its top. It came to 61px at 390x844, which is what the page has
 * to leave clear above the navigation so the last row of the pack is reachable.
 */
const COMMIT_BAR = `calc(${String(TOUCH_TARGET_PX)}px + 2 * var(--mtg-space-2) + 1px)`;

export const DRAFT_MOBILE_CSS = `
@media (max-width: ${String(PHONE_MAX_REM)}rem) {
  /* 1. The pack is a grid rather than a column of one.

     The landscape tier answers the same question for the same pack with the
     pool's 7rem, on an argument that holds here word for word: thirteen
     readable faces do not fit on a phone at any column width, so what a wide
     column buys is rows of scrolling rather than a pack on one screen, and the
     face you tap is a thumbnail you recognize a card by rather than one you
     read.

     Half a rem under it, because at this width 7rem is a ledge. The pack pane
     is 348px of content box at 390px of screen and the grid's gap is
     \`--mtg-space-2\`, 8px, so three 7rem tracks come to 352 and \`auto-fill\`
     drops to two 170px columns — most of the way back to the card-per-screen
     this rule exists to stop. Three 6.5rem tracks come to 328, which
     \`auto-fill\` then stretches to 110.67px each: measured at 390x844, three
     across and the thirteen-card pack in five rows. */
  ${DRAFT} .mtg-work__scroll .mtg-thumbs { --thumb-w: 6.5rem; }

  /* 2. One scroller, and it is the shell's.

     The pane that scrolls the pack is what a page fitted to the viewport needs;
     an upright phone is not fitted to the viewport, it is a document, and a
     document with a scroller inside it hands a thumb two gestures for one axis
     and hides the end of whichever one it is not on. So the pane stops being a
     scroller and stops being the only thing allowed to grow, and the column
     runs its full length inside \`.mtg-shell__main\` — the region \`./mobile.ts\`
     already scrolls on every other route at this width. */
  ${DRAFT}.mtg-screen,
  ${DRAFT}.mtg-screen > .mtg-work { flex: none; min-block-size: 0; }
  ${DRAFT} .mtg-work__scroll {
    flex: none; min-block-size: 0; overflow: visible; overscroll-behavior: auto;
  }
  ${DRAFT} .mtg-rail__body { flex: none; min-block-size: 0; overflow: visible; }

  /* 3. The commit is a bar above the tab row.

     A rail stacked under a pack puts its foot at the end of the document, which
     on this route is the one control that cannot be taken back and the one a
     player presses once per pick. Fixed rather than sticky: sticky pins inside
     the rail's own box, and the rail's box is entirely below the fold while you
     are reading the pack it is about. \`z-index: 2\` is under the navigation's 3,
     so the two bands stack in the order they are reached rather than overlap.

     It is also the whole of the feedback for a tap on a phone this shape: the
     rail below the fold is where the chosen card is drawn, and the label on this
     bar changes from "Pick a card" to the card's name in place. */
  ${DRAFT} .mtg-rail__foot {
    position: fixed; z-index: 2;
    inset-inline: 0; inset-block-end: ${BOTTOM_NAV_HEIGHT};
    padding-inline: max(var(--mtg-space-3), env(safe-area-inset-left)) max(var(--mtg-space-3), env(safe-area-inset-right));
  }
  ${DRAFT} .mtg-rail__foot > .mtg-rail__note {
    display: none;
  }
  /* And the document ends above both bands rather than under them, which is the
     defect the sweep photographed: \`.mtg-shell__main\` keeps \`./mobile.ts\`'s
     clearance for the navigation and adds this route's own for the bar. */
  .mtg-shell:has(${DRAFT}.mtg-screen) > .mtg-shell__main {
    padding-block-end: calc(${BOTTOM_NAV_SPACE} + ${COMMIT_BAR});
  }
}
`;
