import { parseCard } from '@mtg/dsl';
import type { Action, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { FOREST, instant, PLAINS, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const SMITER = parseCard({
  kind: 'creature',
  id: 'rtr-178-loxodon-smiter-kernel',
  name: 'Loxodon Smiter',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 178 },
  manaCost: { generic: 1, G: 1, W: 1 },
  colors: ['G', 'W'],
  subtypes: ['Elephant', 'Soldier'],
  power: 4,
  toughness: 4,
  cannotBeCountered: true,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'discardedByOpponentEntersBattlefield' },
    },
  ],
});

const COUNTER = instant('Smiter Counter', [{ kind: 'counterSpell' }], {});
const COERCION = sorcery(
  'Smiter Coercion',
  [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
  {},
);

function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 16 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('the stack lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('the stack did not settle');
  return current;
}

function castOption(current: ReduceResult, player: 0 | 1, cardName: string): Action {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority' || decision.player !== player) {
    throw new Error(`${cardName} was not offered to player ${String(player)}`);
  }
  const option = decision.options.find(
    (candidate) =>
      candidate.type === 'castSpell' && current.state.objects[candidate.oid]?.card.name === cardName,
  );
  if (option === undefined) throw new Error(`${cardName} had no cast option`);
  return option;
}

function discardResult(controller: 0 | 1, owner: 0 | 1): ReduceResult {
  const hands =
    controller === owner
      ? controller === 0
        ? ([[SMITER, COERCION], []] as const)
        : ([[], [SMITER, COERCION]] as const)
      : controller === 0
        ? ([[COERCION], [SMITER]] as const)
        : ([[SMITER], [COERCION]] as const);
  const start = scenario({ active: controller, hands });
  return settle(
    apply(start, {
      type: 'castSpell',
      player: controller,
      oid: handOidOf(start.state, controller, COERCION.name),
      targets: [{ kind: 'player', player: owner } satisfies Target],
    }),
  );
}

describe('RTR #178 Loxodon Smiter kernel execution', () => {
  it('resolves through a counterspell on the real stack', () => {
    let current = scenario({
      battlefield: [
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[SMITER], [COUNTER]],
    });
    current = apply(current, castOption(current, 0, SMITER.name));
    const smiterSpell = current.state.stack[0]?.oid;
    if (smiterSpell === undefined) throw new Error('Smiter did not enter the stack');
    current = apply(current, { type: 'passPriority', player: 0 });
    const counter = castOption(current, 1, COUNTER.name);
    if (counter.type !== 'castSpell') throw new Error('the counter was not a spell');
    expect(counter.targets).toContainEqual({ kind: 'spell', oid: smiterSpell });
    current = settle(apply(current, counter));

    expect(current.state.objects[smiterSpell]?.zone).toBe('battlefield');
    expect(eventsOfType(current.events, 'spellCountered')).toEqual([]);
  });

  it('replaces an opponent-controlled discard for either owner seat', () => {
    for (const [controller, owner] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const done = discardResult(controller, owner);
      const smiter = oidOf(done.state, SMITER.name);
      expect(done.state.objects[smiter]?.zone).toBe('battlefield');
      expect(done.state.objects[smiter]?.summoningSick).toBe(true);
      expect(eventsOfType(done.events, 'replacementApplied')).toContainEqual({
        type: 'replacementApplied',
        id: `intrinsic:${smiter}:opponent-discard`,
        event: 'discard',
      });
    }
  });

  it('does not replace a discard caused by its owner', () => {
    const done = discardResult(0, 0);
    const smiter = done.state.players[0].graveyard.find(
      (oid) => done.state.objects[oid]?.card.name === SMITER.name,
    );
    expect(smiter).toBeDefined();
    expect(eventsOfType(done.events, 'replacementApplied')).toEqual([]);
  });
});
