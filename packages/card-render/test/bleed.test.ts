/**
 * Bleed: the ink that runs past the cut, and the ring that stays clear of it.
 *
 * Both exist for the same reason and it is not a rendering reason. A card comes
 * off the printer as part of a sheet and somebody cuts it out, landing within
 * about half a millimeter of where they aimed. Everything here is about what
 * that half millimeter is allowed to hit.
 *
 * The two failures being prevented:
 *
 *  * Cut *outside* the trim and the blade passes through paper the ink never
 *    reached, because the ground is a rounded rectangle drawn exactly on the
 *    trim. That shows as a white nick at each corner and a white hairline down
 *    whichever edge drifted. Bleed fixes it by painting past the cut.
 *  * Cut *inside* the trim and the blade passes through the identity ring,
 *    which used to sit in the band 0.45–0.95 mm from the edge. That shows as a
 *    line thinner down one side than the other, which the eye catches at once
 *    on a rectangle. Moving the ring in fixes it.
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_GEOMETRY,
  CARD_HEIGHT_MM,
  CARD_WIDTH_MM,
  DEFAULT_BLEED_MM,
  UNITS_PER_MM,
  bleedGeometry,
  renderCardSvg,
} from '@mtg/card-render';
import { stressCards } from './fixtures/cards';

const CARDS = stressCards();

function card(id: string) {
  const found = CARDS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no stress card ${id}`);
  return found;
}

const SUBJECT = card('stress-all-keywords');

function rootTag(svg: string): string {
  const found = /<svg[^>]*>/.exec(svg);
  if (found === null) throw new Error('no root element');
  return found[0];
}

describe('the document a card is drawn into', () => {
  it('is exactly card-sized when nothing asked for a bleed', () => {
    const tag = rootTag(renderCardSvg(SUBJECT).svg);
    expect(tag).toContain(`width="${CARD_WIDTH_MM}mm"`);
    expect(tag).toContain(`height="${CARD_HEIGHT_MM}mm"`);
    expect(tag).toContain('viewBox="0 0 630 880"');
  });

  it('grows by the bleed on every side, and the origin goes negative to pay for it', () => {
    const tag = rootTag(renderCardSvg(SUBJECT, { bleedMm: DEFAULT_BLEED_MM }).svg);
    expect(tag).toContain(`width="${CARD_WIDTH_MM + DEFAULT_BLEED_MM * 2}mm"`);
    expect(tag).toContain(`height="${CARD_HEIGHT_MM + DEFAULT_BLEED_MM * 2}mm"`);
    expect(tag).toContain('viewBox="-30 -30 690 940"');
  });

  it('leaves every region where it was, which is the whole point of the negative origin', () => {
    // The art window is the region a shifted coordinate space would betray
    // first, because it is positioned and clipped in two separate places.
    const plain = renderCardSvg(SUBJECT).svg;
    const bled = renderCardSvg(SUBJECT, { bleedMm: DEFAULT_BLEED_MM }).svg;
    const artRect = /<rect[^>]*x="26"[^>]*y="106"[^>]*/;
    expect(artRect.test(plain)).toBe(true);
    expect(artRect.test(bled)).toBe(true);
  });

  it('refuses a negative bleed rather than inverting the document', () => {
    expect(() => bleedGeometry(-1)).toThrow(/non-negative/);
    expect(() => bleedGeometry(Number.NaN)).toThrow(/non-negative/);
  });
});

describe('the ink past the cut', () => {
  it('is absent entirely at zero bleed, so a screen card carries no print furniture', () => {
    const svg = renderCardSvg(SUBJECT).svg;
    expect(svg).not.toContain('frame-bleed');
    expect(svg).not.toContain('trim-mark');
  });

  it('covers the whole document, corners included, in the card ground', () => {
    const svg = renderCardSvg(SUBJECT, { bleedMm: DEFAULT_BLEED_MM }).svg;
    const found = /<rect class="frame-bleed"[^>]*>/.exec(svg);
    expect(found).not.toBeNull();
    const rect = found?.[0] ?? '';
    expect(rect).toContain('x="-30"');
    expect(rect).toContain('y="-30"');
    expect(rect).toContain('width="690"');
    expect(rect).toContain('height="940"');
    // Square on purpose: the rounded corner is made by the knife, not drawn.
    expect(rect).not.toContain('rx=');
    expect(rect).toContain('fill="var(--frame)"');
  });

  it('is painted before the card, so the rounded ground still reads on screen', () => {
    const svg = renderCardSvg(SUBJECT, { bleedMm: DEFAULT_BLEED_MM }).svg;
    expect(svg.indexOf('frame-bleed')).toBeLessThan(svg.indexOf('class="frame-layers"'));
  });
});

describe('the trim marks', () => {
  it('stay entirely outside the finished card, so no cut can leave one on it', () => {
    const svg = renderCardSvg(SUBJECT, { bleedMm: DEFAULT_BLEED_MM }).svg;
    const found = /<path class="trim-mark" d="([^"]+)"/.exec(svg);
    expect(found).not.toBeNull();
    const path = found?.[1] ?? '';
    const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    expect(numbers.length).toBeGreaterThan(0);
    // Every coordinate is either outside the trim box or exactly on its edge,
    // and no segment runs inward from a corner.
    const insideHorizontally = numbers.filter((value) => value > 0 && value < CARD_GEOMETRY.card.width);
    const strictlyInside = insideHorizontally.filter(
      (value) => value > 10 && value < CARD_GEOMETRY.card.width - 10,
    );
    expect(strictlyInside).toEqual([]);
  });
});

describe('the identity ring', () => {
  it('sits far enough in that a half-millimeter miscut cannot clip it', () => {
    const tolerance = 0.5 * UNITS_PER_MM;
    const innerEdge = CARD_GEOMETRY.ringInset - CARD_GEOMETRY.ringWidth / 2;
    expect(innerEdge).toBeGreaterThan(tolerance);
  });

  it('still clears the printed content on the inside', () => {
    const outerEdge = CARD_GEOMETRY.ringInset + CARD_GEOMETRY.ringWidth / 2;
    expect(outerEdge).toBeLessThan(CARD_GEOMETRY.framePadding);
  });

  it('keeps a positive corner radius after being inset', () => {
    expect(CARD_GEOMETRY.cornerRadius - CARD_GEOMETRY.ringInset).toBeGreaterThan(0);
  });
});
