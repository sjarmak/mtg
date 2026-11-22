/**
 * What "spells you cast cost {2} less" is worth (`mtg-a3dx`).
 *
 * `evaluateCard` read `card.costReduction` nowhere: a 2/2 for `{3}{G}` that
 * makes every creature after it three cheaper scored what the same body scores
 * with the clause struck. The clause is the reason such a card is in a deck.
 *
 * The price is three numbers already argued elsewhere multiplied together —
 * what a mana of cost is worth, how many spells you cast while a permanent you
 * played is on the battlefield, and how much of your deck the named card type
 * is. `config.ts` carries the derivation and the measurement; this file asserts
 * the identity, because a price assembled from three rows goes wrong silently
 * when one of them moves.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { CARD_KINDS, parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

let serial = 300;

function lord(over: Record<string, unknown>): CardInput {
  serial += 1;
  return {
    kind: 'creature',
    id: `cut-${String(serial)}`,
    name: `Cut ${String(serial)}`,
    rarity: 'rare',
    set: { code: 'CUT', collectorNumber: serial },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    subtypes: ['Human'],
    power: 2,
    toughness: 2,
    ...over,
  } as CardInput;
}

function score(over: Record<string, unknown>): number {
  return evaluateCard(parseCard(lord(over)), WEIGHTS).score;
}

function component(over: Record<string, unknown>, name: string): number {
  return (
    evaluateCard(parseCard(lord(over)), WEIGHTS).components.find((entry) => entry.name === name)?.value ?? 0
  );
}

describe('a printed cost reduction', () => {
  it('is what the mana is worth, over the spells it reaches', () => {
    const cut = { costReduction: { amount: 2, cardType: null } };
    expect(component(cut, 'costReduction')).toBeCloseTo(
      WEIGHTS.spellManaPenaltyPerMana * 2 * WEIGHTS.triggerFireCount.youCastSpell,
      10,
    );
  });

  it('reads the amount, so three cheaper is worth half again what two cheaper is', () => {
    const two = component({ costReduction: { amount: 2, cardType: null } }, 'costReduction');
    const three = component({ costReduction: { amount: 3, cardType: null } }, 'costReduction');
    expect(three).toBeCloseTo(two * 1.5, 10);
  });

  it('reads the card type, so a creature clause outruns an enchantment one', () => {
    const creatures = component({ costReduction: { amount: 2, cardType: 'creature' } }, 'costReduction');
    const enchantments = component(
      { costReduction: { amount: 2, cardType: 'enchantment' } },
      'costReduction',
    );
    expect(creatures).toBeGreaterThan(enchantments);
    expect(creatures).toBeCloseTo(
      component({ costReduction: { amount: 2, cardType: null } }, 'costReduction') *
        WEIGHTS.costReductionCastShare.creature,
      10,
    );
  });

  it('reaches nothing when it names the one card type nobody casts', () => {
    // A land is put onto the battlefield, never cast, so a clause naming one
    // reduces the cost of nothing. Zero here is arithmetic, not a missing
    // measurement, and it is the row that says the shares are shares of the
    // spells a deck casts rather than of its cards.
    expect(WEIGHTS.costReductionCastShare.land).toBe(0);
    expect(component({ costReduction: { amount: 3, cardType: 'land' } }, 'costReduction')).toBe(0);
  });

  it('states a share for every card type, so no clause is silently free', () => {
    for (const kind of CARD_KINDS) {
      expect(WEIGHTS.costReductionCastShare[kind]).toBeGreaterThanOrEqual(0);
      expect(WEIGHTS.costReductionCastShare[kind]).toBeLessThanOrEqual(1);
    }
    // A share is a share of one thing, so the eight of them add to one thing.
    const sum = CARD_KINDS.reduce((total, kind) => total + WEIGHTS.costReductionCastShare[kind], 0);
    expect(sum).toBeGreaterThan(0.95);
    expect(sum).toBeLessThan(1.05);
  });

  it('names nothing on the same body with the clause struck', () => {
    const plain = evaluateCard(parseCard(lord({})), WEIGHTS);
    expect(plain.components.some((entry) => entry.name === 'costReduction')).toBe(false);
    expect(score({ costReduction: { amount: 2, cardType: null } })).toBeGreaterThan(plain.score);
  });

  it('is a weight a caller can override, like every other row in the table', () => {
    const overridden = {
      ...WEIGHTS,
      costReductionCastShare: { ...WEIGHTS.costReductionCastShare, creature: 0 },
    };
    const cut = parseCard(lord({ costReduction: { amount: 3, cardType: 'creature' } }));
    expect(evaluateCard(cut, overridden).components.some((entry) => entry.name === 'costReduction')).toBe(
      false,
    );
  });
});
