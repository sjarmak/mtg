/**
 * A {0} spell, cast from a hand with no lands and an empty mana pool.
 *
 * `@mtg/dsl` refused a total mana value of 0 until `mtg-nhyv.79`, as
 * `MANA_COST_ZERO` with the message "DSL v0 has no free spells". That sentence
 * is about what the set generator may print, and it stood in for a claim nobody
 * had made about the kernel. This file makes the claim: Ornithopter, M11's {0}
 * artifact creature, is offered as a cast with nothing to pay from, resolves,
 * and arrives as the 0/2 flier the card prints.
 *
 * The generator's floor did not move out of the generator, so nothing here says
 * a *generated* set may contain a free card. No slot window can open below 1
 * (`CurveBucketSchema`, `SPELL_CURVE`, `COLORLESS_PERMANENT_MV`, the roles
 * table), and `checkSlotConformance` fails a card outside its slot's window.
 *
 * Three assertions, because there are three places an "at least one mana"
 * assumption could have hidden: in the enumeration (`legalActions` never offers
 * the cast), in the payment (`payFromPool` reads an all-zero cost as unpayable
 * and returns `null`), and in the reduction arithmetic (`effectiveManaCost`
 * subtracts a discount from 0 and hands `canPay` a negative generic). None of
 * the three held; the last one is already floored at `Math.max(0, …)`.
 */
import { describe, expect, it } from 'vitest';
import {
  canPay,
  effectiveManaCost,
  hasKeyword,
  isOnBattlefield,
  legalActions,
  powerOf,
  scenario,
  toughnessOf,
  type ReduceResult,
} from '@mtg/kernel';
import type { Card, CastableCard } from '@mtg/dsl';
import { isCastable, manaValue } from '@mtg/dsl';
import { costReducer, creature, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

function castable(card: Card): CastableCard {
  if (!isCastable(card)) throw new Error(`fixture "${card.name}" is not a castable card`);
  return card;
}

/** M11 #211: `{0}` Artifact Creature — Thopter, 0/2, flying. */
const ORNITHOPTER = castable(
  creature('Ornithopter', 0, 2, {
    cost: {},
    artifact: true,
    subtypes: ['Thopter'],
    keywords: ['flying'],
  }),
);

/** Passes priority until the stack empties, so the spell actually resolves. */
function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let step = 0; step < 8 && current.state.stack.length > 0; step += 1) {
    const pass = legalActions(current.state).find((action) => action.type === 'passPriority');
    if (pass === undefined) break;
    current = apply(current, pass);
  }
  return current;
}

describe('a spell that costs nothing', () => {
  it('is offered, paid for and resolved from a board with no mana at all', () => {
    const opened = scenario({ hands: [[ORNITHOPTER], []], battlefield: [] });
    expect(manaValue(ORNITHOPTER.manaCost)).toBe(0);
    expect(opened.state.battlefield).toStrictEqual([]);
    expect(canPay(opened.state, 0, ORNITHOPTER.manaCost)).toBe(true);

    const oid = handOidOf(opened.state, 0, 'Ornithopter');
    const offered = legalActions(opened.state).filter(
      (action) => action.type === 'castSpell' && action.oid === oid,
    );
    expect(offered).toHaveLength(1);

    const cast = apply(opened, { type: 'castSpell', player: 0, oid, targets: [] });
    expect(cast.state.stack).toHaveLength(1);

    const resolved = settle(cast);
    const thopter = oidOf(resolved.state, 'Ornithopter');
    expect(isOnBattlefield(resolved.state, thopter)).toBe(true);
    expect(powerOf(resolved.state, thopter)).toBe(0);
    expect(toughnessOf(resolved.state, thopter)).toBe(2);
    expect(hasKeyword(resolved.state, thopter, 'flying')).toBe(true);
  });

  it('leaves an untapped land untapped, because the payment spends nothing', () => {
    const opened = scenario({
      hands: [[ORNITHOPTER], []],
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
    });
    const mountain = oidOf(opened.state, 'Mountain');
    expect(opened.state.objects[mountain]?.tapped).toBe(false);

    const oid = handOidOf(opened.state, 0, 'Ornithopter');
    const resolved = settle(apply(opened, { type: 'castSpell', player: 0, oid, targets: [] }));
    expect(resolved.state.objects[mountain]?.tapped).toBe(false);
    expect(isOnBattlefield(resolved.state, oidOf(resolved.state, 'Ornithopter'))).toBe(true);
  });

  it('stays at zero when a cost reduction is applied to it, rather than going negative', () => {
    const discount = costReducer('Font of Free Casting', { amount: 1, cardType: null });
    const opened = scenario({
      hands: [[ORNITHOPTER], []],
      battlefield: [{ card: discount, controller: 0 }],
    });
    const reduced = effectiveManaCost(opened.state, 0, ORNITHOPTER);
    expect(reduced.generic).toBe(0);
    expect(manaValue(reduced)).toBe(0);
    expect(canPay(opened.state, 0, reduced)).toBe(true);

    const oid = handOidOf(opened.state, 0, 'Ornithopter');
    const resolved = settle(apply(opened, { type: 'castSpell', player: 0, oid, targets: [] }));
    expect(isOnBattlefield(resolved.state, oidOf(resolved.state, 'Ornithopter'))).toBe(true);
  });
});
