/**
 * One stylesheet, assembled from the token layer plus five component sheets,
 * mounted once by `<GlobalStyles />`.
 *
 * Shipping CSS as a string rather than a `.css` import is what lets the
 * workspace's single root tsconfig typecheck every file in this package: `tsc`
 * cannot resolve `import './x.css'`, and packages here carry no tsconfig of
 * their own.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { MAT_TOKEN_CSS, SCOPED_TOKEN_CSS, TOKEN_CSS } from './tokens';
import { BASE_CSS } from './base';
import { CARD_CSS } from './card';
import { SYMBOL_CSS } from './symbols';
import { BOARD_CSS } from './board';
import { VIEWS_CSS } from './views';
import { PANEL_CSS } from './panel';
import { DECK_CARD_CSS } from './deck-card';
import { DECK_CSS } from './deck';
import { REPLAY_CSS } from './replay';
import { DESIGN_CSS } from './design';
import { WORKBENCH_CSS } from './workbench';
import { TOUCH_CSS } from './touch';
import { MOBILE_CSS } from './mobile';
import { REPLAY_MOBILE_CSS } from './replay-mobile';
import { DECK_MOBILE_CSS } from './deck-mobile';
import { DRAFT_MOBILE_CSS } from './draft-mobile';
import { CARDS_MOBILE_CSS } from './cards-mobile';
import { ADVISOR_CSS } from './advisor';
import { PRINTED_READING_CSS } from './printed-reading';
import { FEEDBACK_CSS } from './feedback';
import { OPENING_ROLL_CSS } from './opening-roll';

/**
 * The whole sheet: document tokens first, then any per-route re-valuation of
 * them and the mat's own surfaces, then chrome, card, board, route layout, and
 * then the touch floor and its phone-only refinement.
 *
 * `TOUCH_CSS` is after the component sheets because it is a floor over them:
 * every rule
 * in it ties on specificity with the sheet that sized the control — `.mtg-choice`
 * against `.mtg-choice` — and wins only by coming later. It is also the one
 * sheet that draws nothing unless the primary input is coarse, so its position
 * costs a fine pointer nothing. `MOBILE_CSS` follows it because the narrower
 * phone layout changes the axis the table spends and can therefore afford a
 * 44px width floor in the phase strip that the tablet layout cannot.
 *
 * The scoped blocks and the mat block sit outside `TOKEN_CSS` and immediately
 * after it. Outside, because `@mtg/card-render` embeds `TOKEN_CSS` verbatim in a
 * standalone SVG that has no shell to scope on and no table to lie on;
 * immediately after, because the root rule that travels with each scope
 * (`viewportScheme`) ties with `TOKEN_CSS`'s own root guards on specificity and
 * only wins by coming later. Not the scope's palette itself: that lands on the
 * shell div while `:root` lands on `html`, so the two never compete and the
 * div's own value wins at any order (`mtg-bc2.108`).
 *
 * `REPLAY_CSS` comes after `BOARD_CSS` and after `VIEWS_CSS`, and both halves of
 * that matter. It is one route's layout, so it belongs with the route sheets;
 * and the three rules in it that re-answer a board rule for a face-up hand tie
 * with `board/fit.ts` and `board/hand.ts` on specificity — an attribute, a class
 * and an attribute either way — so they win on order alone, exactly the way a
 * scope's palette wins over `:root` below.
 *
 * `SCOPED_TOKEN_CSS` carries both halves of a scope: the palette on the shell,
 * and the `:root:has(…)` rules handing the viewport the `color-scheme` that
 * route is drawn in. The second half is at the root because that is where the
 * viewport reads it, and it ties with `:root` on specificity too, so it depends
 * on this order for the same reason.
 */
export function uiStyleSheet(): string {
  return [
    TOKEN_CSS,
    SCOPED_TOKEN_CSS,
    MAT_TOKEN_CSS,
    BASE_CSS,
    CARD_CSS,
    SYMBOL_CSS,
    BOARD_CSS,
    VIEWS_CSS,
    // The shared contextual rail and the two-track screen it sits in, after the
    // route sheets because it re-lays-out regions those sheets have styled.
    PANEL_CSS,
    ADVISOR_CSS,
    // After the route sheets, because a deck card sits inside regions those
    // sheets lay out and adds nothing they answer.
    DECK_CARD_CSS,
    DECK_CSS,
    REPLAY_CSS,
    // One route's layout, like the two above it, and after them for the same
    // reason: it lays out regions the panel sheet has already styled.
    DESIGN_CSS,
    // And the deck workbench's, beside the designer's and for the same reason:
    // it lays out regions the panel sheet has already styled, and it is read
    // after `DECK_CSS` because it sits inside the Decks route's own frame.
    WORKBENCH_CSS,
    PRINTED_READING_CSS,
    TOUCH_CSS,
    MOBILE_CSS,
    // Last, because it is the replay route's own answer to rules `MOBILE_CSS`
    // now writes for every fitted board: same specificity either way, so it
    // wins on order the way `REPLAY_CSS` wins over `BOARD_CSS` above.
    REPLAY_MOBILE_CSS,
    // And the Cards route's own answer, last for the same reason: its gallery
    // and control-bar rules tie on specificity with `./views.ts`'s and win on
    // order, and nothing in it is read above a phone.
    CARDS_MOBILE_CSS,
    // And the draft route's own, after those: it re-answers `PANEL_CSS`'s
    // fitted screen on an upright phone, and ties with it on specificity in
    // places, so it has to be read later.
    DRAFT_MOBILE_CSS,
    // And the deck route's own, beside the three above it: it re-answers the
    // toolbar and mana-base rows `DECK_CSS` writes for a pane three times this
    // wide, ties with them on specificity, and wins on order.
    DECK_MOBILE_CSS,
    OPENING_ROLL_CSS,
    // The feedback helper floats over every route and every fitted layout, so
    // it is read last: nothing under it may re-answer where it sits.
    FEEDBACK_CSS,
  ].join('\n');
}

/**
 * Mounts the sheet. Render once, above everything else; a second instance is
 * harmless but pointless. Consumers that own their own document head may skip
 * this and inline `uiStyleSheet()` themselves.
 */
export function GlobalStyles(): ReactElement {
  return createElement('style', { 'data-mtg-ui': 'tokens' }, uiStyleSheet());
}

export { TOKEN_CSS } from './tokens';
export { COLOR_IDENTITIES, IDENTITY_LABELS } from './tokens';
export type { ColorIdentity } from './tokens';
