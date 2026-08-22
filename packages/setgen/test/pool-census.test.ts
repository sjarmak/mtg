/**
 * The pool census counts cards, and the three places a verb hides from it.
 *
 * The census this file covers replaces a figure that was quoted four times and
 * recomputed by nothing, so what is worth asserting here is not the figure. It
 * is the four properties whose absence produced the figure's three defects, each
 * of which is invisible on a small pool and each of which moves a real one by
 * tens of cards:
 *
 *  1. **A card counts once.** The prior numerator summed four per-verb card
 *     counts, so every card printing two of them landed twice on top of the
 *     fraction and once underneath. The tool reports both readings and names the
 *     second one as a share of nothing; these tests hold the first one to one
 *     card per card.
 *  2. **A modal card is read through its modes.** `card.effects` and
 *     `card.abilities` are both empty on one, so a walk over the two scores it
 *     zero on every verb rather than on one, and the hole is exactly as wide as
 *     the modal cycle somebody authors next.
 *  3. **A continuous clause is read wherever it is printed.** A static ability,
 *     an equip clause and an Aura clause carry the same modification, and the
 *     reader that visits only the first is the one whose `statBonus` row could
 *     not be reproduced.
 *  4. **Which walk produced the number is stated.** Descending into the tokens a
 *     card creates doubles one verb's card count and leaves the family's
 *     unchanged, so a per-verb number that does not say which walk it came from
 *     is two different numbers.
 *
 * Nothing here pins a count taken from a shipped set. A test that asserts a
 * committed pool's census is red on the next card anybody authors, which makes
 * it a tripwire on authoring rather than a gate on the instrument; the shipped
 * pool is used only for the properties that hold at any size.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_EFFECT_KINDS, parseCard } from '@mtg/dsl';
import type { Card, CardInput, TokenSpecInput } from '@mtg/dsl';
import { parseSetFile } from '../src/index';
import { poolCensus } from '../tools/pool-census';
import type { PoolCensus, PrintedVerb } from '../tools/pool-census';

function card(overrides: Partial<CardInput> & { id: string }): Card {
  return parseCard({
    kind: 'instant',
    name: 'Census Probe',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1 },
    colors: [],
    effects: [],
    ...overrides,
  } as CardInput);
}

/** A token whose own printed ability places a counter: the descent's whole subject. */
const COUNTER_TOKEN: TokenSpecInput = {
  name: 'Census Token',
  colors: [],
  subtypes: ['Part'],
  keywords: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 0 }, tapSelf: false, sacrificeSelf: true },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
  ],
};

function countOf(census: PoolCensus, verb: PrintedVerb): number {
  const rows = [...census.effectKinds, ...census.modificationKinds];
  return rows.find((row) => row.verb === verb)?.cards ?? 0;
}

describe('a card is counted once per verb', () => {
  it('adds one to the family and two to the card-verb pairs when it prints two of the four', () => {
    const both = card({
      id: 'both',
      effects: [
        { kind: 'createToken', count: 1, token: { name: 'Census Body', colors: [], subtypes: [] } },
        { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
      ],
    });
    const census = poolCensus([both], true);

    expect(census.cards).toBe(1);
    expect(census.familyCards).toBe(1);
    // The defect the tool exists to retire: this is the number the prior census
    // divided by the card count, and it is one larger than the card that
    // produced it.
    expect(census.familyPairs).toBe(2);
  });

  it('does not double a card that prints the same verb twice', () => {
    const twice = card({
      id: 'twice',
      effects: [
        { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    });
    const census = poolCensus([twice], true);

    expect(countOf(census, 'putCounters')).toBe(1);
    expect(census.familyPairs).toBe(1);
  });
});

describe('a modal card', () => {
  it('is read through its modes, where its whole text lives', () => {
    // Both of the fields a naive walk reads are empty on this card, and
    // `checkEffects` refuses one that populates `effects` beside `modes`, so
    // there is no shape in which the naive walk sees a modal card at all.
    const modal = card({
      id: 'modal',
      modes: [
        { effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }] },
        { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
      ],
    });
    expect(modal.effects).toStrictEqual([]);
    expect(modal.abilities).toStrictEqual([]);

    const census = poolCensus([modal], true);
    expect(countOf(census, 'dealDamage')).toBe(1);
    expect(countOf(census, 'drawCards')).toBe(1);
  });

  it('adds one to the family however many of its modes print a family verb', () => {
    // "Choose one" means the card does one of them, so two modes carrying a
    // family verb are still one card in the family.
    const modal = card({
      id: 'modal-family',
      modes: [
        {
          effects: [
            { kind: 'createToken', count: 1, token: { name: 'Census Body', colors: [], subtypes: [] } },
          ],
        },
        {
          effects: [
            { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
          ],
        },
      ],
    });
    const census = poolCensus([modal], true);

    expect(census.familyCards).toBe(1);
    expect(census.familyPairs).toBe(2);
  });
});

describe('the token-descent switch', () => {
  const minter = card({
    id: 'minter',
    effects: [{ kind: 'createToken', count: 1, token: COUNTER_TOKEN }],
  });

  it('credits the card with what its token prints, or does not, and the two differ', () => {
    expect(countOf(poolCensus([minter], true), 'putCounters')).toBe(1);
    expect(countOf(poolCensus([minter], false), 'putCounters')).toBe(0);
  });

  it('leaves the family share alone, because minting the token is itself a family verb', () => {
    // The structural reason the descent is a per-verb question and not a family
    // one: a card cannot put a counter through a token without printing
    // `createToken` to get the token onto the battlefield.
    expect(poolCensus([minter], true).familyCards).toBe(1);
    expect(poolCensus([minter], false).familyCards).toBe(1);
  });

  it('reports which walk produced the number', () => {
    expect(poolCensus([minter], true).tokenDescent).toBe(true);
    expect(poolCensus([minter], false).tokenDescent).toBe(false);
  });
});

describe('a continuous clause, wherever it is printed', () => {
  const anthem = card({
    id: 'anthem',
    kind: 'creature',
    power: 2,
    toughness: 2,
    artifact: false,
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
    ],
  });
  const weapon = card({
    id: 'weapon',
    kind: 'artifact',
    subtypes: ['Equipment'],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 }, tapSelf: false, sacrificeSelf: false },
        effects: [],
        attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      },
    ],
  });
  const aura = card({
    id: 'aura',
    kind: 'enchantment',
    subtypes: ['Aura'],
    aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: 2, toughness: 2 }] },
  });

  it('counts the equip clause and the Aura clause, not the static ability alone', () => {
    const census = poolCensus([anthem, weapon, aura], true);
    expect(countOf(census, 'statBonus')).toBe(3);
    expect(census.familyCards).toBe(3);
  });

  it('reads a verb no effect kind spells, which is why the census reads two vocabularies', () => {
    // The trap stated exactly. `statBonus` was recorded as a name on both
    // unions with only one arm reachable; it is on one union, so a walk over
    // `Effect['kind']` has no expression for it and reports a set that prints it
    // as printing it zero times. If a `statBonus` effect kind is ever added,
    // this line goes red and the census has to say which of the two it means.
    expect(ALL_EFFECT_KINDS).not.toContain('statBonus');
    const census = poolCensus([anthem], true);
    expect(census.effectKinds).toStrictEqual([]);
    expect(census.modificationKinds).toStrictEqual([{ verb: 'statBonus', cards: 1 }]);
  });
});

describe('over a shipped pool', () => {
  const set = parseSetFile(
    JSON.parse(
      readFileSync(new URL('../fixtures/sets/tideglass-reach.set.json', import.meta.url), 'utf8'),
    ) as unknown,
  );

  it('states a denominator that is the pool, and no row can exceed it', () => {
    const census = poolCensus(set.cards, true);
    expect(census.cards).toBe(set.cards.length);
    for (const row of [...census.effectKinds, ...census.modificationKinds]) {
      expect(row.cards).toBeGreaterThan(0);
      expect(row.cards).toBeLessThanOrEqual(census.cards);
    }
    expect(census.familyCards).toBeLessThanOrEqual(census.familyPairs);
    expect(census.familyCards).toBeLessThanOrEqual(census.cards);
  });

  it('reads the same family share with the descent and without it', () => {
    expect(poolCensus(set.cards, false).familyCards).toBe(poolCensus(set.cards, true).familyCards);
  });
});
