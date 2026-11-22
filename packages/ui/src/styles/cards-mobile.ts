/**
 * The Cards tab on a phone held upright, and the two things it was doing with
 * a 390px screen that only a 1440px one can afford.
 *
 * `mtg-dcxg.9`, 2026-08-23. Measured in chrome-headless-shell at 390x844,
 * mobile and coarse, over the committed flagship document's 371 cards:
 *
 *  - **321.6px of chrome above the first card**, from the top of the route's own
 *    box, on an 844px screen — 62% of the window counted from the top of the
 *    glass. The bar is a search box, eight identity pills, three selects and a
 *    density pair, every one of them on `./touch.ts`'s 44px floor, so at 390px
 *    it wraps to five rows and there is no arrangement of them that is not.
 *  - **a 244px face in a 366px gallery**: 122px of every row was gutter, on the
 *    one route whose entire content is the card. `./views.ts` draws the gallery
 *    as a wrapping flex row of fixed-width faces, which is right the moment two
 *    of them fit on a line and dead width the moment one does.
 *
 * Both are answered here rather than in `./mobile.ts`, which is the sheet every
 * fitted board shares and this route draws no board; `./replay-mobile.ts` is the
 * same arrangement for the same reason, and this file is wired after it in
 * `./index.ts` on the same terms — nothing in it re-values a number the wide
 * layout reads, so a desk is untouched by construction.
 *
 * **The bank is collapsed rather than thinned.** `./views.ts` already argues
 * that dropping a control from this bar would be a worse bar: the filters are
 * the whole of the route's interaction and the identity row is how a person
 * finds the black commons. So the precedent is `../routes/deck/SavedDecksPanel.ts`,
 * whose save controls went behind a disclosure for exactly this reason: the
 * controls all stay, and what a shut bank costs is one line. Search stays
 * outside it, because it is the narrowing that does not need the others.
 *
 * **The collapse is decided by width, not by script.** The route always renders
 * the bank and its toggle; this sheet hides the toggle above 40rem and the shut
 * bank below it. So the desk markup and the phone markup are the same markup,
 * a page rendered to static HTML is collapsed at 390px without a hydration pass
 * having run, and the shut state never escapes onto a screen with no control to
 * undo it.
 *
 * **The gallery is not paged.** Measured on the same page rather than assumed:
 * 371 faces are 8,005 elements, the document loaded in 241.1ms, and a forced
 * relayout of the whole 195,833px of it took 82.6ms. Nothing there is a phone
 * problem — the relayout is the resize case and it happens on an orientation
 * change, not on a scroll — and paging would put a control between a person and
 * the set they came to look at, on the one route whose content is the set. So
 * the gallery stays whole and this is the record of why. (The relayout was
 * 0.5ms before: a flex row of fixed-width faces does not re-measure when its
 * container changes width and a full-width grid does. 82ms once, for a third
 * more card on every row, is the trade this file is making.)
 *
 * The cost that is real is the art: `../card/ArtSlot.ts` renders an eager
 * `<img>`, so a set with a manifest fetches 371 illustrations at once. That is
 * an image-loading question about the shared card face rather than a question
 * about this grid, and it is tracked on its own.
 */
import { PHONE_MAX_REM } from './mobile';
import { viewScope } from './tokens';

const CARDS = viewScope('cards', 'gallery');

export const CARDS_MOBILE_CSS = `
/* Above a phone the bank is the bar, laid out by \`./views.ts\` as though this
   file did not exist: \`display: contents\` puts its six controls back in the
   bar's own flex flow, each wrapping on its own the way it always has, and the
   control that would open them is not drawn. Stated outside the query rather
   than inside a mirrored one, so every width that is not a phone is a width
   this file has answered. */
.mtg-cardbar__bank { display: contents; }
.mtg-cardbar__toggle { display: none; }
@media (max-width: ${String(PHONE_MAX_REM)}rem) {
  /* The bank becomes a block of its own under the bar's first line, so opening
     it does not interleave its controls with the search box. */
  .mtg-cardbar__bank {
    display: flex; flex-wrap: wrap; align-items: center;
    gap: var(--mtg-space-2); flex: 1 1 100%; min-inline-size: 0;
  }
  .mtg-cardbar__bank[data-open='false'] { display: none; }
  /* Search and the control that opens the rest share the one line a shut bar
     costs: the search takes what is left, the toggle keeps its own width. */
  ${CARDS} .mtg-cardbar__search { flex: 1 1 auto; min-inline-size: 8rem; }
  .mtg-cardbar__toggle { display: inline-flex; flex: 0 0 auto; }
  /* One column, and the column is the gallery. The face's width is a length
     everything inside it is a share of (\`./card.ts\`: the frame band and the
     loyalty shield are both \`calc(var(--card-w) * …)\`), so it cannot be a
     percentage; \`100cqi\` is the gallery's own inline size as a length, which is
     the same number without the resolution problem. The container is declared
     here rather than in \`./views.ts\` because nothing above a phone asks the
     gallery how wide it is. */
  ${CARDS} .mtg-gallery {
    display: grid; grid-template-columns: 1fr;
    container-type: inline-size;
  }
  ${CARDS} .mtg-gallery > .mtg-card,
  ${CARDS} .mtg-gallery .mtg-card[data-size='full'],
  ${CARDS} .mtg-gallery .mtg-card[data-size='compact'] { --card-w: 100cqi; }
}
`;
