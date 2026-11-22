/** Gargoyle Sentinel's temporary defender removal through a real activation. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { Action, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  cleanupTurnEffects,
  eligibleAttackers,
  eventsOfType,
  hasKeyword,
  hasKeywordAbility,
  legalActions,
  pendingDecision,
  scenario,
} from '@mtg/kernel';
import { creature, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

const ANIMATE: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 3 } },
  effects: [
    {
      kind: 'grantKeywordUntilEndOfTurn',
      keyword: 'flying',
      removeKeywordAbility: 'defender',
      target: { kind: 'selfCreature' },
    },
  ],
} as AbilityInput;

function lands(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as const }));
}

function settlePriority(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.state.stack.length === 0 && guard > 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`stopped on ${String(decision?.kind)}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('activation did not settle');
}

describe('Gargoyle Sentinel in the kernel', () => {
  it('loses defender, gains flying, can attack, and restores its printed state at cleanup', () => {
    const gargoyle = creature('Gargoyle Sentinel', 3, 3, {
      artifact: true,
      keywordAbilities: [{ kind: 'defender' }],
      abilities: [ANIMATE],
    });
    const bystander = creature('Bystander', 2, 2);
    const start = scenario({
      battlefield: [{ card: gargoyle, controller: 0 }, { card: bystander, controller: 0 }, ...lands(3)],
    }).state;
    const gargoyleOid = oidOf(start, 'Gargoyle Sentinel');
    const bystanderOid = oidOf(start, 'Bystander');
    expect(hasKeywordAbility(start, gargoyleOid, 'defender')).toBe(true);

    const activation = legalActions(start).find(
      (action): action is Extract<Action, { type: 'activateAbility' }> =>
        action.type === 'activateAbility' && action.oid === gargoyleOid,
    );
    expect(activation).toBeDefined();
    const resolved = settlePriority(apply({ state: start, events: [] }, activation as Action));

    expect(hasKeywordAbility(resolved.state, gargoyleOid, 'defender')).toBe(false);
    expect(hasKeyword(resolved.state, gargoyleOid, 'flying')).toBe(true);
    expect(hasKeyword(resolved.state, bystanderOid, 'flying')).toBe(false);
    expect(eventsOfType(resolved.events, 'keywordAbilityRemoved')).toEqual([
      expect.objectContaining({ targetOid: gargoyleOid, keywordAbility: 'defender', layer: '6' }),
    ]);

    const combatState = {
      ...resolved.state,
      turn: { ...resolved.state.turn, step: 'declareAttackers' as const },
    };
    expect(eligibleAttackers(combatState)).toContain(gargoyleOid);

    const cleaned = cleanupTurnEffects(beginTrace(resolved.state));
    expect(hasKeywordAbility(cleaned.state, gargoyleOid, 'defender')).toBe(true);
    expect(hasKeyword(cleaned.state, gargoyleOid, 'flying')).toBe(false);
  });
});
