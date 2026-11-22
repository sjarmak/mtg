/** Pinned official printings for basic lands added by the Legacy Cube builder. */
import type { Color } from '@mtg/dsl';
import type { PrintedCardPresentation } from './printed-card-art';

interface BasicLandSource {
  readonly name: string;
  readonly collectorNumber: number;
  readonly scryfallId: string;
  readonly oracleId: string;
  readonly color: Color;
  readonly artCrop: string;
}

/*
 * Provenance: M11 collector positions and identities come from the repository's
 * pinned packages/data/data/reference-sets-v1.json. Image URLs are Scryfall's
 * illustration crops for those exact identities, observed on 2026-09-07.
 * These records are presentation-only: they do not claim admission or a Forge
 * script.
 */
const SOURCES: readonly BasicLandSource[] = [
  {
    name: 'Plains',
    collectorNumber: 230,
    scryfallId: '67a2ff8c-ac4a-425e-afd0-a9010bf87c1c',
    oracleId: 'bc71ebf6-2056-41f7-be35-b2e5c34afa99',
    color: 'W',
    artCrop:
      'https://cards.scryfall.io/art_crop/front/6/7/67a2ff8c-ac4a-425e-afd0-a9010bf87c1c.jpg?1783941784',
  },
  {
    name: 'Island',
    collectorNumber: 234,
    scryfallId: '7f8d3740-40e9-40d4-833e-8f191a43ed14',
    oracleId: 'b2c6aa39-2d2a-459c-a555-fb48ba993373',
    color: 'U',
    artCrop:
      'https://cards.scryfall.io/art_crop/front/7/f/7f8d3740-40e9-40d4-833e-8f191a43ed14.jpg?1783941784',
  },
  {
    name: 'Swamp',
    collectorNumber: 238,
    scryfallId: 'a7fd3031-8284-4098-a5e6-2fdfc4362752',
    oracleId: '56719f6a-1a6c-4c0a-8d21-18f7d7350b68',
    color: 'B',
    artCrop:
      'https://cards.scryfall.io/art_crop/front/a/7/a7fd3031-8284-4098-a5e6-2fdfc4362752.jpg?1783941784',
  },
  {
    name: 'Mountain',
    collectorNumber: 242,
    scryfallId: 'dd9b48f1-7c3a-4b1f-9a00-7b75eb6ea831',
    oracleId: 'a3fb7228-e76b-4e96-a40e-20b5fed75685',
    color: 'R',
    artCrop:
      'https://cards.scryfall.io/art_crop/front/d/d/dd9b48f1-7c3a-4b1f-9a00-7b75eb6ea831.jpg?1783941782',
  },
  {
    name: 'Forest',
    collectorNumber: 246,
    scryfallId: 'e36b8794-c117-4d3d-bcde-39a3ae436f1e',
    oracleId: 'b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6',
    color: 'G',
    artCrop:
      'https://cards.scryfall.io/art_crop/front/e/3/e36b8794-c117-4d3d-bcde-39a3ae436f1e.jpg?1783941781',
  },
];

function presentation(source: BasicLandSource): PrintedCardPresentation {
  const typeLine = `Basic Land — ${source.name}`;
  return {
    physicalId: `m11:${String(source.collectorNumber).padStart(4, '0')}:${source.scryfallId}`,
    position: source.collectorNumber,
    name: source.name,
    oracleId: source.oracleId,
    scryfallId: source.scryfallId,
    typeLine,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    faces: [
      {
        name: source.name,
        manaCost: null,
        typeLine,
        oracleText: `({T}: Add {${source.color}}.)`,
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
      },
    ],
    art: {
      status: 'available',
      source: 'scryfall',
      scryfallId: source.scryfallId,
      images: [
        {
          face: null,
          uris: {
            art_crop: source.artCrop,
          },
        },
      ],
    },
  };
}

export const BASIC_LAND_PRINTINGS: readonly PrintedCardPresentation[] = SOURCES.map(presentation);
