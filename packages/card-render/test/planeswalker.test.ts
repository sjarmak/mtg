/**
 * The printed planeswalker face.
 *
 * A planeswalker is the one card whose text box is not a paragraph. It is a
 * table: a row per loyalty ability, ruled off from the next, each with the cost
 * it charges in a badge at the left margin and its sentence in a column beside
 * it, and the starting loyalty in a shield hanging off the bottom-right corner
 * of the frame. Nothing else in the set draws any of that, so nothing else in
 * this suite would notice it breaking.
 *
 * What is checked here is the printed face's own arithmetic: where the boxes
 * are, what the renderer emitted into them, and that the two never overlap.
 * Parity with the web face (same costs, same silhouettes, same window) is
 * `parity.test.ts`'s, because it is a claim about two renderers rather than
 * about this one.
 */
import { describe, expect, it } from 'vitest';
import type { Card, PlaneswalkerCard } from '@mtg/dsl';
import { isPlaneswalker } from '@mtg/dsl';
import { textBoxBlocks } from '@mtg/ui';
import {
  CARD_GEOMETRY,
  CARD_HEIGHT,
  PLANESWALKER_GEOMETRY,
  cardGeometry,
  checkSvgOverflow,
  renderCardSvg,
} from '@mtg/card-render';
import { planeswalkerCards, stressCards } from './fixtures/cards';

const WALKERS = planeswalkerCards();

function walker(id: string): PlaneswalkerCard {
  const found = WALKERS.find((card) => card.id === id);
  if (found === undefined) throw new Error(`no planeswalker fixture ${id}`);
  if (!isPlaneswalker(found)) throw new Error(`fixture ${id} is not a planeswalker`);
  return found;
}

/** The two-ability fixture, the flavored one, and the three-row ultimate. */
const PLAIN = walker('planeswalker-loyalty-badge');
const FLAVORED = walker('planeswalker-uncosted-row');
const ULTIMATE = walker('planeswalker-ultimate');

function svgOf(card: Card): string {
  return renderCardSvg(card).svg;
}

/** Every `x` a run of set rules text was placed at, in document order. */
function runStarts(svg: string): readonly number[] {
  // `rules-text ink` opens the class list and the flavor row appends `italic`
  // to it, so the pattern is deliberately open at the end: an uncosted row is
  // exactly the row this helper exists to see.
  return [...svg.matchAll(/<text class="rules-text ink[^"]*" x="([-\d.]+)"/g)].map((match) =>
    Number(match[1]),
  );
}

/** The lowest ink in the rules box: the last baseline the renderer wrote. */
function lastBaseline(svg: string): number {
  const ys = [...svg.matchAll(/<text class="rules-text ink[^"]*"[^>]*\sy="([-\d.]+)"/g)].map((match) =>
    Number(match[1]),
  );
  if (ys.length === 0) throw new Error('the face set no rules text');
  return Math.max(...ys);
}

function badgeCount(svg: string): number {
  return [...svg.matchAll(/<polygon class="loyalty-badge"/g)].length;
}

function ruleYs(svg: string): readonly number[] {
  return [...svg.matchAll(/<line class="loyalty-rule"[^>]*\sy1="([-\d.]+)"/g)].map((match) =>
    Number(match[1]),
  );
}

describe('the planeswalker frame', () => {
  it('takes its extra rules height from the art window and nowhere else', () => {
    // The playtester's rule for every other card is that the window does not move
    // ("the dimensions of the card art should be consistent across cards but we
    // can adjust the text size within the box"), and a walker is where the text
    // has run out of room to give: three ruled rows in a narrowed column ask
    // for more lines than any creature in the set. So the picture pays, which
    // is what a printed walker does, and every other box keeps its size.
    const gift = CARD_GEOMETRY.art.height - PLANESWALKER_GEOMETRY.art.height;
    // What the foot of the box gives back, so the last row cannot be printed
    // behind the shield. The box nets the difference, and stating it as
    // subtraction is the point: a change to either end has to show up here.
    const given =
      CARD_GEOMETRY.rules.y +
      CARD_GEOMETRY.rules.height -
      (PLANESWALKER_GEOMETRY.rules.y + PLANESWALKER_GEOMETRY.rules.height);
    expect(gift).toBeGreaterThan(0);
    expect(given).toBeGreaterThan(0);
    expect(gift).toBeGreaterThan(given);
    expect(PLANESWALKER_GEOMETRY.rules.height - CARD_GEOMETRY.rules.height).toBeCloseTo(gift - given, 6);
    expect(PLANESWALKER_GEOMETRY.rules.height).toBeGreaterThan(CARD_GEOMETRY.rules.height);
    for (const region of ['card', 'frame', 'title', 'powerToughness', 'loyalty'] as const) {
      expect(PLANESWALKER_GEOMETRY[region], region).toEqual(CARD_GEOMETRY[region]);
    }
    // The bars keep their heights and their left edge; only their y moved, and
    // by exactly what the window gave up.
    expect(PLANESWALKER_GEOMETRY.type.height).toBe(CARD_GEOMETRY.type.height);
    expect(CARD_GEOMETRY.type.y - PLANESWALKER_GEOMETRY.type.y).toBeCloseTo(gift, 6);
    expect(CARD_GEOMETRY.rules.y - PLANESWALKER_GEOMETRY.rules.y).toBeCloseTo(gift, 6);
  });

  it('stops the rules box above the shield rather than behind it', () => {
    // The occlusion defect, answered by arithmetic instead of by hope: the box
    // ends above the shield's top edge, so there is no card wordy enough to
    // reach the shield. A renderer that drew the shield over the last row would
    // fail here before anyone had to look at a screenshot.
    const rules = PLANESWALKER_GEOMETRY.rules;
    const shield = PLANESWALKER_GEOMETRY.loyalty;
    expect(rules.y + rules.height).toBeLessThan(shield.y);
    // And the shield really is in the corner, hanging into the frame band the
    // way a printed one does rather than sitting inside the content area.
    expect(shield.x + shield.width).toBe(CARD_GEOMETRY.footer.x + CARD_GEOMETRY.art.width);
    expect(shield.y + shield.height).toBeGreaterThan(CARD_HEIGHT - CARD_GEOMETRY.framePadding);
    expect(shield.y + shield.height).toBeLessThanOrEqual(CARD_HEIGHT);
    // The footer bar gives the shield its width instead of running under it,
    // which is the same rule the P/T plate already had.
    expect(PLANESWALKER_GEOMETRY.footer.width).toBeLessThan(CARD_GEOMETRY.art.width);
    expect(PLANESWALKER_GEOMETRY.footer.x).toBe(CARD_GEOMETRY.footer.x);
  });

  it('hands every other card the ordinary frame, unchanged', () => {
    const creature = stressCards()[0];
    if (creature === undefined) throw new Error('stress fixtures are empty');
    expect(cardGeometry(creature)).toBe(CARD_GEOMETRY);
    expect(cardGeometry(ULTIMATE)).toBe(PLANESWALKER_GEOMETRY);
  });
});

describe('the printed planeswalker face', () => {
  it('draws one cost badge per costed row and rules between the rows', () => {
    for (const card of WALKERS) {
      const svg = svgOf(card);
      const costed = textBoxBlocks(card).filter((block) => block.loyaltyCost !== undefined);
      expect(badgeCount(svg), `${card.id} badges`).toBe(costed.length);
      // One fewer than there are ability rows. The first opens the box rather
      // than being ruled off from something above it, and an uncosted row gets
      // none either: it is not an ability, so there is nothing above it to
      // divide it from. The web sheet says the same thing by hanging its
      // `border-top` on `[data-loyalty]` and clearing it on `:first-child`.
      const rules = ruleYs(svg);
      expect(rules.length, `${card.id} dividers`).toBe(costed.length - 1);
      const box = PLANESWALKER_GEOMETRY.rules;
      for (const y of rules) {
        expect(y).toBeGreaterThan(box.y);
        expect(y).toBeLessThan(box.y + box.height);
      }
      // Written down the box in order, which is what makes them dividers rather
      // than a decoration that happens to be drawn the right number of times.
      expect([...rules].sort((a, b) => a - b)).toEqual([...rules]);
    }
  });

  it('sets a costed row in its own column and an uncosted row across the box', () => {
    const svg = svgOf(FLAVORED);
    const box = PLANESWALKER_GEOMETRY.rules;
    const inner = box.x + PLANESWALKER_GEOMETRY.textPadding;
    const starts = [...new Set(runStarts(svg))].sort((a, b) => a - b);
    expect(starts.length, 'the face sets two columns').toBe(2);
    expect(starts[0], 'the uncosted row starts at the left edge of the box').toBe(inner);
    expect(starts[1] ?? 0, 'the sentence column clears the badge').toBeGreaterThan(inner);
    // The column the sentences are in starts to the right of every badge, so a
    // sentence cannot be set over the number that pays for it.
    const badgeRight = [...svg.matchAll(/<polygon class="loyalty-badge" points="([^"]+)"/g)]
      .map((match) => match[1] ?? '')
      .flatMap((points) => points.split(/\s+/).map((pair) => Number(pair.split(',')[0])));
    expect(Math.max(...badgeRight)).toBeLessThan(starts[1] ?? 0);
  });

  it('prints a negative cost with the minus sign Magic uses, not a hyphen', () => {
    const svg = svgOf(ULTIMATE);
    expect(svg).toContain('data-loyalty="−8"');
    expect(svg).toContain('>−8<');
    expect(svg).not.toContain('data-loyalty="-8"');
  });

  it('prints the starting loyalty in the shield, in the card corner', () => {
    const svg = svgOf(PLAIN);
    const shield = /<polygon class="loyalty-shield" points="([^"]+)"/.exec(svg);
    expect(shield, 'the face drew no shield').not.toBeNull();
    const ys = (shield?.[1] ?? '').split(/\s+/).map((pair) => Number(pair.split(',')[1]));
    // The point of the shield is the lowest ink on the card, below the frame
    // band: it hangs off the corner rather than sitting in the content area.
    expect(Math.max(...ys)).toBeGreaterThan(CARD_HEIGHT - CARD_GEOMETRY.framePadding);
    expect(svg).toContain('data-region="loyalty"');
    expect(svg).toContain(`>${String(PLAIN.startingLoyalty)}<`);
  });

  it('keeps every row clear of the shield, on the wordiest walker in the fixtures', () => {
    // The defect the owner reported, as an assertion: the last row's ink ends
    // above the shield's top edge, with no clipping and no shrinking below the
    // ladder's floor to get there. `renderCardSvg` reports its own fits, so a
    // face that could only fit by giving up fails on `ok` rather than by
    // printing something narrower than it claimed.
    const box = PLANESWALKER_GEOMETRY.rules;
    let deepest = box.y;
    for (const card of WALKERS) {
      const render = renderCardSvg(card);
      expect(render.failures, `${card.id} fit failures`).toEqual([]);
      expect(render.ok, `${card.id} fits`).toBe(true);
      const foot = lastBaseline(render.svg);
      expect(foot, `${card.id} last row over the shield`).toBeLessThan(PLANESWALKER_GEOMETRY.loyalty.y);
      // Inside the box it was fitted against, which is the check that catches a
      // row running off the bottom of the card rather than onto the shield.
      expect(foot, `${card.id} last row inside its box`).toBeLessThan(box.y + box.height);
      expect(checkSvgOverflow(render.svg), `${card.id} overflow`).toEqual([]);
      deepest = Math.max(deepest, foot);
    }
    // The clearance above is the box's, not the fixtures': the box ends above
    // the shield, so no card can reach it. That is only a guarantee if a card
    // in the corpus actually fills the box, or the loop is measuring slack it
    // was handed. The ultimate walker uses most of it.
    expect(deepest, 'the wordiest walker leaves the lower box empty').toBeGreaterThan(
      box.y + box.height * 0.6,
    );
  });
});
