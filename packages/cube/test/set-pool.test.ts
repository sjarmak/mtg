/**
 * A cube cut from a generated set rather than from the card store.
 *
 * The pool is the only thing that changes: `assembleCube`, `verifyCubeProposals`
 * and `validateCube` are handed a `CubePool` and never learn where it came
 * from, and the last block here is the assertion that this is true rather than
 * intended — the same loop, over the same criteria, filling a cube out of DSL
 * cards that have no legality, no price and no printing rows.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Color } from '@mtg/dsl';
import { COLORS, parseCard } from '@mtg/dsl';
import { assembleCube } from '../src/construct';
import type { CubeCriteriaInput } from '../src/criteria';
import { CubeCriteriaSchema } from '../src/criteria';
import type { CubeProposal } from '../src/propose';
import { verifyCubeProposals } from '../src/propose';
import {
  candidateFromDslCard,
  DuplicateSetCardError,
  setCubePool,
  UnpriceableCubePoolError,
} from '../src/set-pool';
import { scriptedProvider } from './support/scripted-provider';

const SET_CODE = 'TGR';

const COLOR_WORD: Readonly<Record<Color, string>> = {
  W: 'Dawn',
  U: 'Tide',
  B: 'Ash',
  R: 'Ember',
  G: 'Bramble',
};

/** Ten creatures in each color, which is a set a 50-card cube can be cut from. */
function generatedCards(): readonly Card[] {
  return COLORS.flatMap((color, colorIndex) =>
    Array.from({ length: 10 }, (_unused, index): Card => {
      const number = colorIndex * 10 + index + 1;
      return parseCard({
        kind: 'creature',
        id: `tgr-${COLOR_WORD[color].toLowerCase()}-${String(index + 1)}`,
        name: `${COLOR_WORD[color]} Warden ${String(index + 1)}`,
        rarity: 'common',
        set: { code: SET_CODE, collectorNumber: number },
        manaCost: { generic: index < 5 ? 1 : 3, [color]: 1 },
        colors: [color],
        subtypes: ['Spirit'],
        power: 2,
        toughness: 2,
      } satisfies CardInput);
    }),
  );
}

const GENERATED = { code: SET_CODE, name: 'Tideglass Reach', cards: generatedCards() };

const CRITERIA: CubeCriteriaInput = {
  prompt: 'a fifty-card cube out of one generated set',
  format: 'modern',
  size: 50,
  seats: 2,
  cardsPerSeat: 25,
  archetypes: [
    { name: 'azorius control', colors: ['W', 'U'], minPlayable: 10 },
    { name: 'rakdos aggro', colors: ['B', 'R'], minPlayable: 10 },
    { name: 'mono-green stompy', colors: ['G'], minPlayable: 10 },
  ],
};

const TAGS: Readonly<Record<string, string>> = {
  W: 'azorius control',
  U: 'azorius control',
  B: 'rakdos aggro',
  R: 'rakdos aggro',
  G: 'mono-green stompy',
};

const parsed = CubeCriteriaSchema.parse(CRITERIA);

describe('a DSL card in the shape the cube reads', () => {
  it('derives every field rather than inventing one', () => {
    const card = candidateFromDslCard(
      parseCard({
        kind: 'creature',
        id: 'tgr-glasswing-heron',
        name: 'Glasswing Heron',
        rarity: 'uncommon',
        set: { code: SET_CODE, collectorNumber: 90 },
        manaCost: { generic: 2, U: 1 },
        colors: ['U'],
        subtypes: ['Bird'],
        keywords: ['flying'],
        power: 1,
        toughness: 3,
      } satisfies CardInput),
    );

    expect(card).toMatchObject({
      oracleId: 'tgr-glasswing-heron',
      name: 'Glasswing Heron',
      manaCost: '{2}{U}',
      manaValue: 3,
      typeLine: 'Creature — Bird',
      colorIdentity: 'U',
      keywords: ['flying'],
      power: '1',
      toughness: '3',
    });
    // Never printed, so it has no price. Null rather than zero, which would
    // read as free to anything that came looking for one.
    expect(card.priceUsd).toBeNull();
    expect(card.parsedCost.fixed).toMatchObject({ generic: 2, U: 1 });
  });

  it('gives a land the color it taps for, not the colorless cost it prints', () => {
    // Rule 903.5d: the land type is the identity. A generated Mountain has to
    // be red to a red archetype the way the printed one is.
    const land = candidateFromDslCard(
      parseCard({
        kind: 'land',
        id: 'tgr-mountain',
        name: 'Mountain',
        rarity: 'common',
        set: { code: SET_CODE, collectorNumber: 91 },
        supertypes: ['basic'],
        basicLandType: 'Mountain',
        producesMana: ['R'],
      } satisfies CardInput),
    );

    expect(land).toMatchObject({
      manaCost: null,
      manaValue: 0,
      typeLine: 'Basic Land — Mountain',
      colorIdentity: 'R',
      producedMana: ['R'],
    });
  });
});

describe('the pool a generated set is', () => {
  it('is the whole set, and says so in the filters the prompt prints', () => {
    const pool = setCubePool(GENERATED, parsed);
    expect(pool.universe.cards).toHaveLength(50);
    expect(pool.universe.filters[0]).toBe('every card in Tideglass Reach (TGR)');
    expect(pool.universe.filters.join(' ')).toContain('no format legality and no price applies');
  });

  it('collapses the gate two answers into the one that can be true here', () => {
    // Over the store the two are different failures with different fixes: a
    // card that does not exist, and a real card the restrictions exclude. A
    // generated set is the only world there is, so `knownNames` is the set's own
    // list and the second answer can never fire.
    const pool = setCubePool(GENERATED, parsed);
    expect([...pool.knownNames].sort()).toStrictEqual([...pool.universe.byName.keys()].sort());

    const verified = verifyCubeProposals({
      proposals: [
        { name: 'Lightning Bolt', count: 1, archetypes: ['rakdos aggro'], reason: 'real, elsewhere' },
      ],
      pool,
      criteria: parsed,
      accepted: [],
      room: 50,
    });
    expect(verified.rejections).toHaveLength(1);
    expect(verified.rejections[0]?.code).toBe('unknown-card');
    // And what it says has to be true here. Lightning Bolt is a card in the
    // store; this pool is not the store. The one answer this path can give must
    // speak for the cards the cube was built from and never for the store,
    // which a `--set` cube never opened.
    expect(verified.rejections[0]?.detail).toContain('Lightning Bolt');
    expect(verified.rejections[0]?.detail).not.toContain('store');
  });

  it('refuses a price ceiling instead of quietly not applying one', () => {
    // The prompt would go on to tell the model every card in the pool is under
    // the ceiling, which is a false statement about cards that have no price.
    expect(() => setCubePool(GENERATED, CubeCriteriaSchema.parse({ ...CRITERIA, maxCardUsd: 5 }))).toThrow(
      UnpriceableCubePoolError,
    );
  });

  it('refuses a set that names one card twice, which a cube cannot draft', () => {
    const twice = { ...GENERATED, cards: [...GENERATED.cards, GENERATED.cards[0] as Card] };
    expect(() => setCubePool(twice, parsed)).toThrow(DuplicateSetCardError);
  });
});

describe('the construction loop over that pool', () => {
  it('fills and measures a cube the same way it does over the store', async () => {
    const pool = setCubePool(GENERATED, parsed);
    const answer: CubeProposal = {
      plan: 'the whole set, split by color',
      cards: pool.universe.cards.map((card) => ({
        name: card.name,
        count: 1,
        archetypes: [TAGS[card.colorIdentity] ?? 'azorius control'],
        reason: 'it is in the set',
      })),
    };

    const cube = await assembleCube({ pool, provider: scriptedProvider([answer]), criteria: CRITERIA });

    expect(cube.stop).toStrictEqual({ kind: 'filled' });
    expect(cube.entries).toHaveLength(50);
    expect(cube.poolSize).toBe(50);
    expect(cube.validation.measurement.colors.map((color) => color.cards)).toStrictEqual([
      10, 10, 10, 10, 10,
    ]);
    expect(cube.validation.findings).toStrictEqual([]);
    expect(cube.validation.ok).toBe(true);
  });

  it('tells the model it is choosing from the set, not from a format', async () => {
    const pool = setCubePool(GENERATED, parsed);
    const provider = scriptedProvider([
      {
        plan: 'nothing yet',
        cards: [{ name: 'Not A Card', count: 1, archetypes: ['rakdos aggro'], reason: 'no' }],
      },
    ]);
    await assembleCube({ pool, provider, criteria: CRITERIA });

    expect(provider.prompts[0]).toContain('every card in Tideglass Reach (TGR)');
    expect(provider.prompts[0]).toContain('The pool holds 50 legal cards');
  });
});
