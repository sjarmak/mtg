/** Xathrid Gorgon's persistent, target-incarnation-bound petrification. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Ability, type Card } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  counterCount,
  hasCardType,
  hasKeywordAbility,
  legalActions,
  moveObject,
  pendingDecision,
  removeCounters,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { abilities, copies, onlyObject, recolor, retype, withContinuous } from './continuous-helpers';
import { artifact, creature, SWAMP } from './cards';
import { apply, oidOf } from './helpers';

const TAP_LIFE: Ability = {
  kind: 'activated',
  cost: {
    mana: { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false },
    tapSelf: false,
    sacrificeSelf: false,
    payLife: 1,
  },
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
};

const XATHRID = parseCard({
  kind: 'creature',
  id: 'm13-118-xathrid-gorgon-kernel',
  name: 'Xathrid Gorgon',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 118 },
  manaCost: { generic: 5, B: 1 },
  colors: ['B'],
  subtypes: ['Gorgon'],
  power: 3,
  toughness: 6,
  keywords: ['deathtouch'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, B: 1 }, tapSelf: true },
      effects: [{ kind: 'petrifyCreature', target: { kind: 'targetCreature' } }],
    },
  ],
});

const TARGET = creature('Ability Bear', 2, 2, { abilities: [TAP_LIFE] });
const TEMPLATE = creature('Copied Automaton', 4, 4, { abilities: [TAP_LIFE] });

function swamps(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller: 0 as const }));
}

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: XATHRID, controller: 0 },
      { card: TARGET, controller: 1 },
      { card: TEMPLATE, controller: 1 },
      { card: creature('Copy Witness', 1, 1), controller: 1 },
      { card: artifact('Noncreature Relic'), controller: 1 },
      ...swamps(3),
    ],
  });
}

function activationAt(state: GameState, source: ObjectId, target: ObjectId) {
  return legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === source &&
      action.targets[0]?.kind === 'permanent' &&
      action.targets[0].oid === target,
  );
}

function resolve(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 4 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('petrification lost priority during resolution');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function petrify(start = board(), targetName = TARGET.name): ReduceResult {
  const source = oidOf(start.state, XATHRID.name);
  const target = oidOf(start.state, targetName);
  const action = activationAt(start.state, source, target);
  if (action === undefined) throw new Error('Xathrid Gorgon did not offer its activation');
  return resolve(apply(start, action));
}

function sourceActivation(state: GameState, source: ObjectId) {
  const sourceTurn = { ...state.turn, priority: state.objects[source]?.controller ?? 0 };
  return legalActions({ ...state, turn: sourceTurn }).find(
    (action) => action.type === 'activateAbility' && action.oid === source,
  );
}

describe('Xathrid Gorgon activation and resolution', () => {
  it('targets only a creature and rechecks the chosen incarnation', () => {
    const start = board();
    const source = oidOf(start.state, XATHRID.name);
    const target = oidOf(start.state, TARGET.name);
    const relic = oidOf(start.state, 'Noncreature Relic');
    const action = activationAt(start.state, source, target);
    if (action === undefined) throw new Error('the legal creature target was not offered');

    expect(activationAt(start.state, source, relic)).toBeUndefined();
    expect(
      validateAction(start.state, {
        ...action,
        targets: [{ kind: 'permanent', oid: relic }],
      }),
    ).toContain('illegal target');

    const activated = apply(start, action);
    const blinked = moveObject(beginTrace(activated.state), target, 'hand');
    const returned = moveObject(blinked, target, 'battlefield', { controller: 1 });
    const done = resolve({ state: returned.state, events: [...activated.events, ...returned.events] });
    expect(
      counterCount(
        done.state.objects[target]?.counters ?? { plusOnePlusOne: 0, minusOneMinusOne: 0 },
        'petrification',
      ),
    ).toBe(0);
    expect(hasCardType(done.state, target, 'artifact')).toBe(false);
  });

  it('places the marker and derives defender, colorless artifact, and the activation lock', () => {
    const done = petrify();
    const target = oidOf(done.state, TARGET.name);

    expect(
      counterCount(
        done.state.objects[target]?.counters ?? { plusOnePlusOne: 0, minusOneMinusOne: 0 },
        'petrification',
      ),
    ).toBe(1);
    expect(hasKeywordAbility(done.state, target, 'defender')).toBe(true);
    expect(hasCardType(done.state, target, 'creature')).toBe(true);
    expect(hasCardType(done.state, target, 'artifact')).toBe(true);
    expect(characteristicsOf(done.state, target).colors).toEqual([]);
    expect(sourceActivation(done.state, target)).toBeUndefined();
    expect(
      validateAction(
        { ...done.state, turn: { ...done.state.turn, priority: 1 } },
        {
          type: 'activateAbility',
          player: 1,
          oid: target,
          abilityIndex: 0,
          targets: [null],
          sacrifices: [],
        },
      ),
    ).toBe("this permanent's activated abilities can't be activated");
  });

  it('outlives its source and counter, but ends at the subject zone-change boundary', () => {
    const done = petrify();
    const source = oidOf(done.state, XATHRID.name);
    const target = oidOf(done.state, TARGET.name);
    const sourceGone = moveObject(beginTrace(done.state), source, 'graveyard');
    const noMarker = removeCounters(sourceGone, target, 'petrification', 1).trace;

    expect(hasCardType(noMarker.state, target, 'artifact')).toBe(true);
    expect(hasKeywordAbility(noMarker.state, target, 'defender')).toBe(true);
    expect(sourceActivation(noMarker.state, target)).toBeUndefined();

    const left = moveObject(noMarker, target, 'hand');
    const returned = moveObject(left, target, 'battlefield', { controller: 1 });
    expect(hasCardType(returned.state, target, 'artifact')).toBe(false);
    expect(hasKeywordAbility(returned.state, target, 'defender')).toBe(false);
    expect(characteristicsOf(returned.state, target).colors).toEqual([]);
    expect(sourceActivation(returned.state, target)).toBeDefined();
  });

  it('locks copied and later-granted activations without making the lock copiable', () => {
    const start = board();
    const target = oidOf(start.state, TARGET.name);
    const template = oidOf(start.state, TEMPLATE.name);
    const witness = oidOf(start.state, 'Copy Witness');
    const copiedBefore = {
      ...start,
      state: withContinuous(start.state, [copies(onlyObject(target), template)]),
    };
    const done = petrify(copiedBefore);

    const granted = withContinuous(done.state, [
      abilities(onlyObject(target), { addAbilities: [TAP_LIFE] }, { ts: done.state.nextId + 1 }),
    ]);
    expect(
      characteristicsOf(granted, target).abilities.filter((ability) => ability.kind === 'activated'),
    ).toHaveLength(2);
    expect(sourceActivation(granted, target)).toBeUndefined();

    const witnessCopiesTarget = withContinuous(granted, [
      copies(onlyObject(witness), target, { ts: granted.nextId + 2 }),
    ]);
    expect(
      characteristicsOf(witnessCopiesTarget, witness).abilities.some(
        (ability) => ability.kind === 'activated',
      ),
    ).toBe(true);
    expect(sourceActivation(witnessCopiesTarget, witness)).toBeDefined();
  });

  it('participates in timestamped layers while keeping activation prohibition independent', () => {
    const start = board();
    const target = oidOf(start.state, TARGET.name);
    const older = withContinuous(start.state, [
      recolor(onlyObject(target), ['R'], [], { ts: 0 }),
      retype(onlyObject(target), { removeTypes: ['artifact'] }, { ts: 0 }),
    ]);
    const done = petrify({ ...start, state: older });

    expect(characteristicsOf(done.state, target).colors).toEqual([]);
    expect(hasCardType(done.state, target, 'artifact')).toBe(true);

    const newer = withContinuous(done.state, [
      recolor(onlyObject(target), ['R'], [], { ts: done.state.nextId + 1 }),
      retype(onlyObject(target), { removeTypes: ['artifact'] }, { ts: done.state.nextId + 2 }),
      abilities(
        onlyObject(target),
        { removeAbilities: [{ kind: 'defender' }] },
        { ts: done.state.nextId + 3 },
      ),
    ]);
    expect(characteristicsOf(newer, target).colors).toEqual(['R']);
    expect(hasCardType(newer, target, 'artifact')).toBe(false);
    expect(hasKeywordAbility(newer, target, 'defender')).toBe(false);
    expect(sourceActivation(newer, target)).toBeUndefined();
  });
});
