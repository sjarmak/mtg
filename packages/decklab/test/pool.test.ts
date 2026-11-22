/**
 * The two pool sources, and the criteria each one refuses.
 *
 * The refusals are the half worth testing hardest. A pool that quietly ignores
 * a criterion it cannot enforce does not fail — it produces a deck, a report,
 * and a line saying the deck was held to something nothing checked. So every
 * refusal here asserts the error class by name rather than "it threw": the
 * message is what tells somebody which flag to drop.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DeckCriteriaSchema } from '../src/criteria';
import {
  candidateFromDslCard,
  ConflictingReprintError,
  DuplicateSetCardError,
  DuplicateSetCardIdError,
  FormatlessStoreBuildError,
  FormatOverSetPoolError,
  setDeckPool,
  SetsOverStorePoolError,
  storeDeckPool,
  UnpricedPoolError,
} from '../src/pool';
import { createFakeStore, SAMPLE_CARDS } from './support/fake-store';

const SET_CODE = 'XMP';

type ManaCost = Readonly<Record<string, number>>;

function creature(id: string, name: string, cost: ManaCost): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 1 },
    manaCost: cost,
    colors: Object.keys(cost).filter((key) => key !== 'generic'),
    subtypes: ['Soldier'],
    power: 2,
    toughness: 2,
  } as CardInput);
}

const WHITE = creature('xmp-guard', 'Kingdom Guard', { generic: 1, W: 1 });
const BLUE = creature('xmp-adept', 'Tide Adept', { generic: 1, U: 1 });
const EXPENSIVE = creature('xmp-colossus', 'Slumbering Colossus', { generic: 6, W: 1 });

const PLAINS = parseCard({
  kind: 'land',
  id: 'xmp-plains',
  name: 'Plains',
  rarity: 'common',
  set: { code: SET_CODE, collectorNumber: 250 },
  supertypes: ['basic'],
  basicLandType: 'Plains',
  producesMana: ['W'],
} satisfies CardInput);

const SET = { code: SET_CODE, name: 'the flagship set', cards: [WHITE, BLUE, EXPENSIVE, PLAINS] };

function criteria(overrides: Record<string, unknown> = {}) {
  return DeckCriteriaSchema.parse({
    prompt: 'a fast white deck',
    sets: [SET_CODE],
    colors: ['W'],
    size: 60,
    ...overrides,
  });
}

describe('setDeckPool', () => {
  it('keeps the cards inside the stated colors and drops the rest', () => {
    const pool = setDeckPool([SET], criteria());

    expect(pool.universe.cards.map((card) => card.name)).toStrictEqual([
      'Kingdom Guard',
      'Slumbering Colossus',
    ]);
  });

  it('drops basic lands, because the mana base is computed rather than chosen', () => {
    // A Plains in the pool would let the model spend a spell slot on one, and
    // then the apportioned basics would arrive on top of it.
    const pool = setDeckPool([SET], criteria());

    expect(pool.universe.cards.map((card) => card.name)).not.toContain('Plains');
  });

  it('applies the mana-value ceiling the store applies in SQL', () => {
    const pool = setDeckPool([SET], criteria({ maxManaValue: 3 }));

    expect(pool.universe.cards.map((card) => card.name)).toStrictEqual(['Kingdom Guard']);
    expect(pool.universe.filters).toContain('mana value <= 3');
  });

  it('carries the DSL card behind each candidate, so the deck can be dealt a game', () => {
    // The whole reason this source exists: a store deck is real printings the
    // kernel cannot run, and this map is what makes the difference reachable.
    const pool = setDeckPool([SET], criteria());

    expect(pool.playable?.get('xmp-guard')).toBe(WHITE);
  });

  it('is its own world, so every name outside it is one failure rather than two', () => {
    // Over the store a missing name splits into "invented" and "excluded". Here
    // there is no larger world to be real in, so knownNames is the pool itself.
    const pool = setDeckPool([SET], criteria());

    expect([...pool.knownNames].sort()).toStrictEqual(['kingdom guard', 'slumbering colossus']);
  });

  it('names the sets it drew from, so the report can say where the cards came from', () => {
    expect(setDeckPool([SET], criteria()).universe.filters[0]).toBe('printed in the flagship set (XMP)');
  });

  it('refuses a format, which a generated set is neither legal nor illegal in', () => {
    expect(() => setDeckPool([SET], criteria({ sets: undefined, format: 'modern' }))).toThrow(
      FormatOverSetPoolError,
    );
  });

  it('refuses a dollar budget over cards that were never printed', () => {
    // Ignoring it would tell the model every card in the pool is already under
    // the ceiling, which is a false statement rather than a lenient one.
    expect(() => setDeckPool([SET], criteria({ budget: { maxCardUsd: 5 } }))).toThrow(UnpricedPoolError);
  });

  it('refuses two cards sharing one name, which a copy count cannot tell apart', () => {
    const twin = creature('xmp-guard-2', 'Kingdom Guard', { generic: 2, W: 1 });

    expect(() => setDeckPool([{ ...SET, cards: [WHITE, twin] }], criteria())).toThrow(DuplicateSetCardError);
  });

  it('refuses two cards sharing one name inside one set even when they are the same card', () => {
    // The cross-set rule below does not reach here on purpose: within one set,
    // the same card twice is the generator emitting it twice, which is what its
    // own dedup gate exists to catch. Collapsing it here would hide it.
    const same = { ...WHITE, id: 'xmp-guard-2' } as Card;

    expect(() => setDeckPool([{ ...SET, cards: [WHITE, same] }], criteria())).toThrow(DuplicateSetCardError);
  });

  it('refuses two cards sharing one id, which a copy limit and a dealt card both key on', () => {
    const collision = creature('xmp-guard', 'Kingdom Herald', { generic: 1, W: 1 });

    expect(() => setDeckPool([{ ...SET, cards: [WHITE, collision] }], criteria())).toThrow(
      DuplicateSetCardIdError,
    );
  });

  it('takes a reprint across two sets as one card, because real sets reprint', () => {
    // `mtg-1urk`. Pacifism is printed in both the reduced M11 and the reduced
    // M13, and refusing that refused every multi-reference-set pool the picker
    // offers: 43 of the four staged sets' names are printed in more than one.
    const pool = setDeckPool([SET, reprintOf(WHITE, 'M13', 'm13-guard')], criteria());

    expect(pool.universe.cards.filter((card) => card.name === 'Kingdom Guard')).toHaveLength(1);
    expect(pool.universe.cards.map((card) => card.name)).toStrictEqual([
      'Kingdom Guard',
      'Slumbering Colossus',
    ]);
  });

  it("deals the first set's printing of a reprint, and says how many it collapsed", () => {
    const pool = setDeckPool([SET, reprintOf(WHITE, 'M13', 'm13-guard')], criteria());

    expect(pool.playable?.get('xmp-guard')).toBe(WHITE);
    expect(pool.playable?.has('m13-guard')).toBe(false);
    expect(pool.universe.filters).toContain(
      '1 card is printed in more than one of these sets and is listed once: a reprint is one card',
    );
  });

  it('refuses two sets printing different cards under one name, which no copy count can tell apart', () => {
    // The half of the old rule that was right. A reprint is one card; two
    // different cards under one name are two, and the repair is to leave a set
    // out, so the message names both.
    const different = creature('m13-guard', 'Kingdom Guard', { generic: 3, W: 1 });

    expect(() =>
      setDeckPool([SET, { code: 'M13', name: 'Magic 2013', cards: [different] }], criteria()),
    ).toThrow(ConflictingReprintError);
    expect(() =>
      setDeckPool([SET, { code: 'M13', name: 'Magic 2013', cards: [different] }], criteria()),
    ).toThrow(/XMP and M13 both print Kingdom Guard/);
  });

  it('counts a reprint before the color filter, so a refusal does not depend on this build', () => {
    // The blue card is outside the stated colors and never reaches the universe;
    // a second set printing a different card under its name is still a fact
    // about the staged sets and still refused.
    const different = creature('m13-adept', 'Tide Adept', { generic: 4, U: 1 });

    expect(() =>
      setDeckPool([SET, { code: 'M13', name: 'Magic 2013', cards: [different] }], criteria()),
    ).toThrow(ConflictingReprintError);
  });

  it('lets every staged set print its own basics, which are not one card by name', () => {
    // Four Plains under four ids is what a real set prints, and each staged set
    // prints its own five. The name rule was never about them.
    const m13Plains = { ...PLAINS, id: 'm13-plains', set: { code: 'M13', collectorNumber: 230 } } as Card;

    const pool = setDeckPool([SET, { code: 'M13', name: 'Magic 2013', cards: [m13Plains] }], criteria());

    expect(pool.playable?.get('xmp-plains')).toBe(PLAINS);
    expect(pool.playable?.get('m13-plains')).toBe(m13Plains);
  });
});

/** The same printed card in another set: a new id and a new set, nothing else. */
function reprintOf(card: Card, setCode: string, id: string): { code: string; name: string; cards: Card[] } {
  const reprint = { ...card, id, set: { code: setCode, collectorNumber: 42 } } as Card;
  return { code: setCode, name: `Magic ${setCode}`, cards: [reprint] };
}

describe('storeDeckPool', () => {
  it('refuses a build that states no format, which would pool every card ever printed', () => {
    const store = createFakeStore(SAMPLE_CARDS);
    try {
      expect(() => storeDeckPool(store, criteria())).toThrow(FormatlessStoreBuildError);
    } finally {
      store.db.close();
    }
  });

  it('refuses staged sets, which the card store is not made of', () => {
    const store = createFakeStore(SAMPLE_CARDS);
    try {
      expect(() => storeDeckPool(store, criteria({ format: 'modern' }))).toThrow(SetsOverStorePoolError);
    } finally {
      store.db.close();
    }
  });
});

describe('candidateFromDslCard', () => {
  it('gives a land the color it taps for rather than the colorless cost it prints', () => {
    // Rule 903.5d, and the reason it is tested in both packages that read it:
    // a generated Plains has to be white to a white deck's mana base the way
    // the printed one is.
    expect(candidateFromDslCard(PLAINS)).toMatchObject({
      manaCost: null,
      manaValue: 0,
      colorIdentity: 'W',
      producedMana: ['W'],
      priceUsd: null,
    });
  });
});
