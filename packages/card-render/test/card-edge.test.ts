/**
 * The black outer edge, on the printed face.
 *
 * `mtg-d4g`. A printed card is black at the cut and its color starts just
 * inside; both of this repo's faces ran the identity all the way out, so a
 * proof sheet came off the printer as a page of colored tiles and a cut that
 * drifted outward left a green or blue hairline down one side of the card.
 *
 * The rule under test is a division of the band that already existed rather
 * than anything added to it: `CARD_EDGE_MM` is 0.9 of `FRAME_BAND_MM`'s 2.6, so
 * the identity keeps the inner 1.7 mm and *every content region stays exactly
 * where it was*. That last clause is asserted here too, because a frame change
 * that moved the art window by a unit would re-fit text boxes across the set
 * and would be invisible in a test that only looked at the new rect.
 */
import { describe, expect, it } from 'vitest';
import { CARD_EDGE_MM, FRAME_BAND_MM } from '@mtg/card-geometry';
import { CARD_GEOMETRY, CARD_HEIGHT, CARD_WIDTH, UNITS_PER_MM, renderCardSvg } from '@mtg/card-render';
import { stressCards } from './fixtures/cards';

const SUBJECT = stressCards().find((entry) => entry.id === 'stress-all-keywords');
if (SUBJECT === undefined) throw new Error('no stress card stress-all-keywords');

const EDGE = CARD_EDGE_MM * UNITS_PER_MM;

function layers(svg: string): string {
  const found = /<g class="frame-layers">[\s\S]*?<\/g>/.exec(svg);
  if (found === null) throw new Error('no frame layers');
  return found[0];
}

function rect(markup: string, className: string): Record<string, string> {
  const found = new RegExp(`<rect[^>]*class="${className}"[^>]*>`).exec(markup);
  if (found === null) throw new Error(`no ${className} rect`);
  const attrs: Record<string, string> = {};
  for (const match of found[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) attrs[name] = value;
  }
  return attrs;
}

describe('the printed card at the cut', () => {
  it('paints the outermost band in the edge ink, at the trim and over the whole card', () => {
    const edge = rect(layers(renderCardSvg(SUBJECT).svg), 'frame-edge');
    expect([edge['x'], edge['y']]).toEqual(['0', '0']);
    expect([edge['width'], edge['height']]).toEqual([String(CARD_WIDTH), String(CARD_HEIGHT)]);
    expect(edge['rx']).toBe(String(CARD_GEOMETRY.cornerRadius));
  });

  it('starts the identity ground one edge width inside it, on a concentric corner', () => {
    const ground = rect(layers(renderCardSvg(SUBJECT).svg), 'frame');
    expect([ground['x'], ground['y']]).toEqual([String(EDGE), String(EDGE)]);
    expect(ground['width']).toBe(String(CARD_WIDTH - EDGE * 2));
    expect(ground['height']).toBe(String(CARD_HEIGHT - EDGE * 2));
    // Concentric: a radius that stayed at 30 would draw the edge thicker at the
    // corners than along the sides, which is the one place the eye measures it.
    expect(ground['rx']).toBe(String(CARD_GEOMETRY.cornerRadius - EDGE));
  });

  it('is one band and not three, so neither rect carries a keyline', () => {
    const markup = layers(renderCardSvg(SUBJECT).svg);
    expect(rect(markup, 'frame-edge')['stroke-width']).toBeUndefined();
    expect(rect(markup, 'frame')['stroke-width']).toBeUndefined();
  });

  it('is the outermost thing drawn, so nothing paints over the cut', () => {
    const markup = layers(renderCardSvg(SUBJECT).svg);
    expect(markup.indexOf('class="frame-edge"')).toBeLessThan(markup.indexOf('class="frame"'));
  });

  it('takes its width from the band rather than from a second number', () => {
    expect(CARD_EDGE_MM).toBeLessThan(FRAME_BAND_MM);
    expect(CARD_GEOMETRY.edgeWidth).toBe(EDGE);
  });

  it('moves no region: the content inset is still the whole band', () => {
    const { art, title } = CARD_GEOMETRY;
    expect(art.x).toBe(FRAME_BAND_MM * UNITS_PER_MM);
    expect(title.x).toBe(FRAME_BAND_MM * UNITS_PER_MM);
    expect(renderCardSvg(SUBJECT).svg).toContain(`x="${String(art.x)}"`);
  });
});
