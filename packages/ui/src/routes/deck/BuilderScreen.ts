/**
 * The app frame a deckbuilding surface is drawn inside.
 *
 * `mtg-tz11` made an open deck a frame of boxes and `mtg-pmpu` made the
 * Constructed builder one: the window is filled exactly once, a head bar stays
 * put, and everything below it scrolls inside itself rather than as a document.
 * `../../styles/panel.ts` states that contract and `../../styles/deck.ts` says
 * what each of the two screens does with it.
 *
 * It is a function here rather than four copies because there are four hosts
 * and only one arrangement. `../DeckRoute.ts` draws two of them (an open deck
 * and the Constructed builder) and `../play/SealedBuilder.ts` is drawn by three
 * more — `../play/SealedGame.ts`, `../play/RemoteSealed.ts` and
 * `../draft/DraftGame.ts` — each of which rendered it into a plain document
 * until `mtg-sk1c`, so the frame rules never matched and the sticky counts bar
 * was working against the page scroll on the one screen whose whole activity is
 * moving cards between two panes.
 *
 * What a host still owns is what goes in the head bar, because that is the only
 * part that differs: a title and a back button on the Decks route, the word
 * Draft on a finished draft, nothing at all on a sealed pool opened from the
 * Play tab. A head of `null` draws no bar rather than an empty one.
 *
 * `data-rail='none'` throughout. None of these screens has a card rail; the
 * left filter rail is `mtg-m9op` and is blocked on the Decks route having a
 * pool to filter at all.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Which screen this is, for the sheet.
 *
 * One arrangement and two sets of rules, because what fills it differs: an open
 * deck's panes divide the window at every size, and a builder's only do where
 * they sit side by side. `../../styles/deck.ts` argues that at the rule.
 */
export type DeckScreenKind = 'mtg-deck-screen' | 'mtg-builder-screen';

export interface BuilderScreenProps {
  readonly screen: DeckScreenKind;
  /** The head bar's contents, or `null` for a screen that has no bar. */
  readonly head: ReactNode;
  readonly body: ReactNode;
  /**
   * Whether the frame's rules apply to what is inside.
   *
   * `false` is a live game. The frame's contract is that nothing inside it
   * scrolls except a pane, which is a true sentence about two panes of cards and
   * a false one about a board, so a table keeps the plain document it has always
   * had.
   *
   * **It is a flag here rather than a second wrapper at the call site, and that
   * is the whole of the fix for a defect that made Constructed unplayable.**
   * Both hosts used to return a different tree once the game started —
   * `builderScreen`'s four nested divs while building, a bare div with a page
   * head while playing. React reconciles by position, so a child under a
   * different tree is a different child: `ConstructedGame` unmounted and
   * remounted with its dealt table back to `null` in the same commit that set
   * it, and the board was discarded the instant it was dealt. Nothing errored
   * and the builder simply redrew, which is why it survived every test that
   * checked the button was live.
   *
   * The divs are therefore always the same divs, and only their classes change.
   * A `div` whose className changes is the same element to React, so whatever is
   * inside keeps its state across the switch.
   */
  readonly framed?: boolean;
}

export function builderScreen(props: BuilderScreenProps): ReactElement {
  const framed = props.framed ?? true;
  return createElement(
    'div',
    framed ? { className: `${props.screen} mtg-screen` } : null,
    props.head === null ? null : createElement('div', { className: 'mtg-page-head' }, props.head),
    createElement(
      'div',
      framed ? { className: 'mtg-work', 'data-rail': 'none' } : null,
      createElement(
        'div',
        framed ? { className: 'mtg-work__main' } : null,
        createElement('div', framed ? { className: 'mtg-work__scroll' } : null, props.body),
      ),
    ),
  );
}
