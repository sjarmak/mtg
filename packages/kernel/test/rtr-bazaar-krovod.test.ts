/** Bazaar Krovod chooses another live attacker and links both effects to it. */
import type { AbilityInput, Card } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const ABILITY: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  printedSourceReference: 'thisCreature',
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 0,
      toughness: 2,
      target: {
        kind: 'targetCreature',
        filter: { combat: 'attacking' },
        excludeSource: true,
      },
    },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
  ],
};

const KROVOD = creature('Bazaar Krovod', 2, 5, {
  cost: { generic: 4, W: 1 },
  abilities: [ABILITY],
});
const ESCORT = creature('Bazaar Escort', 1, 1);
const IDLE = creature('Idle Market Guard', 1, 1);
const PROTECTED = creature('Protected Bazaar Attacker', 1, 1, {
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'W' } }],
});

function position(cards: readonly Card[] = [KROVOD, ESCORT, IDLE, PROTECTED]) {
  return scenario({
    battlefield: cards.map((card) => ({ card, controller: 0 as const })),
    active: 0,
    step: 'declareAttackers',
  });
}

function settlePriority(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0 && guard > 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Bazaar Krovod trigger did not settle');
}

function attackWithEscort() {
  const start = position();
  const krovod = oidOf(start.state, KROVOD.name);
  const escort = oidOf(start.state, ESCORT.name);
  const protectedAttacker = oidOf(start.state, PROTECTED.name);
  const declared = reduce(start.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: [
      { oid: krovod, defender: 1 },
      { oid: escort, defender: 1 },
      { oid: protectedAttacker, defender: 1 },
    ],
  });
  return { declared, krovod, escort };
}

function aimAtEscort() {
  const { declared, krovod, escort } = attackWithEscort();
  const decision = pendingDecision(declared.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Bazaar Krovod did not ask for a target');
  const entry = declared.state.stack.find((candidate) => candidate.ability !== null)?.oid;
  if (entry === undefined) throw new Error('Bazaar Krovod trigger did not reach the stack');
  const option = decision.options.find(
    (candidate) =>
      candidate.type === 'chooseTriggerTargets' &&
      candidate.targets[0]?.kind === 'permanent' &&
      candidate.targets[0].oid === escort,
  );
  if (option?.type !== 'chooseTriggerTargets') throw new Error('Bazaar Escort was not a legal target');
  const aimed = apply(declared, {
    ...option,
    oid: entry,
  });
  return { aimed, krovod, escort, decision };
}

describe("Bazaar Krovod's attack trigger", () => {
  it('offers only another attacking creature, then pumps and untaps that same target', () => {
    const { aimed, krovod, escort, decision } = aimAtEscort();
    const idle = oidOf(aimed.state, IDLE.name);
    const protectedAttacker = oidOf(aimed.state, PROTECTED.name);
    const offered = decision.options.flatMap((option) =>
      option.type === 'chooseTriggerTargets' ? option.targets.filter((target) => target !== null) : [],
    );

    expect(offered).toEqual([{ kind: 'permanent', oid: escort }]);
    expect(offered).not.toContainEqual({ kind: 'permanent', oid: krovod });
    expect(offered).not.toContainEqual({ kind: 'permanent', oid: idle });
    expect(offered).not.toContainEqual({ kind: 'permanent', oid: protectedAttacker });
    expect(aimed.state.objects[escort]?.tapped).toBe(true);

    const done = settlePriority(aimed);
    expect(powerOf(done.state, escort)).toBe(1);
    expect(toughnessOf(done.state, escort)).toBe(3);
    expect(done.state.objects[escort]?.tapped).toBe(false);
  });

  it('removes the trigger when the source attacks alone because it has no legal target', () => {
    const start = position([KROVOD, IDLE]);
    const krovod = oidOf(start.state, KROVOD.name);
    const declared = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: krovod, defender: 1 }],
    });

    expect(declared.state.stack.filter((entry) => entry.ability !== null)).toHaveLength(0);
    expect(eventsOfType(declared.events, 'triggerRemoved').map((event) => event.why)).toEqual([
      'no legal targets',
    ]);
  });

  it('fizzles both linked instructions when the chosen attacker leaves before resolution', () => {
    const { aimed, escort } = aimAtEscort();
    const removed = moveObject(beginTrace(aimed.state), escort, 'graveyard');
    const done = settlePriority(removed);

    expect(done.state.objects[escort]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'continuousEffectAdded')).toHaveLength(0);
    expect(done.state.stack.filter((entry) => entry.ability !== null)).toHaveLength(0);
  });
});
