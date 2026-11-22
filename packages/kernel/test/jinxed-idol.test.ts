/** Native Jinxed Idol execution, including the source-incarnation boundary. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  controllerOf,
  eventsOfType,
  legalActions,
  moveObject,
  objectFilter,
  onlyObject,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature } from './cards';
import { controlledBy } from './continuous-helpers';
import { oidOf } from './helpers';

const JINXED_IDOL = parseCard({
  kind: 'artifact',
  id: 'm11-208-jinxed-idol-kernel',
  name: 'Jinxed Idol',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 208 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
      effects: [
        {
          kind: 'targetPlayerGainsControlOfSelfPermanent',
          target: { kind: 'targetOpponent' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const ALLY = creature('Idol Fodder', 1, 1);
const ENEMY = creature('Enemy Creature', 2, 2);
const SCRYING_IDOL = parseCard({
  ...JINXED_IDOL,
  id: 'm11-208-jinxed-idol-scrying-kernel',
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        { kind: 'scry', count: 1 },
        {
          kind: 'targetPlayerGainsControlOfSelfPermanent',
          target: { kind: 'targetOpponent' },
        },
      ],
    },
  ],
} as unknown as CardInput);
const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function activation(start: ReduceResult): Extract<Action, { type: 'activateAbility' }> {
  const idol = oidOf(start.state, JINXED_IDOL.name);
  const fodder = oidOf(start.state, ALLY.name);
  const found = legalActions(start.state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === idol && action.sacrifices[0] === fodder,
  );
  if (found === undefined) throw new Error('Jinxed Idol activation was not offered');
  return found;
}

function resolve(current: ReduceResult): ReduceResult {
  const resolved = reduceAll(current.state, PASSES);
  return { state: resolved.state, events: [...current.events, ...resolved.events] };
}

describe('Jinxed Idol in the kernel', () => {
  it('pays the creature sacrifice before responses, then gives the same permanent to the target opponent', () => {
    const start = scenario({
      battlefield: [
        { card: JINXED_IDOL, controller: 0 },
        { card: ALLY, controller: 0 },
        { card: ENEMY, controller: 1 },
      ],
    });
    const idol = oidOf(start.state, JINXED_IDOL.name);
    const fodder = oidOf(start.state, ALLY.name);
    const enemy = oidOf(start.state, ENEMY.name);
    const action = activation(start);

    expect(action.targets).toEqual([{ kind: 'player', player: 1 }]);
    expect(action.sacrifices).toEqual([fodder]);
    expect(action.sacrifices).not.toContain(enemy);

    const announced = reduce(start.state, action);
    expect(announced.state.objects[fodder]?.zone).toBe('graveyard');
    expect(controllerOf(announced.state, idol)).toBe(0);
    expect(announced.state.stack).toHaveLength(1);

    const done = resolve(announced);
    expect(controllerOf(done.state, idol)).toBe(1);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([
      expect.objectContaining({ targetOid: idol, controller: 1, layer: '2' }),
    ]);
    expect(done.state.continuous).toContainEqual(
      expect.objectContaining({
        kind: 'control',
        affects: objectFilter({ oids: [idol] }),
        controller: 1,
        duration: 'whileSubjectRemains',
      }),
    );

    const left = moveObject(beginTrace(done.state), idol, 'graveyard');
    const returned = moveObject(left, idol, 'battlefield', { controller: 0 });
    expect(controllerOf(returned.state, idol)).toBe(0);
    expect(eventsOfType(returned.events, 'continuousEffectsExpired')).toHaveLength(1);
  });

  it('does not transfer the new object when the source leaves and returns before resolution', () => {
    const start = scenario({
      battlefield: [
        { card: JINXED_IDOL, controller: 0 },
        { card: ALLY, controller: 0 },
      ],
    });
    const idol = oidOf(start.state, JINXED_IDOL.name);
    const announced = reduce(start.state, activation(start));
    const left = moveObject(beginTrace(announced.state), idol, 'graveyard');
    const returned = moveObject(left, idol, 'battlefield', { controller: 0 });
    const done = resolve({ state: returned.state, events: [...announced.events, ...returned.events] });

    expect(controllerOf(done.state, idol)).toBe(0);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
  });

  it('rechecks the source incarnation when a paused resolution resumes', () => {
    const start = scenario({
      battlefield: [{ card: SCRYING_IDOL, controller: 0 }],
      libraries: [[ALLY], [ENEMY]],
    });
    const idol = oidOf(start.state, SCRYING_IDOL.name);
    const action = legalActions(start.state).find(
      (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
        candidate.type === 'activateAbility' && candidate.oid === idol,
    );
    if (action === undefined) throw new Error('scrying Jinxed Idol activation was not offered');

    const announced = reduce(start.state, action);
    const paused = reduceAll(announced.state, PASSES);
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'scry') throw new Error('Jinxed Idol resolution did not pause for scry');
    const answer = decision.options.find(
      (candidate): candidate is Extract<Action, { type: 'scry' }> => candidate.type === 'scry',
    );
    if (answer === undefined) throw new Error('Jinxed Idol scry had no answer');

    const left = moveObject(beginTrace(paused.state), idol, 'graveyard');
    const returned = moveObject(left, idol, 'battlefield', { controller: 0 });
    const done = reduce(returned.state, answer);

    expect(controllerOf(done.state, idol)).toBe(0);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([]);
  });

  it('damages the controller fixed when the upkeep trigger fired even if the permanent changes control', () => {
    const fired = scenario({
      battlefield: [{ card: JINXED_IDOL, controller: 0 }],
      active: 1,
      step: 'upkeep',
    });
    const idol = oidOf(fired.state, JINXED_IDOL.name);
    expect(fired.state.turn.active).toBe(0);
    expect(fired.state.stack).toHaveLength(1);

    const changed = {
      ...fired.state,
      continuous: [...fired.state.continuous, controlledBy(onlyObject(idol), 1)],
    };
    expect(controllerOf(changed, idol)).toBe(1);

    const done = reduceAll(changed, PASSES);
    expect(done.state.players.map((player) => player.life)).toEqual([18, 20]);
    expect(eventsOfType(done.events, 'damageDealt')).toEqual([
      expect.objectContaining({ sourceOid: idol, target: { kind: 'player', player: 0 }, amount: 2 }),
    ]);
  });
});
