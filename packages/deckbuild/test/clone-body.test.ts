/**
 * What entering as a copy of a creature is worth (`mtg-8w1r`).
 *
 * `entryReplacementValue` priced five of its seven arms and returned zero for
 * this one, so both cards in the reduced M11 and M13 that print the clause
 * scored as the 0/0 body they are printed as. A card whose entire text is that
 * it arrives as the best thing in play was the worst card in the pool.
 *
 * The price is the sixth site whose answer is the deck rather than the card, so
 * everything here is a pair: the same clone in two decks. `evaluate.test.ts`
 * pins the context-free half, which does not move.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Keyword } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  bodyValue,
  creatureSupply,
  deckContextOf,
  deckDraws,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  evaluateCard,
  hypergeometricAtLeast,
  readsTheDeck,
} from '../src/index';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;
const CONFIG = DEFAULT_DECK_BUILD_CONFIG;

let minted = 0;
function card(over: Record<string, unknown>): Card {
  minted += 1;
  return parseCard({
    id: `clone-${String(minted)}`,
    name: `Clone ${String(minted)}`,
    rarity: 'common',
    set: { code: 'CLN', collectorNumber: minted },
    ...over,
  } as CardInput);
}

/** A creature with a printed body and nothing else. */
function vanilla(power: number, toughness: number, over: Record<string, unknown> = {}): Card {
  return card({
    kind: 'creature',
    manaCost: { generic: 2, U: 1 },
    colors: ['U'],
    subtypes: ['Shapeshifter'],
    power,
    toughness,
    ...over,
  });
}

/** The printed shape of both reference-set clones: a 0/0 that arrives as somebody else. */
function clone(power = 0, toughness = 0): Card {
  return vanilla(power, toughness, { entryReplacement: { kind: 'entersAsCopyOfCreature' } });
}

function entryComponent(subject: Card, deck: readonly Card[] | undefined): number {
  const context = deck === undefined ? undefined : deckContextOf([...deck, subject], CONFIG);
  return (
    evaluateCard(subject, WEIGHTS, context).components.find((entry) => entry.name === 'entryReplacement')
      ?.value ?? 0
  );
}

/** What one body is worth in the creature arm's own currency, which is what the arm reads. */
const worth = (power: number, toughness: number, keywords: readonly Keyword[] = []): number =>
  bodyValue(power, toughness, [], keywords, [], WEIGHTS, undefined);

/** The chance the deck has drawn at least one of `sources` cards by the median turn. */
const drawn = (sources: number): number =>
  hypergeometricAtLeast(1, sources, deckDraws(CONFIG), CONFIG.deckSize);

/**
 * The expectation the arm takes, spelled out in the test's own arithmetic:
 * gains sorted descending, each rung paid for the chance one of the cards at or
 * above it has been drawn.
 */
function expectedBest(gains: readonly number[]): number {
  const sorted = [...gains].filter((gain) => gain > 0).sort((left, right) => right - left);
  return sorted.reduce((sum, gain, index) => sum + (gain - (sorted[index + 1] ?? 0)) * drawn(index + 1), 0);
}

describe('a permanent that enters as a copy of a creature', () => {
  it('is worth nothing with no deck in hand, and says so by naming no component', () => {
    // The same asymmetry the two typed sacrifice clauses take: there is no
    // measured constant for an unknown deck's best body, and inventing one
    // would move every context-free score in the repository.
    expect(entryComponent(clone(), undefined)).toBe(0);
  });

  it('is the expected best body among the ones the deck has drawn, over its own', () => {
    // Two rungs and the clone's own 0/0, which gains nothing and drops out: the
    // 5/5 is copied whenever it has been seen, and the 2/2 whenever either has.
    const deck = [vanilla(5, 5), vanilla(2, 2)];
    expect(entryComponent(clone(), deck)).toBeCloseTo(
      expectedBest([worth(5, 5) - worth(0, 0), worth(2, 2) - worth(0, 0)]),
      10,
    );
  });

  it('reads which creature was drawn, where the flat maximum it replaced read whether one was', () => {
    // The model this replaced was the deck's single best body times the chance
    // any creature at all had been drawn, so it could not tell these two decks
    // apart: same best body, same creature count, same price. The expectation
    // can — the padded deck copies a 1/1 two times in three.
    const identical = [vanilla(4, 4), vanilla(4, 4), vanilla(4, 4)];
    const padded = [vanilla(4, 4), vanilla(1, 1), vanilla(1, 1)];
    const flat = (deck: readonly Card[]): number =>
      (worth(4, 4) - worth(0, 0)) * creatureSupply(deckContextOf([...deck, clone()], CONFIG));
    expect(flat(identical)).toBeCloseTo(flat(padded), 10);
    expect(entryComponent(clone(), identical)).toBeGreaterThan(entryComponent(clone(), padded));
    // Below it in both, which is the direction `mtg-v9zo` called generous: the
    // flat maximum pays the best body even in the games where it stayed in the
    // library. The deck of three 4/4s is where the two come closest, and even
    // there the flat model counts the clone itself as a creature to copy.
    expect(entryComponent(clone(), identical)).toBeLessThan(flat(identical));
    expect(entryComponent(clone(), identical)).toBeCloseTo((worth(4, 4) - worth(0, 0)) * drawn(3), 10);
  });

  it('pays a second copy of the best body for the chance the first was not drawn', () => {
    // The whole of what the flat maximum could not say: two 5/5s are worth more
    // to a clone than one is, because either of them will do.
    const one = entryComponent(clone(), [vanilla(5, 5)]);
    const two = entryComponent(clone(), [vanilla(5, 5), vanilla(5, 5)]);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeCloseTo(expectedBest([worth(5, 5) - worth(0, 0), worth(5, 5) - worth(0, 0)]), 10);
  });

  it('takes the best on offer rather than the average, because the player chooses', () => {
    // The mirror of `sacrificedValue`'s argument for the cheapest: a cost is
    // paid with the least you can, and a copy is taken of the most you can.
    const big = entryComponent(clone(), [vanilla(5, 5), vanilla(1, 1)]);
    const average = entryComponent(clone(), [vanilla(3, 3), vanilla(3, 3)]);
    expect(big).toBeGreaterThan(average);
  });

  it('rises when the deck around it does, which is the whole of the defect', () => {
    const small = entryComponent(clone(), [vanilla(1, 1), vanilla(1, 1)]);
    const large = entryComponent(clone(), [vanilla(6, 6), vanilla(6, 6)]);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  it('reads keywords, because a body is more than two numbers', () => {
    const plain = entryComponent(clone(), [vanilla(3, 3)]);
    const flier = entryComponent(clone(), [vanilla(3, 3, { keywords: ['flying'] })]);
    expect(flier).toBeGreaterThan(plain);
  });

  it('copies a token the deck mints as readily as a card it prints', () => {
    // `creatureBodies` walks the same supply every other deck-conditioned price
    // walks, so a 4/4 that only ever exists as a token is a 4/4 to copy.
    const minter = card({
      kind: 'sorcery',
      manaCost: { generic: 4, U: 1 },
      colors: ['U'],
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Colossus',
            colors: ['U'],
            subtypes: ['Shapeshifter'],
            power: 4,
            toughness: 4,
            keywords: [],
          },
        },
      ],
    });
    expect(entryComponent(clone(), [minter])).toBeGreaterThan(0);
  });

  it('is worth nothing in a deck with no creature to copy', () => {
    const spells = [
      card({
        kind: 'sorcery',
        manaCost: { generic: 1, U: 1 },
        colors: ['U'],
        effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
      }),
    ];
    // The clone's own 0/0 is in the list it maximizes over, because every field
    // on a `DeckContext` counts the card being priced, and it never wins.
    expect(entryComponent(clone(), spells)).toBe(0);
  });

  it('floors at zero, because the clause says you may and a worse body is declined', () => {
    expect(entryComponent(clone(4, 4), [vanilla(1, 1), vanilla(2, 2)])).toBe(0);
  });

  it('is a price the deck moves, so the second pass has to re-read it', () => {
    // Without this, a big creature joining the deck would be credited nothing
    // for what it hands the clone already in it.
    expect(readsTheDeck(clone(), WEIGHTS)).toBe(true);
    expect(readsTheDeck(vanilla(2, 2), WEIGHTS)).toBe(false);
  });
});
