/**
 * `selfCreature`, the retained referent that names an ability's own source
 * (CR 115.6a), driven through the reducer on both ability kinds it is legal
 * on.
 *
 * `triggeringCreature` (`exalted.test.ts`) proved the shape for a referent
 * filled from the *triggering event* and never reaches an activation: the DSL
 * refuses it there, so its enumeration slot returning `[]` (no CR 115 choice)
 * is never asked to pair with anything else. `selfCreature` is filled from the
 * ability's own `sourceOid` instead, which every ability on the stack carries
 * whether a trigger put it there or a player activated it — so the same
 * printed sentence ("This creature gets +1/+0 until end of turn.") is legal
 * activated (Fiery Hellhound, M11) and triggered (Griffin Protector, M13), and
 * this suite drives one of each. Because it reaches the activation path,
 * `[]` would be the wrong enumeration answer there — `cartesian` over an empty
 * slot yields zero tuples for the *whole* ability, which is the bug the first
 * test below catches by asserting the activation is offered at all rather than
 * only asserting what it does once submitted.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature, instant, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

/** "{R}: This creature gets +1/+0 until end of turn." — Fiery Hellhound (M11). */
const ACTIVATED_SELF_PUMP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { R: 1 }, tapSelf: false },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 0, target: { kind: 'selfCreature' } }],
};

/** "Whenever ~ attacks, this creature gets +1/+1 until end of turn." — Griffin Protector's shape (M13). */
const TRIGGERED_SELF_PUMP: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'selfCreature' } }],
};

function lands(count: number, controller: 0 | 1): { readonly card: Card; readonly controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const found: Extract<Action, { type: 'activateAbility' }>[] = [];
  for (const option of legalActions(state)) {
    if (option.type === 'activateAbility') found.push(option);
  }
  return found;
}

/** Passes priority with whoever holds it until the stack is empty or a real decision is owed. */
function settlePriority(start: ReduceResult, limit = 20): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0 && guard > 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('settlePriority: stack did not settle');
}

describe('an activated ability naming its own source ("selfCreature")', () => {
  it('is offered as a legal activation with a placeholder target, and resolving it pumps the source with no target chosen', () => {
    const hellhound = creature('Probe Hellhound', 2, 1, { abilities: [ACTIVATED_SELF_PUMP] });
    const start = scenario({
      battlefield: [{ card: hellhound, controller: 0 }, ...lands(1, 0)],
    }).state;
    const sourceOid = oidOf(start, 'Probe Hellhound');

    const offered = activations(start).filter((option) => option.oid === sourceOid);
    expect(offered).toHaveLength(1);
    expect(offered[0]?.targets).toEqual([null]);

    const activated = apply({ state: start, events: [] }, offered[0] as Action);
    expect(powerOf(activated.state, sourceOid)).toBe(2);

    const resolved = settlePriority(activated);
    expect(powerOf(resolved.state, sourceOid)).toBe(3);
    expect(toughnessOf(resolved.state, sourceOid)).toBe(1);
    expect(eventsOfType(resolved.events, 'continuousEffectAdded')).toHaveLength(1);
  });

  it('resolves as a no-op when the source leaves the battlefield before it resolves', () => {
    const hellhound = creature('Doomed Probe Hellhound', 2, 1, { abilities: [ACTIVATED_SELF_PUMP] });
    const removal = instant('Remove Hellhound', [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    ]);
    const start = scenario({
      battlefield: [{ card: hellhound, controller: 0 }, ...lands(1, 0), ...lands(1, 1)],
      hands: [[], [removal]],
      seed: 'self-creature-target/source-leaves',
    }).state;
    const sourceOid = oidOf(start, 'Doomed Probe Hellhound');

    const offered = activations(start).filter((option) => option.oid === sourceOid);
    expect(offered).toHaveLength(1);

    const activated = apply({ state: start, events: [] }, offered[0] as Action);
    const passed = apply(activated, { type: 'passPriority', player: 0 });
    const answered = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: handOidOf(passed.state, 1, 'Remove Hellhound'),
      targets: [{ kind: 'permanent', oid: sourceOid }],
    });

    const resolved = settlePriority(answered);
    expect(resolved.state.objects[sourceOid]?.zone).toBe('graveyard');
    // The removal resolves first (LIFO) and destroys the source; when the pump
    // then resolves it has nothing to name, so it adds no continuous effect —
    // the same silent drop `planResolution`'s `selfCreature` branch gives an
    // activation the same way it gives `triggeringCreature`'s trigger in
    // `exalted.test.ts`'s "resolves after its source leaves the battlefield".
    expect(eventsOfType(resolved.events, 'continuousEffectAdded')).toHaveLength(0);
  });
});

describe('a triggered ability naming its own source ("selfCreature")', () => {
  it('fires on attack and pumps the source with no target asked', () => {
    const griffin = creature('Probe Griffin', 2, 2, { abilities: [TRIGGERED_SELF_PUMP] });
    const start = scenario({
      battlefield: [{ card: griffin, controller: 0 }, ...lands(1, 0)],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attackerOid = oidOf(start, 'Probe Griffin');

    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attackerOid, defender: 1 }],
    });

    const fired = eventsOfType(declared.events, 'abilityTriggered');
    expect(fired.map((event) => [event.source, event.condition])).toEqual([[attackerOid, 'selfAttacks']]);
    expect(declared.state.stack).toHaveLength(1);
    // No target owed: unlike a targeted trigger, priority is not stopped to ask
    // for one, because `selfCreature` is excluded from `effectChoosesTarget`
    // the same way `triggeringCreature` is — the ability goes on the stack with
    // an empty `targets` list and resolves off its own `sourceOid`.
    expect(declared.state.stack[0]?.targets).toEqual([]);
    expect(pendingDecision(declared.state)?.kind).toBe('priority');

    const resolved = settlePriority(declared);
    expect(powerOf(resolved.state, attackerOid)).toBe(3);
    expect(toughnessOf(resolved.state, attackerOid)).toBe(3);
  });
});
