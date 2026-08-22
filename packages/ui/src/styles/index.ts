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
import { PRECON_CSS } from './precon';
import { DECK_CSS } from './deck';
import { REPLAY_CSS } from './replay';
import { TOUCH_CSS } from './touch';
import { MOBILE_CSS } from './mobile';

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
 * immediately after, because a scope's selector ties with `:root` on
 * specificity and only wins by coming later.
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
    // After the route sheets, because the picker's tiles sit inside a
    // `.mtg-panel__body` those sheets lay out and add nothing they answer.
    PRECON_CSS,
    DECK_CSS,
    REPLAY_CSS,
    TOUCH_CSS,
    MOBILE_CSS,
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
