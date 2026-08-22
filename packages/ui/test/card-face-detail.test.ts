// @vitest-environment jsdom
/**
 * The face's *description*, and the one premise its *name* is argued from.
 *
 * Two sentences on `../src/card/Card.ts` decided what a card face says, and
 * neither had anything holding it.
 *
 * `faceDetailText` says it carries the card's name and its type line "because
 * the face prints them into a box narrow enough to ellipsize". That is true and
 * it is measurable: in chrome-headless-shell 151.0.7922.47, in the
 * 68.47 x 95.64px slot `./board-face-cost.test.ts` takes its arithmetic from,
 * Skywatch Sentinel's board face paints `Skywat` then `…` where its name goes
 * and `Crea` then `…` where its type line goes, so the `title` is the only
 * uncut copy of either on that face. The whole ui and card-render suite stayed
 * green with both fields deleted from the function, because the one assertion
 * that touched it read `title="${faceDetailText(card)}"` — the implementation
 * asked what it says and told it was right.
 *
 * `faceAccessibleName` puts the mana cost in the name because on a board face
 * `cornerCost` is `aria-hidden`, so nothing else says it. Removing that
 * attribute also left the suite green. Measured at the same version, it is the
 * difference between a board face whose only `image` child is the art window
 * and one that publishes `image name="Mana cost {1}{W}"` a screen reader would
 * read straight after the name that already said it.
 *
 * Every expected string below is written out rather than derived from the
 * function under test, which is the whole point of the file.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Card as DslCard } from '@mtg/dsl';
import { BASIC_LANDS, EXAMPLE_CARDS, isCastable, renderTypeLine } from '@mtg/dsl';
import { Card, faceAccessibleName, faceDetailText } from '../src/card/Card';
import type { CardSize } from '../src/card/Card';
import { collectorLine } from '../src/card/anatomy';
import { manaCostLabel } from '../src/card/ManaPips';

afterEach(cleanup);

const SIZES: readonly CardSize[] = ['full', 'compact', 'board'];
const ALL_CARDS: readonly DslCard[] = [...EXAMPLE_CARDS, ...BASIC_LANDS];

function named(name: string): DslCard {
  const card = ALL_CARDS.find((entry) => entry.name === name);
  if (card === undefined) throw new Error(`the DSL example set has no card named ${name}`);
  return card;
}

const SENTINEL = named('Skywatch Sentinel');
const SWAMP = named('Swamp');

describe('what an abbreviated card face describes itself as', () => {
  it('spells the name, the type line, the rules text and the printing, in printed order', () => {
    expect(faceDetailText(SWAMP)).toBe('Swamp\nBasic Land — Swamp\n{T}: Add {B}.\nSLC 020 · common · Land');
    expect(faceDetailText(SENTINEL)).toBe(
      'Skywatch Sentinel\nCreature — Bird Soldier\nFlying, vigilance\nSLC 001 · common · MV 2',
    );
  });

  /**
   * The sweep, because the two literals above are two cards and the property is
   * about every card the face draws small: the printed name and the printed
   * type line are the two boxes that ellipsize, and this string is the copy
   * that is not cut.
   */
  it('carries the three fields no face prints whole, on every card', () => {
    for (const card of ALL_CARDS) {
      const detail = faceDetailText(card);
      expect(detail, `${card.id} name`).toContain(card.name);
      expect(detail, `${card.id} type line`).toContain(renderTypeLine(card));
      expect(detail, `${card.id} collector line`).toContain(collectorLine(card));
    }
  });

  it('is the title at every size, including the two that print the rules box', () => {
    // `full` used to be the exception, because it printed the rules box and the
    // collector line and so owed nothing. The bar is gone (`anatomy.ts`,
    // FACE_REGIONS) and the words have to be somewhere, so that face now says
    // its rules text twice — once in the box and once here — and its collector
    // line once, here.
    //
    // `board` is the second, and it is why this assertion is a set rather than
    // an equality with `full`: mtg-u69 put the rules box back on the played
    // table, where the box clips at a stated number of lines and this string is
    // what carries the rest. `compact` and `art` still print no box at all, so
    // for those two it is the only copy there is.
    const withBox: readonly CardSize[] = ['full', 'board'];
    const title = 'title="Swamp\nBasic Land — Swamp\n{T}: Add {B}.\nSLC 020 · common · Land"';
    for (const size of SIZES) {
      const markup = renderToStaticMarkup(h(Card, { card: SWAMP, size }));
      expect(markup.includes('data-region="rules"'), `${size} rules box`).toBe(withBox.includes(size));
      expect(markup.includes(title), `${size} title`).toBe(true);
    }
  });
});

describe('the mana cost a board face does not draw twice', () => {
  const label = 'Mana cost {1}{W}';

  it('agrees with the label the pip run publishes', () => {
    expect(isCastable(SENTINEL)).toBe(true);
    if (!isCastable(SENTINEL)) throw new Error('the sentinel stopped being castable');
    expect(manaCostLabel(SENTINEL.manaCost)).toBe(label);
    expect(faceAccessibleName(SENTINEL)).toContain(label);
  });

  it('is in the board face name and nowhere else in that face', () => {
    render(h(Card, { card: SENTINEL, size: 'board', onSelect: () => undefined }));
    expect(screen.getByRole('button', { name: faceAccessibleName(SENTINEL) })).toBeTruthy();
    // The corner pips are `aria-hidden`, so the tree holds one copy of the cost
    // rather than two. The art window's own label is still published, which is
    // what makes this an assertion about the cost and not about images.
    expect(screen.queryByRole('img', { name: label })).toBeNull();
    expect(screen.getByRole('img', { name: 'Art pending for slc-skywatch-sentinel' })).toBeTruthy();
  });

  /**
   * The control. `full` and `compact` draw the run in the title bar and leave it
   * named, so the face says the cost twice there; that is what the board face
   * is being contrasted with, and asserting it keeps the test above from
   * passing for the wrong reason.
   */
  it('is published by the pip run at the two sizes that draw it in the title bar', () => {
    for (const size of ['full', 'compact'] as const) {
      render(h(Card, { card: SENTINEL, size }));
      expect(screen.getByRole('img', { name: label }), size).toBeTruthy();
      cleanup();
    }
  });
});

/**
 * The other half of the same argument, which nothing was holding.
 *
 * `faceAccessibleName` leaves the rarity out of the name on the stated grounds
 * that the seal announces it and the collector line spells it. That used to be
 * conditional: the seal spoke only on a board face or behind a footnote,
 * because at `full` and `compact` the printed collector line was a second
 * reading of it. Deleting the `size === 'board'` clause left the whole `ui` and
 * `card-render` suite green, which was a board face announcing its rarity in no
 * place at all.
 *
 * No face prints the collector line now (`../src/card/anatomy.ts`,
 * FACE_REGIONS), so the condition is gone and the seal is the only carrier at
 * every size. What the assertions below check is the same property one step
 * stronger: the rarity is out of every face's name, and in every face's seal.
 *
 * The seal speaks its set as well, and the name it is asked for below is the
 * whole of it rather than a substring. The mark is the set's — one shape per
 * set, resolved from `card.set.code` — and the ink is the rarity's, so the two
 * words are the drawing read aloud, and an exact name is what keeps this from
 * passing on a seal that dropped one of them.
 */
describe('the rarity the face name leaves to the seal', () => {
  const RARITY = SENTINEL.rarity;
  const SPOKEN = `${SENTINEL.set.code} ${RARITY}`;

  it('is out of the face name at every size, which is what makes the seal load-bearing', () => {
    expect(RARITY).toBe('common');
    for (const size of SIZES) {
      expect(faceAccessibleName(SENTINEL), size).not.toContain(RARITY);
    }
  });

  it('is announced by the seal at every size, and printed as words at none', () => {
    for (const size of SIZES) {
      render(h(Card, { card: SENTINEL, size, onSelect: () => undefined }));
      expect(screen.getByRole('img', { name: SPOKEN }), size).toBeTruthy();
      expect(screen.queryByText(collectorLine(SENTINEL)), size).toBeNull();
      cleanup();
    }
  });

  /** And it is still in the description, which is where the words went. */
  it('is spelled in the detail text the face carries in its title', () => {
    expect(faceDetailText(SENTINEL)).toContain(collectorLine(SENTINEL));
    expect(collectorLine(SENTINEL)).toContain(RARITY);
  });

  /** A footnote no longer displaces anything; the seal was already speaking. */
  it('is announced by the seal when a footnote takes the foot of the face', () => {
    render(h(Card, { card: SENTINEL, size: 'compact', footnote: 'Sealed pool, pack 3' }));
    expect(screen.getByRole('img', { name: SPOKEN })).toBeTruthy();
    expect(screen.getByText('Sealed pool, pack 3')).toBeTruthy();
  });
});
