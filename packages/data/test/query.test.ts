import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidInputError,
  closeStore,
  deleteLabCard,
  findCardsByColorIdentity,
  findCardsByName,
  findCardsBySet,
  getCardByOracleId,
  getPrintings,
  getRulings,
  ingestBulkFile,
  normalizeColorIdentity,
  parseRaw,
  resolveCardRef,
  storeStats,
  upsertLabCard,
  type DataStore,
} from '@mtg/data';
import {
  FIXTURES,
  ORACLE_IDS,
  ORACLE_UPDATED_AT,
  RULINGS_UPDATED_AT,
  VALID_FIXTURE_CARDS,
  descriptorFor,
  memoryStore,
} from './helpers';

describe('query API', () => {
  let store: DataStore;

  beforeEach(async () => {
    store = memoryStore();
    await ingestBulkFile(store, descriptorFor('oracle_cards', ORACLE_UPDATED_AT), FIXTURES.oracleCards);
    await ingestBulkFile(store, descriptorFor('rulings', RULINGS_UPDATED_AT), FIXTURES.rulings);
    return () => closeStore(store);
  });

  it('looks a card up by oracle id', () => {
    const card = getCardByOracleId(store, ORACLE_IDS.wrathOfGod);
    expect(card?.name).toBe('Wrath of God');
    expect(card?.manaCost).toBe('{2}{W}{W}');
    expect(card?.manaValue).toBe(4);
    expect(card?.colorIdentity).toBe('W');
    expect(card?.source).toBe('scryfall');
    expect(getCardByOracleId(store, ORACLE_IDS.tarmogoyf)).toBeNull();
  });

  it('preserves the upstream record verbatim alongside the projected columns', () => {
    const card = getCardByOracleId(store, ORACLE_IDS.lightningBolt);
    expect(card).not.toBeNull();
    const raw = parseRaw(card!) as Record<string, unknown>;
    expect(raw['scryfall_uri']).toBeTypeOf('string');
    expect(raw['name']).toBe(card?.name);
  });

  it('finds cards by substring and by exact name', () => {
    expect(findCardsByName(store, 'bolt').map((card) => card.name)).toEqual(['Lightning Bolt']);
    expect(findCardsByName(store, 'lightning BOLT', { exact: true })).toHaveLength(1);
    expect(findCardsByName(store, 'Lightning', { exact: true })).toHaveLength(0);
    expect(findCardsByName(store, 'of')).not.toHaveLength(0);
    expect(() => findCardsByName(store, '   ')).toThrow(InvalidInputError);
  });

  it('treats LIKE wildcards in a name as literal characters', () => {
    expect(findCardsByName(store, '%')).toHaveLength(0);
    expect(findCardsByName(store, '_olt')).toHaveLength(0);
  });

  it('finds cards by set code, case-insensitively', () => {
    expect(findCardsBySet(store, 'msc').map((card) => card.name)).toEqual(['Lightning Bolt']);
    expect(findCardsBySet(store, 'DMR').map((card) => card.name)).toEqual(['Fire // Ice']);
    expect(findCardsBySet(store, 'ZZZ')).toHaveLength(0);
  });

  it('matches color identity exactly, as a subset, and inclusively', () => {
    expect(findCardsByColorIdentity(store, 'R').map((card) => card.name)).toEqual(['Lightning Bolt']);
    expect(findCardsByColorIdentity(store, 'ur').map((card) => card.name)).toEqual(['Fire // Ice']);

    const subsetUR = findCardsByColorIdentity(store, 'UR', { mode: 'subset' }).map((card) => card.name);
    expect(subsetUR).toContain('Fire // Ice');
    expect(subsetUR).toContain('Lightning Bolt');
    expect(subsetUR).toContain('Delver of Secrets // Insectile Aberration');
    expect(subsetUR).not.toContain('Wrath of God');
    expect(subsetUR).not.toContain('Grizzly Bears');

    const includesU = findCardsByColorIdentity(store, 'U', { mode: 'includes' }).map((card) => card.name);
    expect(includesU).toContain('Fire // Ice');
    expect(includesU).toContain('Delver of Secrets // Insectile Aberration');
    expect(includesU).not.toContain('Lightning Bolt');

    expect(findCardsByColorIdentity(store, '', { mode: 'subset' })).toHaveLength(0);
    expect(findCardsByColorIdentity(store, 'WUBRG', { mode: 'subset' })).toHaveLength(VALID_FIXTURE_CARDS);
  });

  it('rejects color letters outside WUBRG', () => {
    expect(() => findCardsByColorIdentity(store, 'WZ')).toThrow(InvalidInputError);
    expect(normalizeColorIdentity(['g', 'w'])).toBe('WG');
    expect(normalizeColorIdentity('rr')).toBe('R');
  });

  it('returns printings and rulings joined on oracle id', () => {
    const printings = getPrintings(store, ORACLE_IDS.grizzlyBears);
    expect(printings).toHaveLength(1);
    expect(printings[0]?.setCode).toBe('10E');
    expect(printings[0]?.rarity).toBe('common');

    const rulings = getRulings(store, ORACLE_IDS.fireIce);
    expect(rulings).toHaveLength(7);
    expect(rulings[0]?.rulingSource).toBe('wotc');

    // Rulings ingest independently of cards: this oracle id has no card row.
    expect(getRulings(store, ORACLE_IDS.tarmogoyf)).toHaveLength(5);
  });

  it('clamps and validates the limit', () => {
    expect(findCardsByName(store, 'e', { limit: 2 }).length).toBeLessThanOrEqual(2);
    expect(() => findCardsByName(store, 'e', { limit: 0 })).toThrow(InvalidInputError);
    expect(() => findCardsByName(store, 'e', { limit: 1.5 })).toThrow(InvalidInputError);
  });
});

describe('resolveCardRef', () => {
  let store: DataStore;

  beforeEach(async () => {
    store = memoryStore();
    await ingestBulkFile(store, descriptorFor('oracle_cards', ORACLE_UPDATED_AT), FIXTURES.oracleCards);
    return () => closeStore(store);
  });

  it('resolves an oracle id', () => {
    const resolved = resolveCardRef(store, ORACLE_IDS.lightningBolt);
    expect(resolved.kind).toBe('card');
    expect(resolved.kind === 'card' && resolved.card.name).toBe('Lightning Bolt');
  });

  it('resolves a name, case-insensitively — the thing a human types first', () => {
    for (const ref of ['Lightning Bolt', 'lightning bolt', '  Lightning Bolt  ']) {
      const resolved = resolveCardRef(store, ref);
      expect(resolved.kind === 'card' && resolved.card.oracleId).toBe(ORACLE_IDS.lightningBolt);
    }
  });

  it('resolves a substring that matches exactly one card', () => {
    const resolved = resolveCardRef(store, 'grizzly');
    expect(resolved.kind === 'card' && resolved.card.name).toBe('Grizzly Bears');
  });

  it('reports every candidate when a substring matches several cards', () => {
    const resolved = resolveCardRef(store, 'of');
    expect(resolved.kind).toBe('ambiguous');
    if (resolved.kind !== 'ambiguous') return;
    expect(resolved.candidates.map((card) => card.name).sort()).toEqual([
      'Delver of Secrets // Insectile Aberration',
      'Wrath of God',
    ]);
    expect(resolved.truncated).toBe(false);
  });

  it('reports every candidate when several cards share one name', () => {
    for (const suffix of ['a', 'b']) {
      upsertLabCard(store, {
        oracleId: `token-elemental-${suffix}`,
        name: 'Elemental',
        manaValue: 0,
        typeLine: 'Token Creature — Elemental',
      });
    }
    const resolved = resolveCardRef(store, 'Elemental');
    expect(resolved.kind).toBe('ambiguous');
    if (resolved.kind !== 'ambiguous') return;
    expect(resolved.candidates.map((card) => card.oracleId).sort()).toEqual([
      'token-elemental-a',
      'token-elemental-b',
    ]);
  });

  it('caps the candidate list and says so', () => {
    for (let index = 0; index < 12; index += 1) {
      upsertLabCard(store, {
        oracleId: `token-spirit-${index}`,
        name: 'Spirit',
        manaValue: 0,
        typeLine: 'Token Creature — Spirit',
      });
    }
    const resolved = resolveCardRef(store, 'Spirit');
    expect(resolved.kind).toBe('ambiguous');
    if (resolved.kind !== 'ambiguous') return;
    expect(resolved.candidates).toHaveLength(10);
    expect(resolved.truncated).toBe(true);
  });

  it('prefers an exact name over the substrings that contain it', () => {
    upsertLabCard(store, { oracleId: 'slc-bolt', name: 'Bolt', manaValue: 1, typeLine: 'Instant' });
    const resolved = resolveCardRef(store, 'bolt');
    expect(resolved.kind === 'card' && resolved.card.oracleId).toBe('slc-bolt');
  });

  it('resolves a lab card by its slug oracle id, which is not a UUID', () => {
    upsertLabCard(store, {
      oracleId: 'slc-ember-lash',
      name: 'Ember Lash',
      manaValue: 2,
      typeLine: 'Instant',
    });
    const resolved = resolveCardRef(store, 'slc-ember-lash');
    expect(resolved.kind === 'card' && resolved.card.name).toBe('Ember Lash');
  });

  it('finds nothing for an unknown reference, and treats LIKE wildcards literally', () => {
    expect(resolveCardRef(store, 'Jace, Wielder of Nonsense').kind).toBe('none');
    expect(resolveCardRef(store, '%').kind).toBe('none');
    expect(() => resolveCardRef(store, '   ')).toThrow(InvalidInputError);
  });
});

describe('lab cards', () => {
  it('stores generated cards in the same tables, queryable alongside real ones', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, descriptorFor('oracle_cards', ORACLE_UPDATED_AT), FIXTURES.oracleCards);

    upsertLabCard(store, {
      oracleId: 'slc-ember-lash',
      name: 'Ember Lash',
      manaCost: '{1}{R}',
      manaValue: 2,
      typeLine: 'Instant',
      oracleText: 'Ember Lash deals 3 damage to any target.',
      colors: ['R'],
      colorIdentity: ['R'],
      printing: {
        printingId: 'slc-ember-lash-p1',
        setCode: 'SLC',
        collectorNumber: '42',
        rarity: 'common',
      },
    });

    const stats = storeStats(store);
    expect(stats.oracleCards).toBe(VALID_FIXTURE_CARDS + 1);
    expect(stats.labCards).toBe(1);

    const red = findCardsByColorIdentity(store, 'R').map((card) => card.name);
    expect(red).toContain('Lightning Bolt');
    expect(red).toContain('Ember Lash');

    expect(findCardsByName(store, 'Ember', { source: 'scryfall' })).toHaveLength(0);
    expect(findCardsByName(store, 'Ember', { source: 'lab' })).toHaveLength(1);
    expect(findCardsBySet(store, 'slc').map((card) => card.name)).toEqual(['Ember Lash']);

    closeStore(store);
  });

  it('is idempotent and validates its input', () => {
    const store = memoryStore();
    const input = {
      oracleId: 'slc-stone-guard',
      name: 'Stone Guard',
      manaValue: 3,
      typeLine: 'Creature — Golem',
      power: '2',
      toughness: '4',
      keywords: ['vigilance'],
    };

    upsertLabCard(store, input);
    upsertLabCard(store, input);
    expect(storeStats(store).labCards).toBe(1);

    expect(() => upsertLabCard(store, { ...input, manaValue: -1 })).toThrow(InvalidInputError);
    expect(() => upsertLabCard(store, { ...input, colors: ['Z'] } as never)).toThrow(InvalidInputError);

    expect(deleteLabCard(store, 'slc-stone-guard')).toBe(true);
    expect(deleteLabCard(store, 'slc-stone-guard')).toBe(false);
    expect(storeStats(store).labCards).toBe(0);

    closeStore(store);
  });

  it('never deletes a Scryfall card through the lab path', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, descriptorFor('oracle_cards', ORACLE_UPDATED_AT), FIXTURES.oracleCards);

    expect(deleteLabCard(store, ORACLE_IDS.lightningBolt)).toBe(false);
    expect(getCardByOracleId(store, ORACLE_IDS.lightningBolt)).not.toBeNull();

    closeStore(store);
  });
});
