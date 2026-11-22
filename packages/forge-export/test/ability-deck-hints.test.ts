/**
 * Every `DeckHas` hint the table carries, collected from the ability position.
 *
 * `mtg-1y7m`. The collector read `card.effects` only until `mtg-nhyv.30` closed
 * the gap in passing, and the one test that came with the fix pins `gainLife`.
 * The other four rows and the placement-sensitive mill case were left standing
 * on incidental coverage — a script-text assertion somewhere else that happens
 * to include the line — which is coverage that moves when its own fixture does.
 * This file asks the question directly, once per hint.
 *
 * The completeness test is the load-bearing one. `HINTS` below is checked
 * against `FORGE_EFFECTS` itself, so a sixth row added to the table with a
 * non-null `deckHas` fails here until somebody says where it sits on a card and
 * what it exports. A table-driven test that enumerates a hand-copied list is a
 * list that goes stale on the next row.
 *
 * Two placements are not the shared table:
 *
 *  - **Triggered mill.** `FORGE_EFFECTS.millCards.deckHas` is null and
 *    `abilityLines` adds `Mill` when the enclosing ability is a trigger, which
 *    is the distinction Jace's Erasure draws against an ordinary mill spell.
 *  - **A loyalty ability is not one.** `06922b46` narrowed the shared lookup to
 *    non-planeswalkers, and `mtg-9xz4` read the corpus for the line behind it:
 *    158 of Forge's 348 planeswalker scripts carry `DeckHas` over this same
 *    vocabulary. The narrowing is gone, and the case below now asks that a
 *    walker collect what any other card would. Like the rest of this mapping
 *    it is unverified against a booted Forge (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, EffectInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile, slugId } from './helpers';

/** A creature whose one triggered ability carries the effect under test. */
function trigger(name: string, effects: readonly EffectInput[], overrides: Partial<CardInput> = {}): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 7 },
    colors: ['G'],
    power: 2,
    toughness: 2,
    manaCost: { generic: 2, G: 1 },
    effects: [],
    abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [...effects] }],
    ...overrides,
  } as CardInput);
}

/**
 * One fixture per hint-carrying row, keyed by the effect kind the row is on.
 *
 * Each effect sits inside a triggered ability and nowhere else, so the assertion
 * below can only pass through the ability-position collector.
 */
const HINTS = {
  gainLife: { hint: 'LifeGain', effect: { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } } },
  createToken: {
    hint: 'Token',
    effect: {
      kind: 'createToken',
      count: 1,
      token: { identity: 'hint-ooze-1-1', name: 'Ooze', power: 1, toughness: 1, subtypes: ['Ooze'] },
    },
  },
  sacrificeSelf: { hint: 'Sacrifice', effect: { kind: 'sacrificeSelf', target: { kind: 'selfCreature' } } },
  sacrificePermanent: {
    hint: 'Sacrifice',
    effect: { kind: 'sacrificePermanent', target: { kind: 'targetOpponent' } },
  },
  doubleSourceCounters: {
    hint: 'Counters',
    effect: { kind: 'doubleSourceCounters', counter: 'plusOnePlusOne' },
  },
} satisfies Record<string, { readonly hint: string; readonly effect: EffectInput }>;

describe('the deck hints a triggered ability declares', () => {
  it('has a fixture for every row the table gives a hint, and for no other row', () => {
    const carried = Object.entries(FORGE_EFFECTS)
      .filter(([, row]) => row.deckHas !== null)
      .map(([kind]) => kind)
      .sort();
    expect(Object.keys(HINTS).sort()).toStrictEqual(carried);
  });

  it.each(Object.entries(HINTS))('declares the hint for %s', (kind, { hint, effect }) => {
    const script = mustTranspile(trigger(`Hint ${kind}`, [effect]));

    expect(script).toContain(`DeckHas:Ability$${hint}`);
    // The effect really is only in the ability position: a hint the spell chain
    // could have supplied would pass this test with the collector deleted.
    expect(script).toContain('T:Mode$ ChangesZone');
  });

  it('names each distinct hint once when two abilities carry the same one', () => {
    const both = trigger('Hint Twice', [], {
      abilities: [
        { kind: 'triggered', condition: 'selfEnters', effects: [HINTS.sacrificeSelf.effect] },
        { kind: 'triggered', condition: 'selfDies', effects: [HINTS.sacrificePermanent.effect] },
      ],
    });

    expect(mustTranspile(both)).toContain('DeckHas:Ability$Sacrifice\n');
  });

  it('joins two different hints on one card in the order the effects print', () => {
    const two = trigger('Hint Pair', [], {
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [HINTS.createToken.effect, HINTS.gainLife.effect],
        },
      ],
    });

    expect(mustTranspile(two)).toContain('DeckHas:Ability$Token|LifeGain');
  });
});

describe('mill, the one hint that depends on where the effect sits', () => {
  const MILL: EffectInput = { kind: 'millCards', count: 3, target: { kind: 'targetOpponent' } };

  it("declares Mill for a trigger, which is what Jace's Erasure carries", () => {
    expect(FORGE_EFFECTS.millCards.deckHas).toBeNull();
    expect(mustTranspile(trigger('Hint Miller', [MILL]))).toContain('DeckHas:Ability$Mill');
  });

  it('declares nothing for the same effect cast as a spell', () => {
    const spell = parseCard({
      kind: 'sorcery',
      id: slugId('Hint Mind Sculpt'),
      name: 'Hint Mind Sculpt',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 8 },
      colors: ['U'],
      manaCost: { generic: 1, U: 1 },
      effects: [MILL],
    } as CardInput);

    expect(mustTranspile(spell)).not.toContain('DeckHas:');
  });
});

describe('a planeswalker, whose loyalty abilities are abilities like any other', () => {
  it('collects each loyalty ability hint, in the order the abilities print', () => {
    const walker = parseCard({
      kind: 'planeswalker',
      id: slugId('Hint Ajani'),
      name: 'Hint Ajani',
      rarity: 'mythic',
      set: { code: 'TST', collectorNumber: 9 },
      manaCost: { generic: 2, W: 2 },
      colors: ['W'],
      supertypes: ['legendary'],
      subtypes: ['Ajani'],
      startingLoyalty: 4,
      abilities: [
        { kind: 'activated', loyaltyCost: 1, cost: { mana: {} }, effects: [HINTS.gainLife.effect] },
        { kind: 'activated', loyaltyCost: -6, cost: { mana: {} }, effects: [HINTS.createToken.effect] },
      ],
    } as CardInput);

    // Forge's own M11/M13 walkers carry no `DeckHas`, and neither do its M11
    // Obstinate Baloth and Mitotic Slime, which this transpiler exports hints
    // for. The era is what those scripts have in common, not the card kind:
    // 158 of the 348 planeswalker scripts shipped at 2.0.15-SNAPSHOT carry the
    // line. So a walker collects what the table says, in ability order.
    expect(mustTranspile(walker)).toContain('DeckHas:Ability$LifeGain|Token');
  });
});
