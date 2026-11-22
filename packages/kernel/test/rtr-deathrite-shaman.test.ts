/** Exact activation, target, ordering, and stale-target probes for RTR #213. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  playerOf,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, FOREST, instant, SWAMP } from './cards';
import { apply, oidOf } from './helpers';

const DEATHRITE_SHAMAN = parseCard({
  kind: 'creature',
  id: 'rtr-213-deathrite-shaman-kernel',
  name: 'Deathrite Shaman',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 213 },
  manaCost: { hybrid: { 'B/G': 1 } },
  colors: ['B', 'G'],
  subtypes: ['Elf', 'Shaman'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      activateOnlyAsInstantReminder: true,
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['land'] } },
        },
        { kind: 'addMana', amount: 1, produces: ['W', 'U', 'B', 'R', 'G'] },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCardInAGraveyard',
            filter: { cardTypes: ['instant', 'sorcery'] },
          },
        },
        { kind: 'loseLife', amount: 2, players: 'eachOpponent', target: { kind: 'noTarget' } },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { G: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
        },
        { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
      ],
    },
  ],
} satisfies CardInput);

const TORMOD = parseCard({
  kind: 'artifact',
  id: 'tst-deathrite-tormod',
  name: "Deathrite Tormod's Crypt",
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: {},
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
      effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }],
    },
  ],
} satisfies CardInput);

const BURIED_INSTANT = instant('Deathrite Buried Instant', [
  { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
]);
const BURIED_CREATURE = creature('Deathrite Buried Creature', 2, 2);

function targetOid(action: Extract<Action, { type: 'activateAbility' }>): ObjectId | null {
  const target = action.targets[0];
  return target?.kind === 'card' ? target.oid : null;
}

function activation(
  state: GameState,
  source: ObjectId,
  abilityIndex: number,
  target: ObjectId,
): Extract<Action, { type: 'activateAbility' }> {
  const found = legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === source &&
      action.abilityIndex === abilityIndex &&
      targetOid(action) === target,
  );
  if (found === undefined) throw new Error('Deathrite Shaman activation was not offered');
  return found;
}

function graveOid(state: GameState, player: 0 | 1, name: string): ObjectId {
  const found = playerOf(state, player).graveyard.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`${name} is missing from player ${String(player)}'s graveyard`);
  return found;
}

function passUntilChoice(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Deathrite Shaman resolution did not reach its next decision');
}

function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; current.state.stack.length > 0 && guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'no'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('Deathrite Shaman stack did not resolve');
  return current;
}

describe('RTR #213 Deathrite Shaman', () => {
  it('enumerates each printed graveyard-card filter across both graveyards', () => {
    const opened = scenario({
      battlefield: [
        { card: DEATHRITE_SHAMAN, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      graveyards: [[SWAMP, BURIED_CREATURE], [BURIED_INSTANT]],
    });
    const source = oidOf(opened.state, DEATHRITE_SHAMAN.name);
    const actions = legalActions(opened.state).filter(
      (action): action is Extract<Action, { type: 'activateAbility' }> =>
        action.type === 'activateAbility' && action.oid === source,
    );

    expect(
      actions.map((action) => {
        const target = targetOid(action);
        return [action.abilityIndex, target === null ? undefined : opened.state.objects[target]?.card.name];
      }),
    ).toEqual([
      [0, SWAMP.name],
      [1, BURIED_INSTANT.name],
      [2, BURIED_CREATURE.name],
    ]);
    expect(
      legalActions(opened.state).some(
        (action) => action.type === 'activateManaAbility' && action.oid === source,
      ),
    ).toBe(false);
  });

  it('uses the stack, exiles first, then offers exactly five colors and adds the chosen mana', () => {
    const opened = scenario({
      battlefield: [{ card: DEATHRITE_SHAMAN, controller: 0 }],
      graveyards: [[], [SWAMP]],
    });
    const source = oidOf(opened.state, DEATHRITE_SHAMAN.name);
    const land = graveOid(opened.state, 1, SWAMP.name);
    const activated = apply(opened, activation(opened.state, source, 0, land));

    expect(activated.state.stack).toHaveLength(1);
    expect(activated.state.objects[source]?.tapped).toBe(true);
    expect(playerOf(activated.state, 0).pool).toEqual(expect.objectContaining({ G: 0 }));

    const asked = passUntilChoice(activated);
    const decision = pendingDecision(asked.state);
    expect(asked.state.objects[land]?.zone).toBe('exile');
    expect(decision?.kind).toBe('manaColor');
    if (decision?.kind !== 'manaColor') throw new Error('mana color was not requested');
    expect(decision.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(decision.options).toEqual(
      ['W', 'U', 'B', 'R', 'G'].map((color) => ({ type: 'chooseManaColor', player: 0, color })),
    );

    const done = apply(asked, { type: 'chooseManaColor', player: 0, color: 'G' });
    expect(eventsOfType(done.events, 'manaProduced')).toContainEqual(
      expect.objectContaining({ player: 0, color: 'G', amount: 1 }),
    );
    expect(playerOf(done.state, 0).pool.G).toBe(1);
    expect(done.state.pendingManaColorChoice).toBeUndefined();
  });

  it('fizzles without a color choice when the targeted land leaves the graveyard in response', () => {
    let current = scenario({
      battlefield: [
        { card: DEATHRITE_SHAMAN, controller: 0 },
        { card: TORMOD, controller: 1 },
      ],
      graveyards: [[SWAMP], []],
    });
    const shaman = oidOf(current.state, DEATHRITE_SHAMAN.name);
    const crypt = oidOf(current.state, TORMOD.name);
    const land = graveOid(current.state, 0, SWAMP.name);
    current = apply(current, activation(current.state, shaman, 0, land));
    current = apply(current, { type: 'passPriority', player: 0 });
    const cryptAction = legalActions(current.state).find(
      (action): action is Extract<Action, { type: 'activateAbility' }> =>
        action.type === 'activateAbility' &&
        action.oid === crypt &&
        action.targets[0]?.kind === 'player' &&
        action.targets[0].player === 0,
    );
    if (cryptAction === undefined) throw new Error("Tormod's Crypt response was not offered");
    const done = resolveStack(apply(current, cryptAction));

    expect(done.state.objects[land]?.zone).toBe('exile');
    expect(pendingDecision(done.state)?.kind).not.toBe('manaColor');
    expect(playerOf(done.state, 0).pool).toEqual(expect.objectContaining({ W: 0, U: 0, B: 0, R: 0, G: 0 }));
    expect(eventsOfType(done.events, 'effectSkipped')).toContainEqual(
      expect.objectContaining({ why: 'target is no longer legal' }),
    );
  });

  it('pays black, exiles an instant, then makes each opponent lose 2 life', () => {
    const opened = scenario({
      battlefield: [
        { card: DEATHRITE_SHAMAN, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
      graveyards: [[], [BURIED_INSTANT]],
    });
    const source = oidOf(opened.state, DEATHRITE_SHAMAN.name);
    const target = graveOid(opened.state, 1, BURIED_INSTANT.name);
    const done = resolveStack(apply(opened, activation(opened.state, source, 1, target)));

    expect(done.state.objects[target]?.zone).toBe('exile');
    expect(playerOf(done.state, 1).life).toBe(18);
  });

  it('pays green, exiles a creature, then gains its controller 2 life', () => {
    const opened = scenario({
      life: [15, 20],
      battlefield: [
        { card: DEATHRITE_SHAMAN, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      graveyards: [[BURIED_CREATURE], []],
    });
    const source = oidOf(opened.state, DEATHRITE_SHAMAN.name);
    const target = graveOid(opened.state, 0, BURIED_CREATURE.name);
    const done = resolveStack(apply(opened, activation(opened.state, source, 2, target)));

    expect(done.state.objects[target]?.zone).toBe('exile');
    expect(playerOf(done.state, 0).life).toBe(17);
  });
});
