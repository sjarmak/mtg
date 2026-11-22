import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { artResolver } from '../../src/lab/art-manifest';
import {
  printedReferenceManifest,
  scryfallCardImageUrl,
  type ReferencePrintingCorpus,
} from '../../tools/reference-card-images';

const SCRYFALL_ID = '2d911053-a026-4b20-ba2d-dbcc367c1413';
const example: DslCard = (() => {
  const card = EXAMPLE_CARDS[0];
  if (card === undefined) throw new Error('the DSL example-card fixture is empty');
  return card;
})();

function reducedSet(): string {
  return JSON.stringify({
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'M11', name: 'Magic 2011 (reduced)', reduced: true },
    cards: [{ ...example, id: 'm11-1', set: { code: 'M11', collectorNumber: 1 } }],
  });
}

const CORPUS: ReferencePrintingCorpus = {
  sets: [
    {
      code: 'M11',
      cards: [
        {
          name: 'Ajani Goldmane',
          number: '1',
          layout: 'normal',
          otherFaceIds: [],
          identifiers: { scryfallId: SCRYFALL_ID },
        },
      ],
    },
  ],
};

describe('authentic reference-card illustrations', () => {
  it('joins a reduced DSL position to its pinned printing identity, never its name', () => {
    const manifest = printedReferenceManifest(reducedSet(), CORPUS);

    expect(manifest).toEqual({
      formatVersion: 2,
      art: {
        'm11-1': [
          {
            href: scryfallCardImageUrl(SCRYFALL_ID),
            alt: 'Ajani Goldmane illustration, M11 #1',
          },
        ],
      },
    });
  });

  it('returns null for generated documents and refuses an unmatched printed position', () => {
    expect(
      printedReferenceManifest(
        JSON.stringify({ set: { code: 'XMP', name: 'Generated' }, cards: [example] }),
        CORPUS,
      ),
    ).toBeNull();

    expect(() =>
      printedReferenceManifest(reducedSet().replace('"collectorNumber":1', '"collectorNumber":404'), CORPUS),
    ).toThrow(/M11 collector position 404 has no pinned Scryfall identity/u);
  });

  it('feeds reference and generated art through the same illustration-only contract', () => {
    const manifest = printedReferenceManifest(reducedSet(), CORPUS);
    if (manifest === null) throw new Error('expected a printed manifest');
    const printed = artResolver(manifest)(manifestCard());
    const generated = artResolver(manifest)(manifestCard());

    expect(printed).toEqual({
      src: scryfallCardImageUrl(SCRYFALL_ID),
      alt: 'Ajani Goldmane illustration, M11 #1',
    });
    expect(generated).toEqual({
      src: scryfallCardImageUrl(SCRYFALL_ID),
      alt: 'Ajani Goldmane illustration, M11 #1',
    });
    expect(scryfallCardImageUrl(SCRYFALL_ID)).toContain('version=art_crop');
    expect(scryfallCardImageUrl(SCRYFALL_ID)).not.toContain('version=normal');
  });
});

function manifestCard(): DslCard {
  return { ...example, id: 'm11-1' };
}
