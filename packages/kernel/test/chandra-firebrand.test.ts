/** Native delayed-copy and plural-target behavior for M13 Chandra. */
import { describe, expect, it } from 'vitest';
import { type AbilityInput } from '@mtg/dsl';
import {
  beginTrace,
  cleanupTurnEffects,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, instant, lands, MOUNTAIN, planeswalker } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const ABILITIES: readonly AbilityInput[] = [
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: 1,
    effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
  },
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: -2,
    effects: [{ kind: 'copyNextInstantOrSorceryThisTurn' }],
  },
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: -6,
    effects: [
      {
        kind: 'dealDamage',
        amount: 6,
        target: { kind: 'anyTarget', count: 6 },
        division: { kind: 'each' },
      },
    ],
  },
];

const SPARK = instant(
  'Chandra Probe Spark',
  [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
  {},
);
const GEYSER = instant(
  'Chandra Probe Geyser',
  [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
  { R: 2, hasX: true },
);

function chandra(loyalty = 3) {
  return {
    card: planeswalker('Chandra, the Firebrand', 3, ABILITIES, { generic: 3, R: 1 }),
    controller: 0 as const,
    loyalty,
  };
}

function resolveTop(current: ReduceResult): ReduceResult {
  return apply(apply(current, { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

function activation(current: ReduceResult, source: string, index: number): Action {
  const action = legalActions(current.state).find(
    (option) => option.type === 'activateAbility' && option.oid === source && option.abilityIndex === index,
  );
  if (action === undefined) throw new Error(`Chandra ability ${String(index)} was not offered`);
  return action;
}

describe('Chandra, the Firebrand', () => {
  it('copies only the next qualifying spell, survives source departure, and offers new targets', () => {
    const decoy = creature('Chandra Probe Decoy', 1, 1, { cost: {} });
    let current = scenario({ battlefield: [chandra()], hands: [[decoy, SPARK], []] });
    const source = oidOf(current.state, 'Chandra, the Firebrand');

    current = apply(current, activation(current, source, 1));
    current = resolveTop(current);
    expect(current.state.delayedSpellCopies).toHaveLength(1);
    current = {
      state: moveObject(beginTrace(current.state), source, 'graveyard').state,
      events: current.events,
    };

    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, decoy.name),
      targets: [],
    });
    expect(current.state.delayedSpellCopies).toHaveLength(1);
    current = resolveTop(current);

    const spark = handOidOf(current.state, 0, SPARK.name);
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: spark,
      targets: [{ kind: 'player', player: 0 }],
    });
    expect(current.state.delayedSpellCopies).toBeUndefined();
    expect(current.state.stack.at(-1)?.delayedSpellCopy?.spellOid).toBe(spark);

    current = resolveTop(current);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'spellTargets') throw new Error('the delayed copy did not offer new targets');
    const retarget = decision.options.find(
      (option) =>
        option.type === 'chooseSpellTargets' &&
        option.targets[0]?.kind === 'player' &&
        option.targets[0].player === 1,
    );
    if (retarget === undefined) throw new Error('the copied spell could not target the opponent');
    current = apply(current, retarget);
    expect(current.state.stack).toHaveLength(2);
    expect(current.state.stack.at(-1)?.copiedSpell?.copiedFrom).toBe(spark);

    current = resolveTop(resolveTop(current));
    expect(current.state.players.map((player) => player.life)).toEqual([18, 18]);
  });

  it('expires an unused delayed copy at cleanup', () => {
    let current = scenario({ battlefield: [chandra()] });
    const source = oidOf(current.state, 'Chandra, the Firebrand');
    current = resolveTop(apply(current, activation(current, source, 1)));
    expect(current.state.delayedSpellCopies).toHaveLength(1);
    expect(cleanupTurnEffects(beginTrace(current.state)).state.delayedSpellCopies).toBeUndefined();
  });

  it('does nothing if the triggering spell leaves before the delayed trigger resolves', () => {
    let current = scenario({ battlefield: [chandra()], hands: [[SPARK], []] });
    const source = oidOf(current.state, 'Chandra, the Firebrand');
    current = resolveTop(apply(current, activation(current, source, 1)));
    const spark = handOidOf(current.state, 0, SPARK.name);
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: spark,
      targets: [{ kind: 'player', player: 1 }],
    });
    current = {
      state: moveObject(beginTrace(current.state), spark, 'graveyard').state,
      events: current.events,
    };
    current = resolveTop(current);
    expect(current.state.pendingSpellTargets).toBeUndefined();
    expect(current.state.stack).toEqual([]);
  });

  it('preserves the triggering spell copiable X and target tuple', () => {
    let current = scenario({
      battlefield: [chandra(), ...lands(MOUNTAIN, 5).map((card) => ({ card, controller: 0 as const }))],
      hands: [[GEYSER], []],
    });
    const source = oidOf(current.state, 'Chandra, the Firebrand');
    current = resolveTop(apply(current, activation(current, source, 1)));
    const geyser = handOidOf(current.state, 0, GEYSER.name);
    current = apply(current, {
      type: 'castSpell',
      player: 0,
      oid: geyser,
      targets: [{ kind: 'player', player: 1 }],
      x: 3,
    });
    current = resolveTop(current);
    const sameTarget = pendingDecision(current.state)?.options.find(
      (option) =>
        option.type === 'chooseSpellTargets' &&
        option.targets[0]?.kind === 'player' &&
        option.targets[0].player === 1,
    );
    if (sameTarget === undefined) throw new Error('the X-spell copy target was not offered');
    current = apply(current, sameTarget);
    expect(current.state.stack.map((entry) => entry.x)).toEqual([3, 3]);
    expect(current.state.stack.at(-1)?.targets).toEqual([{ kind: 'player', player: 1 }]);
    expect(eventsOfType(current.events, 'spellCopied').at(-1)?.chosenX).toBe(3);
  });

  it('chooses zero through six distinct targets and keeps legal survivors', () => {
    const bodies = Array.from({ length: 5 }, (_, index) => creature(`Chandra target ${String(index)}`, 7, 7));
    const zeroStart = scenario({ battlefield: [chandra(6)] });
    const zeroSource = oidOf(zeroStart.state, 'Chandra, the Firebrand');
    const zeroBegun = reduce(zeroStart.state, activation(zeroStart, zeroSource, 2));
    const zeroFinish = pendingDecision(zeroBegun.state)?.options.find(
      (option) => option.type === 'choosePluralTarget' && option.target === null,
    );
    if (zeroFinish === undefined) throw new Error('the zero-target choice was not offered');
    const zeroChosen = reduce(zeroBegun.state, zeroFinish);
    expect(zeroChosen.state.stack.at(-1)?.multiTargets?.[0]).toEqual([]);

    let current = scenario({
      battlefield: [chandra(6), ...bodies.map((card) => ({ card, controller: 1 as const }))],
    });
    const source = oidOf(current.state, 'Chandra, the Firebrand');
    current = reduce(current.state, activation(current, source, 2));

    const targets: readonly (
      { readonly kind: 'player'; readonly player: 0 } | { readonly kind: 'permanent'; readonly oid: string }
    )[] = [
      { kind: 'player', player: 0 },
      ...bodies.map((card) => ({ kind: 'permanent' as const, oid: oidOf(current.state, card.name) })),
    ];
    for (const target of targets) {
      const decision = pendingDecision(current.state);
      const action = decision?.options.find(
        (option) =>
          option.type === 'choosePluralTarget' && JSON.stringify(option.target) === JSON.stringify(target),
      );
      if (action === undefined) throw new Error('a legal Chandra ultimate target was not offered');
      current = reduce(current.state, action);
    }
    expect(
      pendingDecision(current.state)?.options.some(
        (option) => option.type === 'choosePluralTarget' && option.target !== null,
      ),
    ).toBe(false);
    expect(pendingDecision(current.state)?.kind).toBe('priority');

    const departed = targets[1];
    if (departed?.kind !== 'permanent') throw new Error('the departure probe target is not a permanent');
    current = {
      state: moveObject(beginTrace(current.state), departed.oid, 'graveyard').state,
      events: current.events,
    };
    current = resolveTop(current);
    expect(current.state.players[0].life).toBe(14);
    expect(current.state.objects[departed.oid]?.zone).toBe('graveyard');
    for (const target of targets.slice(2)) {
      if (target?.kind === 'permanent') expect(current.state.objects[target.oid]?.damage).toBe(6);
    }
  });
});
