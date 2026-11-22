// @vitest-environment node
/**
 * The black outer edge, on the DOM face.
 *
 * `mtg-d4g`. The web card's border was the color identity all the way out to
 * its silhouette, so a gallery read as a page of colored tiles: what makes a
 * spread of cards look like cards before you have read a word of one is that
 * every card has the same black edge and a different color just inside it.
 * `../src/styles/card.ts` now spends the outer 0.9 mm of the 2.6 mm band on
 * that edge: the border is the black, the padding under it is the identity,
 * and the two together are still the printed band.
 *
 * **This cannot be asserted in jsdom.** jsdom resolves no `calc()`, no `var()`
 * chain into a used value and no pseudo-element box, so the three quantities
 * that matter here — the edge's width at a given card width, its ink, and the
 * ink of the ring inside it — are all zeroes or empty strings there.
 * `./stylesheet.test.ts` can assert the declarations are in the sheet and that
 * is a different claim: a band divided the wrong way round would pass it and
 * paint a black ring inside a colored silhouette.
 *
 * **The width is a share, not a count**, which is why two card sizes are read
 * off one page: the gallery's full face and Customize's Decks section's
 * compact one differ by more than a factor of two, and a fixed pixel edge
 * would be a hairline on one and a mourning band on the other. The assertion
 * is the ratio each face actually drew, against `CARD_EDGE_MM /
 * CARD_TRIM_MM.width` computed from the
 * same constants the sheet is generated from.
 *
 * The ink is compared against a probe painted with `var(--mtg-card-edge)`
 * rather than against a literal `rgb(...)`: the token is authored in OKLCH and
 * the used value is the browser's conversion of it, so a literal here would be
 * a second copy of a color and would drift the first time the token is tuned.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../src/app/Shell';
import { CARD_EDGE_MM, CARD_TRIM_MM, FRAME_BAND_MM } from '../src/card/anatomy';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from './support/chrome';

const EDGE_SHARE = CARD_EDGE_MM / CARD_TRIM_MM.width;
const BAND_SHARE = FRAME_BAND_MM / CARD_TRIM_MM.width;

/** Four identities, so a rule keyed on one color could not pass on all of them. */
const FACES = EXAMPLE_CARDS.slice(0, 8);

function pageHtml(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      children: h(CardsRoute, {
        cards: FACES,
        route: { mode: 'cards', sub: 'gallery', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Card edge</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading per face: the two lengths the band is divided into, the ink of
 * each, and the clips that make the inner one a ring.
 *
 * The identity's ink is read off the face's own `background-image`, because
 * that is where it is painted now: the second gradient layer is the identity
 * resolved to a used color, and a build that clipped it wrong would show the
 * same string at a different place rather than a different string.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const probe = document.createElement('span');
  probe.style.color = 'var(--mtg-card-edge)';
  document.body.appendChild(probe);
  const edgeInk = getComputedStyle(probe).color;
  probe.remove();
  // The same declaration the sheet writes, computed on a probe inside the face
  // so the token resolves in that face's own cascade. Comparing two computed
  // background-image strings is serialization-agnostic: whatever color syntax
  // the browser prints, it prints the same one on both sides.
  const layerOf = (face, token) => {
    const probe = document.createElement('span');
    probe.style.backgroundImage = 'linear-gradient(var(' + token + '), var(' + token + '))';
    face.appendChild(probe);
    const drawn = getComputedStyle(probe).backgroundImage;
    probe.remove();
    return drawn;
  };
  const faces = [...document.querySelectorAll('.mtg-card')];
  if (faces.length === 0) return null;
  return {
    edgeInk,
    faces: faces.map((face) => {
      const own = getComputedStyle(face);
      return {
        width: round(face.getBoundingClientRect().width),
        size: face.getAttribute('data-size'),
        identity: face.getAttribute('data-identity'),
        edgeWidth: round(parseFloat(own.borderTopWidth)),
        edgeInkDrawn: own.borderTopColor,
        ringWidth: round(parseFloat(own.paddingTop)),
        clip: own.backgroundClip,
        layers: own.backgroundImage,
        identityLayer: layerOf(face, '--identity'),
        frameLayer: layerOf(face, '--frame'),
      };
    }),
  };
})()`;

interface Face {
  readonly width: number;
  readonly identity: string | null;
  readonly edgeWidth: number;
  readonly edgeInkDrawn: string;
  readonly ringWidth: number;
  readonly clip: string;
  readonly layers: string;
  readonly identityLayer: string;
  readonly frameLayer: string;
}

interface Reading {
  readonly edgeInk: string;
  readonly faces: readonly Face[];
}

describe('the web card at its silhouette', () => {
  browserIt(
    'wears a black edge of the printed share, on the outside of its color',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-card-edge-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-card-edge-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        const file = join(directory, 'cards.html');
        await writeFile(file, pageHtml(), 'utf8');
        const seen = (await measurePage(
          chrome.client,
          file,
          1440,
          900,
          MEASURE,
          'the card gallery at 1440x900',
          '.mtg-card',
        )) as unknown as Reading | null;
        if (seen === null) throw new Error('the gallery drew no card face');
        expect(seen.faces.length, 'the gallery drew faces to measure').toBeGreaterThan(3);
        const identities = new Set(seen.faces.map((face) => face.identity));
        expect(identities.size, 'more than one identity is on the page').toBeGreaterThan(1);

        for (const face of seen.faces) {
          const where = `${face.identity ?? 'no identity'} at ${String(face.width)}px`;

          // The ink, against the token rather than against a literal color.
          expect(face.edgeInkDrawn, `${where}: the edge is the edge ink`).toBe(seen.edgeInk);
          // And the ring inside it is not that color: a band that resolved to
          // black throughout would pass every measurement below and be a card
          // with no identity on it at all.
          expect(face.identityLayer, `${where}: the identity is a color at all`).not.toBe('none');
          expect(face.identityLayer, `${where}: the identity is not the edge ink`).not.toBe(face.frameLayer);
          expect(face.layers, `${where}: ground over identity, in that order`).toBe(
            `${face.frameLayer}, ${face.identityLayer}`,
          );
          // Ground inside the content box, identity inside the padding box: the
          // clip order is what makes the padding a ring rather than a second
          // ground behind the whole face.
          expect(face.clip, `${where}: the two grounds are clipped in that order`).toBe(
            'content-box, padding-box',
          );

          // The shares, at whatever width this face was drawn.
          expect(face.edgeWidth, `${where}: the edge is the printed share`).toBeCloseTo(
            Math.max(1, face.width * EDGE_SHARE),
            0,
          );
          expect(
            face.edgeWidth + face.ringWidth,
            `${where}: edge and ring are still the printed band`,
          ).toBeCloseTo(face.width * BAND_SHARE, 0);
          // A slice of the band rather than added to it: a face whose edge grew
          // the silhouette would move every region on the card.
          expect(face.ringWidth, `${where}: the identity keeps the larger share`).toBeGreaterThan(
            face.edgeWidth,
          );
        }
      } catch (error) {
        throw new Error(reason(error));
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120000,
  );
});
