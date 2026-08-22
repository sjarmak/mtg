/**
 * Planeswalkers compile: a `Loyalty:` line and one `A:AB$` per loyalty ability.
 *
 * The expectations are read off Forge 2.0.14's `res/cardsfolder`, the same
 * authority the enchantment mapping uses and for the same reason — there is no
 * booted Forge here to check against (`mtg-17a`).
 *
 * Two things about a loyalty ability are not an ordinary activation. The cost
 * is a counter payment rather than mana, and Forge writes the `[+1]:` symbol
 * itself from that cost, so the `SpellDescription$` carries the sentence
 * without it. Both are asserted below, because getting the second wrong prints
 * the symbol on the card twice and still boots.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function walker(overrides: Partial<CardInput> = {}): Card {
  return parseCard({
    kind: 'planeswalker',
    id: 'tst-ajani',
    name: 'Ajani Goldmane',
    rarity: 'mythic',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, W: 2 },
    colors: ['W'],
    supertypes: ['legendary'],
    subtypes: ['Ajani'],
    startingLoyalty: 4,
    abilities: [
      {
        kind: 'activated',
        loyaltyCost: 1,
        cost: { mana: {} },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        loyaltyCost: 0,
        cost: { mana: {} },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        loyaltyCost: -6,
        cost: { mana: {} },
        effects: [{ kind: 'createToken', count: 1, token: { name: 'Cat', power: 2, toughness: 2 } }],
      },
    ],
    ...overrides,
  } as CardInput);
}

function scriptOf(card: Card): readonly string[] {
  const result = transpileCardScript(card);
  if (!result.ok) throw new Error(`expected a script, got ${JSON.stringify(result.rejections)}`);
  return result.value.lines;
}

describe('planeswalker card scripts', () => {
  it('writes starting loyalty as its own line, never a PT', () => {
    const lines = scriptOf(walker());
    expect(lines).toContain('Types:Legendary Planeswalker Ajani');
    expect(lines).toContain('Loyalty:4');
    expect(lines.some((line) => line.startsWith('PT:'))).toBe(false);
  });

  it('pays a plus ability with AddCounter and a minus ability with SubCounter', () => {
    const activations = scriptOf(walker()).filter((line) => line.startsWith('A:'));
    expect(activations[0]).toContain('Cost$ AddCounter<1/LOYALTY>');
    expect(activations[2]).toContain('Cost$ SubCounter<6/LOYALTY>');
  });

  it('pays a zero ability with AddCounter<0>, which is the form 53 shipped scripts use', () => {
    // Five ship `SubCounter<0/LOYALTY>` instead. Both are legal and one had to
    // be chosen; this is the majority spelling.
    expect(scriptOf(walker()).filter((line) => line.startsWith('A:'))[1]).toContain(
      'Cost$ AddCounter<0/LOYALTY>',
    );
  });

  it('marks every loyalty ability Planeswalker$ True', () => {
    // Universal in the corpus: 991 of 998 loyalty-cost lines write it exactly
    // this way and the remaining seven write the same word in lower case.
    const activations = scriptOf(walker()).filter((line) => line.startsWith('A:'));
    expect(activations).toHaveLength(3);
    for (const line of activations) expect(line).toContain('Planeswalker$ True');
  });

  it('leaves the loyalty symbol off SpellDescription, because Forge writes it', () => {
    const activations = scriptOf(walker()).filter((line) => line.startsWith('A:'));
    expect(activations[0]).toContain('SpellDescription$ You gain 2 life.');
    for (const line of activations) expect(line).not.toContain('SpellDescription$ [');
  });

  it('keeps the printed symbol on the Oracle line, where the card face reads it', () => {
    const oracle = scriptOf(walker()).find((line) => line.startsWith('Oracle:'));
    expect(oracle).toContain('[+1]: You gain 2 life.');
    expect(oracle).toContain('[0]: Draw a card.');
  });

  it('carries no mana in the cost, because a loyalty ability pays only loyalty', () => {
    // `checkActivatedAbility` refuses a loyalty ability that also costs mana,
    // taps or sacrifices, so the counter payment is the whole `Cost$` and a
    // stray `2 W` here would mean that rule stopped holding.
    for (const line of scriptOf(walker()).filter((line) => line.startsWith('A:'))) {
      expect(line).toMatch(/Cost\$ (Add|Sub)Counter<\d+\/LOYALTY> \|/);
    }
  });
});
