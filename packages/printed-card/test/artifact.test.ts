import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';

const SHA = '0'.repeat(64);
const UUID = '00000000-0000-0000-0000-000000000001';

const VALID = {
  schemaVersion: 1,
  kind: 'printed-card-catalog',
  format: 'legacy-cube-2021-08',
  source: {
    provenanceArtifact: 'legacy-cube-2021-v1.json',
    provenanceSha256: SHA,
    scryfallProvider: 'Scryfall oracle_cards',
    scryfallBulkFile: 'oracle_cards.jsonl.gz',
    scryfallBulkSha256: SHA,
    scryfallBulkUpdatedAt: '2026-08-09T09:02:38.172+00:00',
  },
  forgeVersion: '2.0.14',
  cards: [
    {
      physicalId: `legacy-cube-2021-08:0001:${UUID}`,
      position: 1,
      sourceName: 'Front',
      correctedName: 'Front',
      name: 'Front // Back',
      oracleId: '00000000-0000-0000-0000-000000000002',
      scryfallId: UUID,
      forgeScript: 'f/front_back.txt',
      forgeScriptSha256: SHA,
      layout: 'transform',
      manaCost: null,
      manaValue: 2,
      typeLine: 'Creature — Human // Creature — Insect',
      oracleText: null,
      power: null,
      toughness: null,
      loyalty: null,
      colors: ['U'],
      colorIdentity: ['U'],
      producedMana: ['U', 'G'],
      faces: [
        {
          name: 'Front',
          manaCost: '{1}{U}',
          typeLine: 'Creature — Human',
          oracleText: 'At the beginning of your upkeep, transform Front.',
          power: '1',
          toughness: '1',
          loyalty: null,
          colors: ['U'],
        },
        {
          name: 'Back',
          manaCost: null,
          typeLine: 'Creature — Insect',
          oracleText: 'Flying',
          power: '3',
          toughness: '2',
          loyalty: null,
          colors: ['U'],
        },
      ],
      art: {
        status: 'available',
        source: 'scryfall',
        scryfallId: UUID,
        images: [
          { face: 0, uris: { normal: 'https://cards.example/front.jpg' } },
          { face: 1, uris: { normal: 'https://cards.example/backDecker.jpg' } },
        ],
      },
    },
  ],
  contentSha256: SHA,
} as const;

describe('portable printed-card catalogs', () => {
  it('round-trips multiface identity and explicit per-face art without Node or data types', () => {
    const parsed = parsePrintedCardCatalog(VALID);
    expect(parsed.cards[0]?.physicalId).toContain(parsed.cards[0]?.scryfallId);
    expect(parsed.cards[0]?.faces.map((face) => face.name)).toEqual(['Front', 'Back']);
    expect(parsed.cards[0]?.art).toEqual(VALID.cards[0]?.art);
    expect(parsed.cards[0]?.producedMana).toEqual(['U', 'G']);
  });

  it('rejects a missing face, an implicit art state, and malformed identity/checksum fields', () => {
    expect(() =>
      parsePrintedCardCatalog({
        ...VALID,
        cards: [{ ...VALID.cards[0], faces: [] }],
      }),
    ).toThrow();
    const { art: _art, ...withoutArt } = VALID.cards[0]!;
    expect(() => parsePrintedCardCatalog({ ...VALID, cards: [withoutArt] })).toThrow();
    expect(() =>
      parsePrintedCardCatalog({
        ...VALID,
        cards: [{ ...VALID.cards[0], oracleId: 'not-an-id' }],
      }),
    ).toThrow();
    expect(() => parsePrintedCardCatalog({ ...VALID, contentSha256: 'short' })).toThrow();
    expect(() =>
      parsePrintedCardCatalog({
        ...VALID,
        cards: [{ ...VALID.cards[0], producedMana: ['G', 'U'] }],
      }),
    ).toThrow(/WUBRGC order/);
  });
});
