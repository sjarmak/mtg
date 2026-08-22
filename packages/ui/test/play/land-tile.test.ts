// @vitest-environment jsdom
/**
 * The mana base as a row of art tiles under the cards in play.
 *
 * The playtester, 2026-08-13, after playing the lab: "btw I want the lands to show
 * up a little nicer so they are in a row below the cards in play and that they
 * just show their art no thick border and no text".
 *
 * Three requirements, and each one reverses part of what shipped an hour
 * earlier (`mtg-bc2.142`, which made a land the same board face every other
 * permanent gets, three lines of them in a band beside the row). A land is
 * still a face — that is what draws the art at all — but it is a face with one
 * region: `ART_REGIONS` is `['art', 'title']` but the title is never drawn, and
 * the identity border comes down from the board face's 4px to a single
 * keyline.
 *
 * **What this file can and cannot say**, in `./crowding.test.ts`'s words. jsdom
 * lays nothing out and evaluates no container query, so no assertion here is a
 * pixel. The numbers live in the commit message, measured with
 * `../../tools/board-crowding.ts` driven in chrome-headless-shell at 4, 7, 10
 * and 14 lands a side at 1280x800 and 1440x900. What is checkable without a
 * browser is the cascade the change is made of, and the three facts that are
 * not pixels at all: that a tile with no visible words is still a named,
 * described control; that it is still the control that taps the land; and that
 * the hover zoom beside it is still the whole card.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BASIC_LANDS, EXAMPLE_CARDS, renderOracleText, renderTypeLine } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Battlefield } from '../../src/board/Battlefield';
import type { BoardPermanent } from '../../src/board/Battlefield';
import { ART_REGIONS, ART_WINDOW } from '../../src/card/anatomy';
import { cssNumber } from '../../src/styles/number';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const SHEET = uiStyleSheet();

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return card;
}

function land(): DslCard {
  const card = BASIC_LANDS[0];
  if (card === undefined) throw new Error('the DSL example set has no basic lands');
  return card;
}

/**
 * The tapped tile's own shrink, restated from `ART_WINDOW` rather than typed
 * as a literal — the same idiom `tapped-slot.test.ts`'s `TAPPED_FACE_WIDTH`
 * uses for the card row's counterpart number, and for the same reason: a
 * regex that only checks the leading digit (`/scale: 0\.6\d+/`, what this
 * replaces) still passes if the art window's ratio drifts to anything else
 * starting with 0.6, so it cannot tell a deliberate retune from a silent one.
 * `mtg-ebo`/`mtg-0dl` are the record that this number is chosen rather than
 * incidental — 43.2% of an upright tile's area, kept because a tile carries no
 * words to blur and the band has no height to spend reserving the rotation
 * instead (`../../src/styles/board/lands.ts`, `TAPPED_TILE_SCALE`) — so the
 * test that stands for it should move exactly when the constant does, not
 * just when it changes by a lot.
 */
const TAPPED_TILE_SCALE = cssNumber(ART_WINDOW.height / ART_WINDOW.width);

/** The body of the one rule matching `selector`, or `null` when there is none. */
function rule(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(SHEET);
  return found === null ? null : (found[1] ?? '');
}

function board(permanents: readonly BoardPermanent[]): string {
  return renderToStaticMarkup(h(Battlefield, { label: 'Battlefield', permanents }));
}

describe('a land is an art tile', () => {
  it('draws one region and a name, and nothing else the face prints', () => {
    // The whole of "just show their art no text": the tile carries the window
    // and the name bar, and the name bar is what the degenerate case draws.
    // Type line, rarity seal, collector line and P/T are not laid out at all,
    // so no rule has to hide them and none of them can come back by cascade.
    expect([...ART_REGIONS]).toEqual(['art', 'title']);

    const markup = board([{ key: 'l1', card: land() }]);
    const tile = /<div class="mtg-lands">([\s\S]*?)<div class="mtg-zoom"/.exec(markup)?.[1] ?? '';
    expect(tile, 'the band draws no tile').toContain('data-size="art"');
    expect(tile).toContain('data-region="art"');
    expect(tile).toContain('data-region="title"');
    expect(tile, 'the tile lays out a type line').not.toContain('data-region="type"');
    expect(tile, 'the tile lays out a foot').not.toContain('data-region="footer"');
    expect(tile, 'the tile draws a rarity seal').not.toContain('mtg-card__seal');
  });

  /**
   * The name is never drawn, which is `mtg-dgv3`. It used to be revealed under
   * `:has([data-art-state='pending'])` — written as the answer to the degenerate
   * case, an art-only tile with no art being a blank square, and true enough
   * while most of the set was uncovered by any manifest. What it meant in
   * practice is that a land was labeled exactly until an art run reached it, so
   * the flagship's whole mana base changed appearance the day its basics were
   * covered. That is the defect: not which way it drew, but that the answer came
   * from the state of an output directory.
   *
   * It resolves toward no name, which is `mtg-ghv`'s question answered with the
   * instruction quoted at the top of this file — "no text" — and with the type
   * size, since a name in this box is about 8px upright and about 6.7px on a
   * tapped tile. What the degenerate case draws instead is the pending frame's
   * own pill, so a tile with no picture is still not a blank square.
   *
   * The pixels are not this file's — jsdom lays nothing out — and that the two
   * art states now measure identically is `../land-tile-name.browser.test.ts`'s
   * in a real browser. What is checkable here is that no rule keys anything the
   * tile draws off the art state, which is the shape of the defect rather than
   * one of its readings.
   */
  it('draws no name, and keys nothing it draws off whether the art resolved', () => {
    const title = rule(".mtg-card[data-size='art'] > [data-region='title']");
    expect(title, 'the tile has no rule for its title region').not.toBeNull();
    expect(title).toContain('display: none');

    // The whole of the defect: nothing a tile draws may be decided by whether an
    // art run happened to cover this card.
    const tileRules = [...SHEET.matchAll(/(?:^|\n)([^\n{}]*\[data-size='art'\][^\n{}]*)\{/g)].map(
      (found) => found[1] ?? '',
    );
    expect(tileRules.length, 'no tile rules found, so this gate read nothing').toBeGreaterThan(3);
    for (const selector of tileRules) {
      expect(selector, 'a tile rule still keys on the art state').not.toContain('data-art-state');
    }

    // The pending frame keeps its pill, sized to this box rather than to a full
    // face's window, and loses the card id under it: two labels do not fit here
    // and the pill is the one that says what the state is.
    const pill = rule(".mtg-card[data-size='art'] .mtg-art__pending-label");
    expect(pill, 'the tile no longer sizes the pending pill').not.toBeNull();
    expect(pill, 'the pill is hidden on a tile, which leaves a blank square').not.toContain('display: none');
    expect(pill, 'the pill is left at a full face width and clamps to the window').toContain(
      'width: min-content',
    );
    const note = rule(".mtg-card[data-size='art'] .mtg-art__pending-note");
    expect(note, 'the card id is still drawn under the pill').not.toBeNull();
    expect(note).toContain('display: none');
  });

  /**
   * "No thick border". The 7px identity border is the one border in the system
   * above 1px (DESIGN.md §4 names it as the exception); a board face wears it
   * at 4px, which on a 42px land face was a fifth of the card. The tile takes
   * one keyline, and keeps it in the identity color rather than dropping it
   * entirely: on a row of pictures the edge is the only thing left saying which
   * color the land makes.
   */
  it('draws one keyline instead of the printed border', () => {
    const tile = rule(".mtg-card[data-size='art']");
    expect(tile, 'the tile has no rule of its own').not.toBeNull();
    expect(tile).toContain('border-width: 1px');
    expect(tile).toContain('box-shadow: none');
    // The window's own keyline goes with it, or the tile wears two.
    const window = rule(".mtg-card[data-size='art'] > [data-region='art']");
    expect(window).toContain('border: 0');
  });

  /**
   * The one fact about a permanent an art tile carries no words for. The table
   * rotates a tapped card and the tile rotates with it — the rule that does it
   * is `.mtg-slot[data-tapped='true'] > .mtg-card`, which reaches the tile
   * because a tile is still a `.mtg-card` — and the tile adds a desaturation,
   * because a rotated *picture* reads far less loudly than a rotated card whose
   * name bar has visibly turned on its side.
   *
   * The scale is derived, not chosen: rotating a landscape tile 90 degrees puts
   * its height on the row's width axis, so it is scaled by the window's own
   * inverse ratio and the footprint never changes. That is the same bargain
   * `TAPPED_SCALE` strikes for a card, off the same kind of constant.
   */
  it('reads as tapped without a word, by rotating and losing its color', () => {
    const rotate = rule(".mtg-slot[data-tapped='true'] > .mtg-card");
    expect(rotate).toContain('rotate: 90deg');
    const tile = rule(".mtg-slot[data-tapped='true'] > .mtg-card[data-size='art']");
    expect(tile, 'a tapped tile is drawn exactly like an untapped one').not.toBeNull();
    expect(tile).toMatch(/grayscale\(/);
    expect(tile, 'the tapped tile scale drifted from the art window it is derived from').toContain(
      `scale: ${TAPPED_TILE_SCALE}`,
    );
    // Declared after the rule it narrows, or it loses the tie and never fires.
    expect(SHEET.indexOf(".mtg-slot[data-tapped='true'] > .mtg-card[data-size='art']")).toBeGreaterThan(
      SHEET.indexOf(".mtg-slot[data-tapped='true'] > .mtg-card {"),
    );
    expect(board([{ key: 'l1', card: land(), tapped: true }])).toContain('data-tapped="true"');
  });
});

describe('the band is one row under the cards in play', () => {
  /**
   * The structural half. The row used to be a flat list of slots with the band
   * as its last item, laid out beside them by `margin-inline-start: auto`; a
   * band *under* the row needs the spells in a box of their own, or the column
   * would put every permanent on a line of its own.
   */
  it('wraps the spells in a row of their own, with the band after it', () => {
    const markup = board([
      { key: 'p1', card: creature() },
      { key: 'l1', card: land() },
    ]);
    expect(markup).toContain('<div class="mtg-board__spells">');
    expect(markup.indexOf('class="mtg-board__spells"')).toBeLessThan(markup.indexOf('class="mtg-lands"'));
    // The band is a sibling of the spell row rather than inside it, so no
    // horizontal scroll of the spells can take the mana base off the screen.
    expect(markup).toMatch(/<\/div><div class="mtg-lands">/);
  });

  it('lays the battlefield body out as a column', () => {
    const markup = board([{ key: 'p1', card: creature() }]);
    expect(markup).toContain('data-layout="board"');
    const body = rule(".mtg-zone__body[data-layout='board']");
    expect(body, 'the board layout declares nothing').not.toBeNull();
    expect(body).toContain('flex-direction: column');
  });

  /**
   * One line, whatever the count. Fourteen lands is a board nobody reaches and
   * the band still may not become two lines, because a second line is a second
   * bite out of the spells' height. It scrolls instead, which is the one place
   * `docs/research/prior-art-board-layout.md` §2 finds a scrolling battlefield
   * precedented: "nobody scrolls one except Arena, and Arena scrolls only its
   * land row".
   */
  it('keeps the band on one line and scrolls it rather than wrapping', () => {
    const band = rule('.mtg-lands');
    expect(band, 'the band has no rule').not.toBeNull();
    expect(band).toContain('flex-wrap: nowrap');
    expect(band).toContain('overflow-x: auto');
    expect(band, 'the band grows into the row instead of keeping its line').toContain('flex: none');
  });

  /**
   * The band's slots are freed from the row's floors, and take no floor of
   * their own. Two floors that add to more than the box is the failure this
   * codebase hit as `mtg-bc2.137`, where a rail block too short for its content
   * painted over the block beneath it; a tile with a `min-height` under a band
   * with a fixed height is the same shape of mistake.
   */
  it('sizes a tile from one height and one ratio, with no floor under it', () => {
    const slot = rule(".mtg-lands > .mtg-slot[data-slot='play']");
    expect(slot, 'the band no longer sizes its own tiles').not.toBeNull();
    expect(slot).toContain('min-height: 0');
    expect(slot).toContain('min-width: 0');
    expect(slot).toMatch(/height: [\d.]+rem/);
    expect(slot).toMatch(/aspect-ratio: \d+ \/ \d+/);
    // Specific enough to beat the play route's own slot rule, which is what
    // makes this one declaration serve the played table and the replay board.
    expect(SHEET).not.toContain("[data-mtg-mode='play'] .mtg-lands");
    // And the three-line band's arithmetic is gone rather than left commented.
    expect(SHEET).not.toMatch(/\.mtg-lands[^{]*\{[^}]*calc\(\(100% -/);
  });
});

describe('a tile with no words is still a named control', () => {
  const named = land();

  it('carries the whole name and type line in both channels', () => {
    const markup = board([{ key: 'l1', card: named }]);
    const line = renderTypeLine(named);
    expect(line.length).toBeGreaterThan(0);
    const quoted = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(new RegExp(`aria-label="[^"]*${quoted(named.name)}`).test(markup)).toBe(true);
    expect(new RegExp(`aria-label="[^"]*${quoted(line)}`).test(markup)).toBe(true);
    expect(new RegExp(`title="[^"]*${quoted(named.name)}`).test(markup)).toBe(true);
    expect(new RegExp(`title="[^"]*${quoted(line)}`).test(markup)).toBe(true);
    // The rules text is the thing a tile most obviously drops, and the
    // description is where it went at every size but `full`.
    const oracle = renderOracleText(named).split('\n')[0] ?? '';
    expect(oracle.length).toBeGreaterThan(0);
    expect(new RegExp(`title="[^"]*${quoted(oracle)}`).test(markup)).toBe(true);
  });

  it('is a button, and reports the land it belongs to', () => {
    const picked: string[] = [];
    render(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [{ key: 'l1', card: named }],
        onSelect: (chosen: BoardPermanent) => {
          picked.push(chosen.key);
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(named.name) }));
    expect(picked).toEqual(['l1']);
  });

  /**
   * Where the words went. A tile prints none, so the hover zoom is not a
   * convenience on this surface — it is the only place the land's own text is
   * drawn, and it is the shared panel rather than a third reveal.
   *
   * Which makes the reveal worth naming rather than only counting: the
   * keyboard's half is `:focus-visible`, so a land's text is one Tab away on
   * every device, and a tap that selects the land does not bury the table under
   * it. `../../src/styles/card.ts` argues the pair.
   */
  it('keeps the shared zoom beside it, drawing the whole card', () => {
    const markup = board([{ key: 'l1', card: named }]);
    const band = /<div class="mtg-lands">([\s\S]*)$/.exec(markup)?.[1] ?? '';
    expect(band).toContain('class="mtg-zoom"');
    expect(band, 'the zoom no longer draws the readable face').toContain('data-size="full"');
    expect(SHEET).toContain('.mtg-slot:hover > .mtg-zoom, .mtg-slot:has(:focus-visible) > .mtg-zoom');
  });
});
