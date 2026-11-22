/** Pinned official printings for tokens created by observed Legacy Cube games. */
import type { PrintedCardPresentation } from './printed-card-art';

/*
 * Provenance: M13 token collector position 6 and its identities come from the
 * repository's pinned packages/data/data/reference-sets-v1.json. The image is
 * Scryfall's illustration crop for that exact identity, observed 2026-09-10.
 * `observedNames` records Forge 2.0.14's exact projected object name. This is
 * presentation data only: it neither admits a card nor claims a Forge script.
 */
export const OFFICIAL_TOKEN_PRINTINGS: readonly PrintedCardPresentation[] = [
  {
    physicalId: 'm13-token:0006:0e67efea-8a80-42ec-8e77-07d387d933d4',
    position: 6,
    name: 'Goblin',
    observedNames: ['Goblin Token'],
    oracleId: '4465eff4-5851-4721-a248-866c686c2ab8',
    scryfallId: '0e67efea-8a80-42ec-8e77-07d387d933d4',
    typeLine: 'Token Creature — Goblin',
    power: '1',
    toughness: '1',
    loyalty: null,
    colors: ['R'],
    faces: [
      {
        name: 'Goblin',
        manaCost: null,
        typeLine: 'Token Creature — Goblin',
        oracleText: null,
        power: '1',
        toughness: '1',
        loyalty: null,
        colors: ['R'],
      },
    ],
    art: {
      status: 'available',
      source: 'scryfall',
      scryfallId: '0e67efea-8a80-42ec-8e77-07d387d933d4',
      images: [
        {
          face: null,
          uris: {
            art_crop: 'https://cards.scryfall.io/art_crop/front/0/e/0e67efea-8a80-42ec-8e77-07d387d933d4.jpg',
          },
        },
      ],
    },
  },
];
