import { describe, expect, it } from 'vitest';
import {
  BASIC_LAND_TYPES,
  BASIC_LANDS,
  basicLand,
  cardFingerprint,
  canonicalJson,
  EXAMPLE_CARDS,
  EXAMPLE_SET,
  mechanicalFingerprint,
  parseCard,
  parseCardJson,
  parseCards,
  parseCardsDocumentJson,
  parseCardsJson,
  serializeCard,
  serializeCards,
  validateCardRecord,
  validateCards,
  validateSetUniqueness,
  withRenderedOracleText,
} from '@mtg/dsl';
import type { Ability, Card } from '@mtg/dsl';

describe('example library', () => {
  it('ships generator fixtures for every color, slice rarity and card kind', () => {
    expect(EXAMPLE_CARDS.length).toBe(17);
    expect(BASIC_LANDS.length).toBe(5);
    expect(new Set(EXAMPLE_SET.map((c) => c.kind))).toEqual(
      new Set(['creature', 'instant', 'sorcery', 'artifact', 'land']),
    );
    expect(new Set(EXAMPLE_CARDS.map((c) => c.rarity))).toEqual(new Set(['common', 'uncommon', 'rare']));
    expect(parseCard({ ...EXAMPLE_CARDS[0], id: 'mythic-example', rarity: 'mythic' }).rarity).toBe('mythic');
    const colors = new Set(EXAMPLE_CARDS.flatMap((c) => c.colors));
    expect(colors).toEqual(new Set(['W', 'U', 'B', 'R', 'G']));
  });

  it('covers every keyword and every effect primitive', () => {
    const keywords = new Set(EXAMPLE_SET.flatMap((c) => c.keywords));
    expect([...keywords].sort()).toEqual(
      [
        'deathtouch',
        'firstStrike',
        'flying',
        'haste',
        'lifelink',
        'menace',
        'reach',
        'trample',
        'vigilance',
      ].sort(),
    );
    const effects = new Set(EXAMPLE_SET.flatMap((c) => c.effects.map((e) => e.kind)));
    expect([...effects].sort()).toEqual(
      [
        'counterSpell',
        'createToken',
        'dealDamage',
        'destroyPermanent',
        'drawCards',
        'gainLife',
        'millCards',
        'pumpUntilEndOfTurn',
        'putCounters',
        'returnToHand',
        'tapPermanent',
      ].sort(),
    );
  });

  it('validates clean with no violations', () => {
    for (const card of EXAMPLE_SET) {
      expect(validateCardRecord(card), card.id).toEqual([]);
    }
    expect(validateCards(EXAMPLE_SET)).toEqual([]);
    expect(validateSetUniqueness(EXAMPLE_SET)).toEqual([]);
  });
});

describe('round trip', () => {
  it('parse -> serialize -> parse is lossless for every fixture', () => {
    for (const card of EXAMPLE_SET) {
      const json = serializeCard(card);
      const restored = parseCardJson(json);
      expect(restored, card.id).toEqual(card);
      expect(serializeCard(restored), card.id).toBe(json);
    }
  });

  it('round-trips cards carrying a cached oracleText', () => {
    for (const card of EXAMPLE_SET) {
      const cached: Card = withRenderedOracleText(card);
      expect(validateCardRecord(cached), card.id).toEqual([]);
      const restored = parseCardJson(serializeCard(cached));
      expect(restored.oracleText).toBe(cached.oracleText);
      expect(restored).toEqual(cached);
    }
  });

  it('round-trips the whole set as one document', () => {
    const json = serializeCards(EXAMPLE_SET);
    expect(parseCardsJson(json)).toEqual(EXAMPLE_SET);
  });

  it('serializes key-order independently', () => {
    const first = EXAMPLE_CARDS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const shuffled = Object.fromEntries(Object.entries(first).reverse());
    expect(canonicalJson(shuffled)).toBe(canonicalJson(first));
    expect(serializeCard(parseCard(shuffled))).toBe(serializeCard(first));
  });

  it('rejects a non-array document for parseCardsJson', () => {
    expect(() => parseCardsJson('{"kind":"instant"}')).toThrow(/expected a JSON array/);
  });

  it('reads both spellings of a card list on disk', () => {
    // A bare array is what serializeCards writes. A set document is what
    // @mtg/setgen writes to every set.json, and two export commands used to
    // refuse it.
    const bare = serializeCards(EXAMPLE_SET);
    const document = JSON.stringify({
      formatVersion: 1,
      set: { code: 'XMP', name: 'Fixture' },
      cards: JSON.parse(bare) as unknown,
    });
    expect(parseCardsDocumentJson(bare)).toEqual(EXAMPLE_SET);
    expect(parseCardsDocumentJson(document)).toEqual(EXAMPLE_SET);
  });

  it('refuses a document that is neither spelling, and says which it was', () => {
    expect(() => parseCardsDocumentJson('{"notCards":[]}')).toThrow(/a set document with a "cards" array/);
    expect(() => parseCardsDocumentJson('{"cards":"nope"}')).toThrow(/"cards" is string, not an array/);
    expect(() => parseCardsDocumentJson('"a string"')).toThrow(/expected a JSON array of cards/);
  });

  it('parseCards preserves order and count', () => {
    const inputs = EXAMPLE_CARDS.map((card) => JSON.parse(serializeCard(card)) as unknown);
    expect(parseCards(inputs).map((c) => c.id)).toEqual(EXAMPLE_CARDS.map((c) => c.id));
  });
});

describe('fingerprints', () => {
  it('are stable across serialization and independent of printing metadata', () => {
    for (const card of EXAMPLE_SET) {
      const reprint: Card = {
        ...card,
        id: `${card.id}-reprint`,
        set: { code: 'RPR', collectorNumber: card.set.collectorNumber + 100 },
      };
      expect(cardFingerprint(reprint), card.id).toBe(cardFingerprint(card));
      expect(cardFingerprint(parseCardJson(serializeCard(card)))).toBe(cardFingerprint(card));
    }
  });

  it('distinguishes distinct fixtures', () => {
    const prints = EXAMPLE_SET.map(cardFingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('normalizes an omitted keyword-ability list and an explicit empty list', () => {
    const base = EXAMPLE_CARDS.find((card) => card.kind === 'creature');
    expect(base).toBeDefined();
    if (base === undefined) return;
    const without = { ...base } as Card & { keywordAbilities?: Card['keywordAbilities'] };
    delete without.keywordAbilities;
    const empty: Card = { ...base, keywordAbilities: [] };
    expect(cardFingerprint(empty)).toBe(cardFingerprint(without));
    expect(mechanicalFingerprint(empty)).toBe(mechanicalFingerprint(without));
  });

  it('treats a renamed card as the same mechanical card but a different print', () => {
    const original = EXAMPLE_CARDS[11];
    expect(original).toBeDefined();
    if (original === undefined) return;
    const renamed: Card = { ...original, name: 'Voltaic Whip', id: 'slc-voltaic-whip' };
    expect(mechanicalFingerprint(renamed)).toBe(mechanicalFingerprint(original));
    expect(cardFingerprint(renamed)).not.toBe(cardFingerprint(original));
  });

  /**
   * `canonicalJson` preserves array order by design, and `abilities` reaches
   * both fingerprints automatically because `normalize` is a deny list. Without
   * `sortAbilities` in that normalization, two functionally identical lords
   * whose abilities were authored in the other order would fingerprint
   * differently and walk straight past `DUPLICATE_FINGERPRINT`.
   */
  it('ignores the order two abilities were authored in', () => {
    const base = EXAMPLE_CARDS[0];
    expect(base).toBeDefined();
    if (base === undefined || base.kind !== 'creature') return;
    const lord: Ability = {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Bird',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    };
    const anthem: Ability = {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: { kind: 'grantKeyword', keyword: 'trample' },
    };
    const oneWay: Card = { ...base, abilities: [lord, anthem] };
    const other: Card = { ...base, abilities: [anthem, lord] };

    expect(cardFingerprint(other)).toBe(cardFingerprint(oneWay));
    expect(mechanicalFingerprint(other)).toBe(mechanicalFingerprint(oneWay));
    // And an ability is still part of the identity: dropping one changes it.
    expect(cardFingerprint({ ...base, abilities: [lord] })).not.toBe(cardFingerprint(oneWay));
  });

  it('flags mechanical duplicates at set level', () => {
    const original = EXAMPLE_CARDS[11];
    expect(original).toBeDefined();
    if (original === undefined) return;
    const twin: Card = {
      ...original,
      id: 'slc-voltaic-whip',
      name: 'Voltaic Whip',
      set: { code: 'SLC', collectorNumber: 99 },
    };
    const violations = validateSetUniqueness([...EXAMPLE_SET, twin]);
    expect(violations.map((v) => v.code)).toEqual(['DUPLICATE_FINGERPRINT']);
    expect(violations[0]?.message).toContain('Lightning Lash');
  });

  /**
   * `packages/data/data/reference-sets-v1.json` shows the real shape: M11
   * prints Forest at four consecutive collector positions (246-249), all
   * four sharing one Scryfall Oracle id. `buildExecutableReferenceSet`
   * (`@mtg/data`) gives each position its own card id and collector number,
   * so nothing but the mechanical fingerprint collides — the exact case
   * `validateSetUniqueness` must let through.
   */
  it('does not flag basic-land art variants from a real printing as duplicates', () => {
    const printings: Card[] = BASIC_LAND_TYPES.flatMap((type, typeIndex) => {
      const template = basicLand(type, 'M11', 0);
      return [0, 1, 2, 3].map((art) => {
        const collectorNumber = 230 + typeIndex * 4 + art;
        return { ...template, id: `m11-${collectorNumber}`, set: { code: 'M11', collectorNumber } };
      });
    });
    expect(printings).toHaveLength(20);
    expect(new Set(printings.map((card) => mechanicalFingerprint(card))).size).toBe(5);
    expect(validateSetUniqueness(printings)).toEqual([]);
  });

  /**
   * The exemption above is keyed on `basicLandType`, not on "is a land" —
   * two nonbasic lands (or any other reprinted-with-a-new-name card) are
   * still exactly the generator bug `DUPLICATE_FINGERPRINT` exists to catch.
   */
  it('still flags two nonbasic lands with identical mechanics', () => {
    const original = parseCard({
      kind: 'land',
      id: 'm13-dragonskull-summit',
      name: 'Dragonskull Summit',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 221 },
      producesMana: ['B', 'R'],
      entryReplacement: {
        kind: 'entersTappedUnlessControlsLandSubtype',
        landTypes: ['Swamp', 'Mountain'],
      },
    });
    const reprint: Card = {
      ...original,
      id: 'm13-dragonskull-summit-2',
      set: { code: 'M13', collectorNumber: 222 },
    };
    const violations = validateSetUniqueness([original, reprint]);
    expect(violations.map((v) => v.code)).toEqual(['DUPLICATE_FINGERPRINT']);
    expect(violations[0]?.message).toContain('Dragonskull Summit');
  });
});
