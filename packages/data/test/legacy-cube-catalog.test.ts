import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildLegacyCubePrintedCatalog,
  loadLegacyCubeDecisionLedger,
  loadLegacyCubePrintedCatalog,
  loadLegacyCubeProvenance,
  verifyLegacyCubePrintedCatalog,
  type LegacyCubeCatalogInputs,
} from '@mtg/data';
import type { ScryfallCard } from '@mtg/data';

const provenance = loadLegacyCubeProvenance();

function scryfallId(position: number): string {
  return `${position.toString(16).padStart(8, '0')}-0000-0000-0000-000000000001`;
}

function sourceCard(position: number): ScryfallCard {
  const identity = provenance.identities[position - 1]!;
  if (identity.correctedName === 'Hinterland Harbor') {
    return {
      id: scryfallId(position),
      oracle_id: identity.storeOracleId,
      name: identity.storeName,
      lang: 'en',
      layout: 'normal',
      cmc: 0,
      type_line: 'Land',
      color_identity: ['U', 'G'],
      produced_mana: ['U', 'G'],
      colors: [],
      keywords: [],
      reserved: false,
      digital: false,
      promo: false,
      reprint: false,
      booster: true,
      oracle_text: '{T}: Add {G} or {U}.',
      set: 'tst',
      collector_number: String(position),
      rarity: 'rare',
    };
  }
  if (identity.correctedName === 'Delver of Secrets') {
    return {
      id: scryfallId(position),
      oracle_id: identity.storeOracleId,
      name: identity.storeName,
      lang: 'en',
      layout: 'transform',
      cmc: 1,
      type_line: 'Creature — Human Wizard // Creature — Human Insect',
      color_identity: ['U'],
      keywords: ['Flying', 'Transform'],
      reserved: false,
      digital: false,
      promo: false,
      reprint: false,
      booster: true,
      card_faces: [
        {
          name: 'Delver of Secrets',
          mana_cost: '{U}',
          type_line: 'Creature — Human Wizard',
          oracle_text: 'At the beginning of your upkeep, transform Delver of Secrets.',
          power: '1',
          toughness: '1',
          colors: ['U'],
          image_uris: { normal: 'https://cards.example/delver.jpg' },
        },
        {
          name: 'Insectile Aberration',
          type_line: 'Creature — Human Insect',
          oracle_text: 'Flying',
          power: '3',
          toughness: '2',
          colors: ['U'],
          image_uris: { normal: 'https://cards.example/insect.jpg' },
        },
      ],
      set: 'tst',
      collector_number: String(position),
      rarity: 'common',
    };
  }
  return {
    id: scryfallId(position),
    oracle_id: identity.storeOracleId,
    name: identity.storeName,
    lang: 'en',
    layout: 'normal',
    cmc: 1,
    type_line: 'Instant',
    color_identity: [],
    colors: [],
    keywords: [],
    reserved: false,
    digital: false,
    promo: false,
    reprint: false,
    booster: true,
    mana_cost: '{1}',
    oracle_text: 'Test presentation.',
    set: 'tst',
    collector_number: String(position),
    rarity: 'common',
  };
}

function inputs(overrides: Partial<LegacyCubeCatalogInputs> = {}): LegacyCubeCatalogInputs {
  return {
    resolveCard: (oracleId) => {
      const position = provenance.identities.findIndex((identity) => identity.storeOracleId === oracleId) + 1;
      return position === 0 ? null : sourceCard(position);
    },
    readForgeScript: (path) => new TextEncoder().encode(`Name:${path}\n`),
    ...overrides,
  };
}

describe('official Legacy Cube printed-card artifact', () => {
  it('builds all 600 physical positions in official order with multiface and explicit art facts', () => {
    const catalog = buildLegacyCubePrintedCatalog(provenance, inputs());
    expect(buildLegacyCubePrintedCatalog(provenance, inputs())).toEqual(catalog);
    expect(catalog.cards).toHaveLength(600);
    expect(new Set(catalog.cards.map((card) => card.physicalId)).size).toBe(600);
    expect(catalog.cards.map((card) => card.position)).toEqual(
      Array.from({ length: 600 }, (_, index) => index + 1),
    );

    const delver = catalog.cards.find((card) => card.correctedName === 'Delver of Secrets');
    expect(delver?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(delver?.faces.map((face) => face.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
    expect(delver?.art).toMatchObject({
      status: 'available',
      images: [{ face: 0 }, { face: 1 }],
    });
    expect(catalog.cards.find((card) => card.correctedName === 'Hinterland Harbor')?.producedMana).toEqual([
      'U',
      'G',
    ]);

    const giver = catalog.cards[0]!;
    expect(giver.art).toEqual({
      status: 'missing',
      source: 'scryfall',
      scryfallId: giver.scryfallId,
      reason: 'the pinned Scryfall row carries no image_uris',
    });
    expect(giver.forgeScriptSha256).toBe(
      createHash('sha256').update(`Name:${giver.forgeScript}\n`).digest('hex'),
    );
    verifyLegacyCubePrintedCatalog(catalog, provenance);
  });

  it('loads the checksum-pinned real 600-position artifact', () => {
    const catalog = loadLegacyCubePrintedCatalog();
    const ledger = loadLegacyCubeDecisionLedger();
    expect(catalog.cards).toHaveLength(600);
    expect(catalog.cards.find((card) => card.correctedName === 'Hinterland Harbor')?.producedMana).toEqual([
      'U',
      'G',
    ]);
    expect(catalog.cards.filter((card) => card.faces.length > 1)).toHaveLength(23);
    expect(catalog.cards.every((card) => card.art.status === 'available')).toBe(true);
    expect(catalog.cards.map((card) => [card.position, card.forgeScript, card.forgeScriptSha256])).toEqual(
      ledger.auditedCards
        .filter((card) => card.corpus === 'official-full-cardlist')
        .map((card) => [card.position, card.forgeScript, card.forgeScriptSha256]),
    );
  });

  it('fails closed on unresolved or drifting store and Forge identities', () => {
    expect(() => buildLegacyCubePrintedCatalog(provenance, inputs({ resolveCard: () => null }))).toThrow(
      /missing pinned Scryfall row.*Giver of Runes/,
    );
    expect(() =>
      buildLegacyCubePrintedCatalog(
        provenance,
        inputs({
          resolveCard: (oracleId) => {
            const card = inputs().resolveCard(oracleId);
            return card === null ? null : { ...card, oracle_id: scryfallId(999) };
          },
        }),
      ),
    ).toThrow(/Oracle identity drift.*Giver of Runes/);
    expect(() => buildLegacyCubePrintedCatalog(provenance, inputs({ readForgeScript: () => null }))).toThrow(
      /missing Forge script.*Giver of Runes/,
    );
  });

  it('rejects deletion, duplication, identity drift, malformed presentation, and checksum mutation', () => {
    const catalog = buildLegacyCubePrintedCatalog(provenance, inputs());
    expect(() =>
      verifyLegacyCubePrintedCatalog({ ...catalog, cards: catalog.cards.slice(1) }, provenance),
    ).toThrow();
    expect(() =>
      verifyLegacyCubePrintedCatalog(
        { ...catalog, cards: [catalog.cards[0]!, ...catalog.cards.slice(0, -1)] },
        provenance,
      ),
    ).toThrow();
    expect(() =>
      verifyLegacyCubePrintedCatalog(
        {
          ...catalog,
          cards: [{ ...catalog.cards[0]!, oracleId: catalog.cards[1]!.oracleId }, ...catalog.cards.slice(1)],
        },
        provenance,
      ),
    ).toThrow(/identity drift/);
    expect(() =>
      verifyLegacyCubePrintedCatalog(
        {
          ...catalog,
          cards: [{ ...catalog.cards[0]!, faces: [] }, ...catalog.cards.slice(1)],
        },
        provenance,
      ),
    ).toThrow();
    expect(() =>
      verifyLegacyCubePrintedCatalog({ ...catalog, contentSha256: 'f'.repeat(64) }, provenance),
    ).toThrow(/checksum drift/);
  });
});
