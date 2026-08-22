/**
 * DSL-layer cost modification (`mtg-bc2.152.6`): X costs are expressible in
 * `ManaCostSchema`, and a permanent can print a cost reduction over a spell
 * class. `@mtg/kernel`'s `cost.ts` is where either one is actually applied to
 * a cast; this file proves the printed side parses, prints, renders oracle
 * text and validates.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  describeCostReduction,
  formatManaCost,
  mana,
  manaValue,
  parseCard,
  renderOracleText,
  resolveX,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';

describe('X costs', () => {
  it('are off by default, so every cost DSL v0 could already print is unchanged', () => {
    const cost = mana({ generic: 1, R: 1 });
    expect(cost.hasX).toBe(false);
    expect(formatManaCost(cost)).toBe('{1}{R}');
  });

  it('print {X} first, ahead of generic and colored pips', () => {
    const cost = mana({ generic: 1, R: 1, hasX: true });
    expect(formatManaCost(cost)).toBe('{X}{1}{R}');
  });

  it('print bare {X} when nothing else is in the cost', () => {
    expect(formatManaCost(mana({ hasX: true }))).toBe('{X}');
  });

  it('have mana value 0 off the stack (CR 707.3): resolveX is not called yet', () => {
    expect(manaValue(mana({ R: 1, hasX: true }))).toBe(1);
  });

  it('resolveX folds the chosen value into generic and clears hasX', () => {
    const resolved = resolveX(mana({ generic: 1, R: 1, hasX: true }), 3);
    expect(resolved).toEqual(mana({ generic: 4, R: 1, hasX: false }));
  });

  it('resolveX is a no-op on a cost with no X', () => {
    const cost = mana({ generic: 2 });
    expect(resolveX(cost, 5)).toEqual(cost);
  });

  it('resolveX never goes negative on a hostile chosen value', () => {
    expect(resolveX(mana({ generic: 1, hasX: true }), -3)).toEqual(mana({ generic: 1, hasX: false }));
  });

  it('do not trip DSL v0\'s "no free spells" gate on their own', () => {
    const card: CardInput = {
      kind: 'instant',
      id: 'tst-fireball',
      name: 'Test Fireball',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { R: 1, hasX: true },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    };
    expect(validateCard(card)).toEqual([]);
  });
});

function testPermanent(costReduction: CardInput['costReduction']): CardInput {
  return {
    kind: 'artifact',
    id: 'tst-cost-reducer',
    name: 'Test Cost Reducer',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 3 },
    costReduction,
  };
}

describe('a printed cost reduction', () => {
  it('parses on an artifact and renders its oracle line', () => {
    const card = parseCard(testPermanent({ amount: 1, cardType: null }));
    expect(card.costReduction).toEqual({ amount: 1, cardType: null });
    expect(renderOracleText(card)).toBe('Spells you cast cost {1} less to cast.');
  });

  it('scopes to a card type in its printed line', () => {
    const card = parseCard(testPermanent({ amount: 2, cardType: 'creature' }));
    expect(renderOracleText(card)).toBe('Creature spells you cast cost {2} less to cast.');
  });

  it('is absent by default and prints nothing extra', () => {
    const card = parseCard(testPermanent(null));
    expect(card.costReduction).toBeNull();
    expect(renderOracleText(card)).toBe('');
  });

  it('is illegal on a card kind that never stays on the battlefield', () => {
    const spell: CardInput = {
      kind: 'instant',
      id: 'tst-illegal-reducer',
      name: 'Test Illegal Reducer',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 1 },
      costReduction: { amount: 1, cardType: null },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    };
    const result = safeParseCard(spell);
    if (result.ok) throw new Error('an instant with a printed cost reduction parsed as legal');
    expect(result.violations.map((v) => v.code)).toContain('COST_REDUCTION_ILLEGAL_ON_CARD_TYPE');
  });

  it('describeCostReduction is the exact line renderOracleText prints', () => {
    expect(describeCostReduction({ amount: 3, cardType: 'artifact' })).toBe(
      'Artifact spells you cast cost {3} less to cast.',
    );
  });
});
