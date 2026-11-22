/** Native execution of Obstinate Baloth's hand-active self replacement. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { creature, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const BALOTH = parseCard({
  kind: 'creature',
  id: 'm11-188-obstinate-baloth-kernel',
  name: 'Obstinate Baloth',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 188 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'],
  subtypes: ['Beast'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'discardedByOpponentEntersBattlefield' },
    },
  ],
});

const COERCION = sorcery(
  'Baloth Coercion',
  [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
  {},
);

function resolveSpell(start: ReduceResult, controller: 0 | 1, target: 0 | 1): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: controller,
    oid: handOidOf(start.state, controller, COERCION.name),
    targets: [{ kind: 'player', player: target } satisfies Target],
  });
  for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('the coercion lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function balothHand(controller: 0 | 1, owner: 0 | 1): ReduceResult {
  const hands =
    controller === owner
      ? controller === 0
        ? ([[BALOTH, COERCION], []] as const)
        : ([[], [BALOTH, COERCION]] as const)
      : controller === 0
        ? ([[COERCION], [BALOTH]] as const)
        : ([[BALOTH], [COERCION]] as const);
  return scenario({
    active: controller,
    hands,
  });
}

describe('Obstinate Baloth discard replacement', () => {
  it('replaces an opponent-controlled discard with ordinary battlefield entry and gains 4 life', () => {
    const done = resolveSpell(balothHand(0, 1), 0, 1);
    const baloth = oidOf(done.state, BALOTH.name);

    expect(done.state.objects[baloth]?.zone).toBe('battlefield');
    expect(done.state.objects[baloth]?.summoningSick).toBe(true);
    expect(done.state.players[1].graveyard).not.toContain(baloth);
    expect(done.state.players[1].life).toBe(24);
    expect(done.state.replacements).toEqual([]);
    expect(eventsOfType(done.events, 'replacementApplied')).toContainEqual({
      type: 'replacementApplied',
      id: `intrinsic:${baloth}:opponent-discard`,
      event: 'discard',
    });
    expect(eventsOfType(done.events, 'abilityTriggered').map((event) => event.condition)).toContain(
      'selfEnters',
    );
  });

  it('works with the seats reversed', () => {
    const done = resolveSpell(balothHand(1, 0), 1, 0);
    const baloth = oidOf(done.state, BALOTH.name);
    expect(done.state.objects[baloth]?.zone).toBe('battlefield');
    expect(done.state.players[0].life).toBe(24);
  });

  it("does not replace a discard caused by its owner's own spell", () => {
    const done = resolveSpell(balothHand(0, 0), 0, 0);
    const baloth = done.state.players[0].graveyard.find(
      (oid) => done.state.objects[oid]?.card.name === BALOTH.name,
    );
    expect(baloth).toBeDefined();
    expect(done.state.players[0].life).toBe(20);
    expect(
      eventsOfType(done.events, 'replacementApplied').filter((event) => event.event === 'discard'),
    ).toEqual([]);
  });

  it('does not replace a discard paid as an activation cost', () => {
    const pitcher = creature('Baloth Pitcher', 1, 1, {
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, discard: 1 },
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const start = scenario({ battlefield: [{ card: pitcher, controller: 0 }], hands: [[BALOTH], []] });
    const source = oidOf(start.state, pitcher.name);
    const baloth = handOidOf(start.state, 0, BALOTH.name);
    const action = pendingDecision(start.state)?.options.find(
      (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
        candidate.type === 'activateAbility' &&
        candidate.oid === source &&
        candidate.discards?.includes(baloth) === true,
    );
    if (action === undefined) throw new Error('the discard-cost activation was not offered');

    const activated = reduce(start.state, action);
    expect(activated.state.objects[baloth]?.zone).toBe('graveyard');
    expect(eventsOfType(activated.events, 'replacementApplied')).toEqual([]);
  });

  it('does not replace the turn-based cleanup discard', () => {
    let current = scenario({
      active: 0,
      step: 'end',
      maximumHandSize: 0,
      hands: [[BALOTH], []],
    });
    for (let guard = 0; guard < 8; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind === 'discard') {
        current = apply(current, decision.options[0] ?? { type: 'discard', player: 0, oids: [] });
        break;
      }
      if (decision?.kind !== 'priority') throw new Error('cleanup did not offer a discard');
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    const baloth = current.state.players[0].graveyard.find(
      (oid) => current.state.objects[oid]?.card.name === BALOTH.name,
    );
    expect(baloth).toBeDefined();
    expect(eventsOfType(current.events, 'replacementApplied')).toEqual([]);
  });
});
