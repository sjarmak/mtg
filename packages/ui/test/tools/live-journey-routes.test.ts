/**
 * The live journey opens a printed format's shipped decks under the section the
 * Play chooser lists them in, and the router parses the hash it builds.
 *
 * The journey's own hash was typed by hand and went stale when the decks moved
 * tabs (`../../tools/live-journey-routes.ts` says how that read at the time),
 * so the section is checked against `playSources` rather than restated here.
 */
import { describe, expect, it } from 'vitest';
import { parseHash, UI_SUBS } from '../../src/app/router';
import type { PrintedFormatRow } from '../../src/lab/printed-format';
import { playSources } from '../../src/routes/play/sources';
import type { StagedSources } from '../../src/routes/play/sources';
import { faceFlipLabel } from '../../src/card/FaceFlip';
import { FACE_FLIP_LABEL_SOURCE, playHash, sectionForPrecon } from '../../tools/live-journey-routes';

const scd = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed',
  variant: 'commander',
  availability: {
    browse: 'available',
    draft: 'unavailable',
    sealed: 'unavailable',
    play: { status: 'supported', reason: 'Admitted.' },
  },
  formatUrl: 'formats/scd/scd-constructed-format-v1.json',
  catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
} as PrintedFormatRow;

const momirBasic = {
  id: 'momir-basic',
  name: 'Momir Basic',
  kind: 'constructed',
  variant: 'momir',
  availability: {
    browse: 'available',
    draft: 'unavailable',
    sealed: 'unavailable',
    play: { status: 'supported', reason: 'Admitted.' },
  },
  formatUrl: 'formats/momir-basic/momir-basic-constructed-format-v1.json',
  catalogs: [{ code: 'MB', url: 'formats/momir-basic/momir-basic-printed-catalog-v1.json' }],
} as PrintedFormatRow;

const staged: StagedSources = {
  kernel: [{ stem: 'xmp', name: 'the flagship set', origin: 'custom' }],
  printed: [scd, momirBasic],
  cube: false,
};

describe('the live journey opens shipped decks where Play lists them', () => {
  it('names the one section whose sources carry a commander-variant printed constructed format', () => {
    const listing = UI_SUBS.play.filter((section) =>
      playSources(section, staged).some(
        (source) => source.kind === 'printed' && source.stem === 'printed:scd',
      ),
    );
    expect(listing).toEqual([sectionForPrecon('commander')]);
  });

  it('names the one section whose sources carry a momir-variant printed constructed format', () => {
    const listing = UI_SUBS.play.filter((section) =>
      playSources(section, staged).some(
        (source) => source.kind === 'printed' && source.stem === 'printed:momir-basic',
      ),
    );
    expect(listing).toEqual([sectionForPrecon('momir')]);
  });

  it('builds a commander hash the router parses back to that section and source', () => {
    const hash = playHash(sectionForPrecon('commander'), { source: 'printed:scd' });
    expect(hash).toBe('#/play/commander?source=printed%3Ascd');
    expect(parseHash(hash)).toEqual({ mode: 'play', sub: 'commander', params: { source: 'printed:scd' } });
  });

  it('builds a momir hash the router parses back to the momir section and source', () => {
    const hash = playHash(sectionForPrecon('momir'), { source: 'printed:momir-basic' });
    expect(hash).toBe('#/play/momir?source=printed%3Amomir-basic');
    expect(parseHash(hash)).toEqual({
      mode: 'play',
      sub: 'momir',
      params: { source: 'printed:momir-basic' },
    });
  });
});

describe("the journey's face-flip finder", () => {
  const finder = new RegExp(FACE_FLIP_LABEL_SOURCE);

  it('matches the flip button a double-faced card draws', () => {
    expect(finder.test(faceFlipLabel('Back', 'Delver of Secrets'))).toBe(true);
  });

  it('does not match a tile for a card whose name starts with Show', () => {
    expect(finder.test('Show of Valor. Mana cost {1}{W}. Instant.')).toBe(false);
  });
});
