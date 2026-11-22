/**
 * A built variation, reopened against the staged pool.
 *
 * This is the claim the whole universe decision was made for: a deck the
 * workbench built can be dealt a game, because its cards are cards this kernel
 * runs. A test that only checked the deck's *contents* would pass on a deck
 * nothing could deal, so what is asserted here is the reopen — ids resolving to
 * real pool cards, and the refusal when they do not.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard, setBasics } from '@mtg/dsl';
import { deckFor } from '../../src/routes/deck/build';
import { constructedPool, withMintedBasics } from '../../src/routes/deck/constructed-pool';
import { missingNote, reopenVariation } from '../../src/routes/deck/workbench/play';
import type { Variation } from '../../src/routes/deck/workbench/client';

const SET_CODE = 'XMP';

function creature(id: string, name: string): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Soldier'],
    power: 2,
    toughness: 2,
  } satisfies CardInput);
}

const FLEDGLING = creature('xmp-skyborn-fledgling', 'Skyborn Fledgling');
const KEEPER = creature('xmp-ashen-vigil-keeper', 'Ashen Vigil-Keeper');
// Through the one function that decides what a set's basics are, so the id a
// variation recorded and the id the pool holds cannot be derived two ways.
const POOL: readonly Card[] = [FLEDGLING, KEEPER, ...setBasics([FLEDGLING, KEEPER])];

/**
 * A reference-set card, so a union pool has a second printing of every basic in
 * it and one of them comes first.
 *
 * The workbench builds out of the union of every staged set, which is the whole
 * reason `mtg-ac0h` is a bug rather than a curiosity: the reduced Magic 2011
 * prints its own basics and the flagship set prints none, so the first Plains
 * the union offers is M11's and the flagship's is minted.
 */
const M11_BEAR: Card = parseCard({
  kind: 'creature',
  id: 'm11-runeclaw-bear',
  name: 'Runeclaw Bear',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  subtypes: ['Bear'],
  power: 2,
  toughness: 2,
} satisfies CardInput);

/**
 * The pool the deck library hands this function: every staged set, its own
 * basics minted in, M11 ahead of the flagship.
 *
 * Built through `constructedPool` and `withMintedBasics` rather than by hand,
 * because half of `mtg-ac0h` was that the union the library built held no
 * `xmp-plains` at all. A fixture that listed one would test the repair against a
 * pool the page does not have.
 */
const UNION_POOL: readonly Card[] = constructedPool(
  withMintedBasics([
    { name: 'Magic 2011', cards: [M11_BEAR] },
    { name: 'the flagship set', cards: [FLEDGLING, KEEPER] },
  ]),
).cards;

function variation(overrides: Partial<Variation> = {}): Variation {
  return {
    version: 1,
    id: 'v1',
    name: 'white weenie',
    builtAt: '2026-08-31T20:00:00.000Z',
    parentId: null,
    criteria: {
      prompt: 'a fast white deck',
      sets: [SET_CODE],
      colors: ['W'],
      size: 60,
      maxCopies: 4,
      themes: [],
    },
    statedCriteria: [],
    plan: 'curve out',
    spells: [
      {
        id: FLEDGLING.id,
        name: FLEDGLING.name,
        count: 4,
        manaCost: '{1}{W}',
        manaValue: 2,
        typeLine: 'Creature',
        criteria: [],
        reason: '',
      },
      {
        id: KEEPER.id,
        name: KEEPER.name,
        count: 3,
        manaCost: '{1}{W}',
        manaValue: 2,
        typeLine: 'Creature',
        criteria: [],
        reason: '',
      },
    ],
    lands: [],
    basics: [{ color: 'W', count: 21, id: 'xmp-plains' }],
    manaBase: {
      totalLands: 21,
      nonBasicLands: 0,
      castabilityTarget: 0.9,
      heavyCastabilityTarget: 0.8,
      colors: [],
      landReason: '',
      landSource: 'model',
    },
    universeSize: 95,
    shortfalls: [],
    ...overrides,
  } as Variation;
}

describe('reopenVariation', () => {
  it('resolves every card id against the staged pool', () => {
    const reopened = reopenVariation(POOL, variation());

    expect(reopened.missing).toStrictEqual([]);
    expect(reopened.build?.counts).toStrictEqual({
      [FLEDGLING.id]: 4,
      [KEEPER.id]: 3,
    });
  });

  it('carries the basics as counts by color, which is what the mana base holds', () => {
    expect(reopenVariation(POOL, variation()).build?.basics).toStrictEqual({ W: 21 });
  });

  it('keeps a count past the builder’s own four-copy limit', () => {
    // A stated `maxCopies` of 1 makes a singleton deck and a card reading "any
    // number of cards named" is unbounded, so re-checking the deck against the
    // builder's constructed limit would silently cut cards the build was
    // verified with. This is why the counts are written rather than added one at
    // a time through `addCopy`.
    const singleton = variation({
      spells: [
        {
          id: FLEDGLING.id,
          name: FLEDGLING.name,
          count: 9,
          manaCost: '{1}{W}',
          manaValue: 2,
          typeLine: 'Creature',
          criteria: [],
          reason: '',
        },
      ],
    });

    expect(reopenVariation(POOL, singleton).build?.counts[FLEDGLING.id]).toBe(9);
  });

  it('refuses the whole deck when the staged sets no longer print one of its cards', () => {
    // `../../src/routes/deck/saved-decks.ts`'s rule, word for word: a load that dropped the missing
    // three would hand back a 57-card deck under the name of a 60-card one, and
    // the person would find out by losing a game.
    const stale = variation({
      spells: [
        {
          id: 'xmp-card-that-left',
          name: 'Card That Left',
          count: 4,
          manaCost: '{W}',
          manaValue: 1,
          typeLine: 'Creature',
          criteria: [],
          reason: '',
        },
      ],
    });

    const reopened = reopenVariation(POOL, stale);
    expect(reopened.build).toBeNull();
    expect(reopened.missing).toStrictEqual(['Card That Left']);
    expect(missingNote(reopened.missing)).toContain('Card That Left');
  });

  /**
   * `mtg-ac0h`. The variation records which Plains it plays — `xmp-plains`, the
   * id `setBasics` wrote when the deck was built — and the builder mints its
   * mana base out of whatever pool it is handed. The workbench's pool is the
   * union of every staged set, so a XMP deck came back holding M11 Plains: the
   * deck played was not the deck recorded, and every land on the board drew the
   * pending frame, because the XMP art manifest has no key for `m11-plains`.
   *
   * The repair is the one this tree already ships for exactly this job.
   * `DeckBuildConfig.set` exists because a sealed pool minted basics the set's
   * manifest had no key for (`mtg-aqxi.9`), and its rule is that a caller who
   * knows the set says so. `reopenVariation` knows: the ids are written in the
   * variation.
   */
  it('deals the printing the variation recorded, not the first one the union pool offers', () => {
    const reopened = reopenVariation(UNION_POOL, variation());
    expect(reopened.build).not.toBeNull();

    const lands = deckFor(reopened.build!).lands;
    expect(lands).toHaveLength(21);
    expect(new Set(lands.map((land) => land.id))).toStrictEqual(new Set(['xmp-plains']));
  });

  it('falls back to the pool when the recorded basic is no longer printed', () => {
    // Same rule as a missing spell, one step softer: a basic is minted rather
    // than chosen, so an id the staged sets no longer print is not a deck that
    // cannot be dealt. It is a deck whose mana base comes from the pool again,
    // which is the best answer available without the recorded printing.
    const stale = variation({ basics: [{ color: 'W', count: 21, id: 'gone-plains' }] });
    const reopened = reopenVariation(UNION_POOL, stale);

    expect(reopened.missing).toStrictEqual([]);
    expect(deckFor(reopened.build!).lands).toHaveLength(21);
  });
});
