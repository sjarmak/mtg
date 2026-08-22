/**
 * The mtg-bc2.81 regression: a land slot the split has no color to apportion
 * basics to.
 *
 * `splitBasics` divides the slot by weighted pip demand, so a deck where no
 * color demands a pip — every spell colorless, or a stated color no card
 * actually costs — gets zeros back. The land count was still counted into the
 * deck's size, so a build of 36 spells claimed sixty cards and exported 36, and
 * raised nothing. The size and the land total are now what the split placed,
 * which makes the deck's own size shortfall fire, and the empty slot is named
 * rather than balanced with lands that do not exist.
 *
 * The mono-red case is here for contrast and as the guard: deriving the totals
 * from the placed basics must leave every deck whose split does place them on
 * exactly the numbers it had before.
 */
import { describe, expect, it } from 'vitest';
import { assembleDeck } from '../src/assemble';
import type { CandidateCard } from '../src/candidates';
import { DeckCriteriaSchema, type DeckCriteriaInput, type ResolvedCriteria } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import { parseManaCost } from '../src/mana-cost';
import type { Inclusion } from '../src/verify';

/** A spell of the given cost. Mana value is the store's column, so it is given. */
function include(name: string, manaCost: string, manaValue: number, count: number): Inclusion {
  const card: CandidateCard = {
    oracleId: name,
    name,
    manaCost,
    manaValue,
    typeLine: 'Artifact',
    oracleText: null,
    power: null,
    toughness: null,
    colorIdentity: '',
    keywords: [],
    priceUsd: 1,
    parsedCost: parseManaCost(manaCost),
    producedMana: [],
  };
  return { card, count, criteria: ['archetype'], reason: 'test' };
}

/** As in `assemble.test.ts`: these cases state their count, so the plan is `stated`. */
function criteriaFor(overrides: Partial<DeckCriteriaInput>): ResolvedCriteria {
  const landCount = overrides.landCount ?? 24;
  const parsed = DeckCriteriaSchema.parse({ prompt: 'test', format: 'modern', ...overrides, landCount });
  return resolveCriteria(parsed, { count: landCount, source: 'stated', reason: 'as the player stated' });
}

describe('a land slot no color can fill', () => {
  it('leaves an all-colorless deck the size it actually is, and says why', () => {
    const deck = assembleDeck(
      [include('artifact', '{2}', 2, 36)],
      criteriaFor({ colors: [], size: 60, landCount: 24 }),
    );

    expect(deck.manaBase.totalLands).toBe(0);
    expect(deck.totalCards).toBe(36);
    expect(deck.shortfalls).toContainEqual(expect.stringMatching(/cannot be filled/));
    expect(deck.shortfalls).toContainEqual(expect.stringMatching(/target of 60/));
  });

  it('does the same for a stated color no card in the deck costs', () => {
    // The bug is the absence of pip demand, not the absence of a color: a red
    // deck of colorless spells reaches the same empty split.
    const deck = assembleDeck(
      [include('artifact', '{2}', 2, 36)],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );

    expect(deck.manaBase.basics.R).toBe(0);
    expect(deck.manaBase.totalLands).toBe(0);
    expect(deck.totalCards).toBe(36);
    expect(deck.shortfalls).toContainEqual(expect.stringMatching(/cannot be filled/));
    expect(deck.shortfalls).toContainEqual(expect.stringMatching(/target of 60/));
  });

  it('still fills the slot for a deck whose colors do demand pips', () => {
    const deck = assembleDeck(
      [include('mono red', '{R}', 1, 36)],
      criteriaFor({ colors: ['R'], size: 60, landCount: 24 }),
    );

    expect(deck.manaBase.basics.R).toBe(24);
    expect(deck.manaBase.totalLands).toBe(24);
    expect(deck.totalCards).toBe(60);
    expect(deck.shortfalls).toEqual([]);
  });
});
