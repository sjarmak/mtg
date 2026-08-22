/**
 * The mana base's tile, and the two things the playtester asked of it on 2026-08-14:
 * "I want the lands to show up a bit bigger too so it's obvious they're lands".
 *
 * The size half is geometry and cannot be asserted here — jsdom lays nothing
 * out, so `../tools/board-crowding.ts` and `../tools/card-uniformity.ts` are
 * where the tile's 85.2 x 56 and the spell face it did not cost were read in
 * chrome-headless-shell 151, and `../src/styles/board/lands.ts` carries the
 * walk. What is checkable without a browser is the other half: *what* the tile
 * draws to say it is a land, and where that drawing comes from.
 *
 * The answer is the mana symbol, over the picture, from `../src/card/symbols.ts`
 * — the same registry the rules box, the title bar's cost pips, the floating
 * mana pool and the deck tile all read. A second drawing of a mana symbol is the
 * defect `mtg-bc2.45.5` closed one surface over and the one this file exists to
 * stop from reappearing on a third.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BASIC_LANDS, EXAMPLE_CARDS, isLand } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import type { CardSize } from '../src/card/Card';
import { ART_REGIONS } from '../src/card/anatomy';
import { SCRYFALL_SYMBOL_BASE } from '../src/card/symbols';
import { uiStyleSheet } from '../src/styles/index';

const SHEET = uiStyleSheet();

function tile(card: DslCard, size: CardSize = 'art'): string {
  return renderToStaticMarkup(h(Card, { card, size }));
}

/** The one basic every assertion below is written about. */
function island(): DslCard {
  const found = BASIC_LANDS.find((land) => isLand(land) && land.basicLandType === 'Island');
  if (found === undefined) throw new Error('no Island among the basics');
  return found;
}

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((candidate) => candidate.kind === 'creature');
  if (card === undefined) throw new Error('the example set prints no creature');
  return card;
}

describe('a land in play says which mana it makes', () => {
  it('draws one symbol for every color the land produces, and names it as printed', () => {
    for (const land of BASIC_LANDS) {
      if (!isLand(land)) throw new Error(`${land.id} is among the basics and is not a land`);
      const markup = tile(land);
      expect(land.producesMana.length, `${land.id} produces nothing`).toBe(1);
      for (const color of land.producesMana) {
        // `data-symbol` is the token as printed, which is what both faces are
        // checked on elsewhere and what says this came through the registry
        // rather than out of a second drawing keyed some other way.
        expect(markup, `${land.id} draws no {${color}}`).toContain(`data-symbol="{${color}}"`);
      }
      const drawn = [...markup.matchAll(/data-symbol="\{[WUBRG]\}"/g)];
      expect(drawn.length, `${land.id} draws ${String(drawn.length)} symbols for one color`).toBe(1);
    }
  });

  it('takes the artwork from the one registry rather than drawing a second one', () => {
    // The `scryfall` set is asked for by name because it is the one whose answer
    // is a *reference* — an href this tree does not hold — so a tile that
    // produced the same picture without going through `symbolArt` could not
    // produce this string. The lab's own drawings are checked from the other
    // end below, since that is what a launcher with no network paints with.
    const referenced = renderToStaticMarkup(h(Card, { card: island(), size: 'art', symbols: 'scryfall' }));
    expect(referenced).toContain(`${SCRYFALL_SYMBOL_BASE}U.svg`);
    const drawn = renderToStaticMarkup(h(Card, { card: island(), size: 'art', symbols: 'original' }));
    expect(drawn, 'the drawn set paints no disc identity').toContain('data-glyph="u"');
  });

  it('is drawn over the picture rather than laid out under it, so the tile is still all art', () => {
    // Positioned, inside the window, and out of the accessible tree. Inside is
    // the load-bearing part and it is the same guard `.mtg-card__corner` has:
    // the window is `overflow: hidden`, so a badge pinned to its corner is
    // clipped by the picture instead of escaping onto whatever is below it.
    const markup = tile(island());
    const windowAt = markup.indexOf('class="mtg-art"');
    const manaAt = markup.indexOf('mtg-card__mana');
    expect(windowAt, 'the tile draws no art window').toBeGreaterThanOrEqual(0);
    expect(manaAt, 'the symbol is not inside the window').toBeGreaterThan(windowAt);
    expect(markup).toMatch(/class="mtg-card__mana" aria-hidden="true"/);
    const rule = /\.mtg-card__mana \{([^}]*)\}/.exec(SHEET)?.[1] ?? '';
    expect(rule, 'the symbol is laid out and takes the tile height').toContain('position: absolute');
    expect(rule, 'the symbol is not sized against the tile').toMatch(/font-size: clamp\(.*cqw/);

    // And the region list is unchanged by it, which is the point of an overlay:
    // a tile is still nothing but a picture, and the region list says so.
    expect([...ART_REGIONS]).toEqual(['art', 'title']);
  });

  it('is the tile only, so no other face gains a symbol it did not draw before', () => {
    for (const size of ['board', 'full'] as const) {
      expect(tile(island(), size), `the ${size} face drew a land pip`).not.toContain('mtg-card__mana');
    }
    // And a permanent that is not a land never draws one at any size, which is
    // what makes the symbol a statement about the card rather than about the
    // tile it happens to be in.
    expect(tile(creature()), 'a creature drew a land pip').not.toContain('mtg-card__mana');
  });
});

/**
 * The other region that left the column on 2026-08-14, and the reason it did.
 *
 * The playtester: "its art is all smushed". The board face's foot row carried the
 * P/T and cost about 15px of a 115.4px face at 1280x800 with the picture paying
 * for it, so the badge moved out of flow into the card's own corner — where the
 * full face has drawn it since it dropped its own footer, and where a printed
 * card has drawn it since 1993.
 */
describe('a board face draws its power and toughness out of the column', () => {
  it('puts the badge in the corner and draws no foot row for an ordinary creature', () => {
    const markup = tile(creature(), 'board');
    expect(markup, 'the badge is missing entirely').toContain('mtg-card__pt');
    expect(markup, 'the badge is in the corner sibling').toContain('class="mtg-card__stats"');
    expect(markup, 'the face still spends a row on the foot').not.toContain('data-region="footer"');
  });

  it('still lays the row out when a caller has a footnote for it', () => {
    // `Battlefield` passes one for an attached permanent, and that is the whole
    // remaining occupant of the region. Dropping the row unconditionally would
    // take `Equipping <name>` off the board with it.
    const markup = renderToStaticMarkup(
      h(Card, { card: creature(), size: 'board', footnote: 'Equipping a thing' }),
    );
    expect(markup).toContain('data-region="footer"');
    expect(markup).toContain('Equipping a thing');
  });

  it('leaves the compact face its foot, because that face has no picture to protect', () => {
    const markup = tile(creature(), 'compact');
    expect(markup).toContain('data-region="footer"');
    expect(markup, 'the compact face grew a corner badge').not.toContain('class="mtg-card__stats"');
  });
});
