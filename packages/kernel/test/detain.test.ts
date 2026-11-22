/** Hostile lifetime, combat, activation, overlap, and incarnation probes for Detain. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  canBlock,
  detainPermanent,
  eligibleAttackers,
  eligibleBlockers,
  isDetained,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import { beginTurn } from '../src/turn';
import { artifact, creature, instant } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const TARGET = creature('Detain Target', 2, 2);
const ATTACKER = creature('Free Attacker', 2, 2);
const SOURCE = creature('Detain Source', 1, 1);
const DETAIN = instant(
  'Detain Probe',
  [{ kind: 'detainPermanent', target: { kind: 'targetCreatureOpponentControls' } }],
  {},
);
const DETAIN_TWO = instant(
  'Double Detain Probe',
  [
    {
      kind: 'detainPermanent',
      target: { kind: 'targetNonlandPermanentOpponentControls', count: 2 },
    },
  ],
  {},
);

const ORDINARY: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
};
const MANA: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
};
const ROCK = artifact('Detained Rock', { generic: 2 }, [ORDINARY, MANA]);

function castAndResolve(start: ReduceResult, target: ObjectId): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, DETAIN.name),
    targets: [{ kind: 'permanent', oid: target }],
  });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function advanceTo(current: ReduceResult, step: GameState['turn']['step']): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 30; guard += 1) {
    if (walked.state.turn.step === step) return walked;
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error(`stopped on ${String(decision?.kind)}`);
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error(`never reached ${step}`);
}

function ruleState(): {
  readonly state: GameState;
  readonly source: ObjectId;
  readonly target: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: SOURCE, controller: 0 },
      { card: TARGET, controller: 1 },
    ],
  });
  const source = oidOf(start.state, SOURCE.name);
  const target = oidOf(start.state, TARGET.name);
  return { state: detainPermanent(start.state, source, target, 0), source, target };
}

describe('DetentionRule creation and lifetime', () => {
  it('resolves the DSL effect into a live detention', () => {
    const start = scenario({
      battlefield: [{ card: TARGET, controller: 1 }],
      hands: [[DETAIN], []],
    });
    const target = oidOf(start.state, TARGET.name);
    const resolved = castAndResolve(start, target);

    expect(isDetained(start.state, target)).toBe(false);
    expect(isDetained(resolved.state, target)).toBe(true);
  });

  it('does not detain a target that changed zones before the spell resolved', () => {
    const start = scenario({
      battlefield: [{ card: TARGET, controller: 1 }],
      hands: [[DETAIN], []],
    });
    const target = oidOf(start.state, TARGET.name);
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, DETAIN.name),
      targets: [{ kind: 'permanent', oid: target }],
    });
    const departed = moveObject(beginTrace(cast.state), target, 'graveyard');
    const resolved = reduceAll(departed.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    expect(isDetained(resolved.state, target)).toBe(false);
  });

  it('does not require a live source object', () => {
    const start = scenario({ battlefield: [{ card: TARGET, controller: 1 }] });
    const target = oidOf(start.state, TARGET.name);
    const source = 'copy-detain-source' as ObjectId;
    const detained = detainPermanent(start.state, source, target, 0);

    expect(isDetained(start.state, target)).toBe(false);
    expect(isDetained(detained, target)).toBe(true);
  });

  it('survives source departure and control change but is swept with its subject', () => {
    const subject = ruleState();
    const changedSource: GameState = {
      ...subject.state,
      objects: {
        ...subject.state.objects,
        [subject.source]: { ...subject.state.objects[subject.source]!, controller: 1 },
      },
    };
    expect(isDetained(changedSource, subject.target)).toBe(true);
    const sourceGone = moveObject(beginTrace(changedSource), subject.source, 'graveyard');
    expect(isDetained(sourceGone.state, subject.target)).toBe(true);
    const targetGone = moveObject(sourceGone, subject.target, 'graveyard');
    expect(isDetained(targetGone.state, subject.target)).toBe(false);
  });

  it('expires only rules belonging to the seat whose next turn begins', () => {
    const start = scenario({
      battlefield: [
        { card: SOURCE, controller: 0 },
        { card: creature('Other Source', 1, 1), controller: 1 },
        { card: TARGET, controller: 1 },
      ],
    });
    const target = oidOf(start.state, TARGET.name);
    const first = detainPermanent(start.state, oidOf(start.state, SOURCE.name), target, 0);
    const overlapped = detainPermanent(first, oidOf(first, 'Other Source'), target, 1);

    const zeroBegan = beginTurn(beginTrace(overlapped), 0);
    expect(isDetained(zeroBegan.state, target)).toBe(true);
    const oneBegan = beginTurn(beginTrace(zeroBegan.state), 1);
    expect(isDetained(oneBegan.state, target)).toBe(false);
  });

  it('is immutable and participates in deterministic state identity', () => {
    const subject = ruleState();
    const withoutRule = { ...subject.state, detentions: [] };

    expect(isDetained(subject.state, subject.target)).toBe(true);
    expect(isDetained(withoutRule, subject.target)).toBe(false);
    expect(stateFingerprint(subject.state)).not.toBe(stateFingerprint(withoutRule));
  });
});

describe('Detain legality gates', () => {
  it('enumerates and resolves each chosen permanent in an up-to-two slot', () => {
    const start = scenario({
      battlefield: [
        { card: TARGET, controller: 1 },
        { card: ROCK, controller: 1 },
        { card: SOURCE, controller: 0 },
      ],
      hands: [[DETAIN_TWO], []],
    });
    const target = oidOf(start.state, TARGET.name);
    const rock = oidOf(start.state, ROCK.name);
    const source = oidOf(start.state, SOURCE.name);
    const spell = handOidOf(start.state, 0, DETAIN_TWO.name);
    const begin = legalActions(start.state).find(
      (action) => action.type === 'beginCastSpell' && action.oid === spell,
    );
    expect(begin).toBeDefined();
    if (begin?.type !== 'beginCastSpell') return;
    const staged = reduce(start.state, begin);
    const decision = pendingDecision(staged.state);
    if (decision?.kind !== 'pluralTargets') throw new Error('plural Detain targets were not staged');
    const offered = decision.options.flatMap((action) =>
      action.type === 'choosePluralTarget' && action.target?.kind === 'permanent' ? [action.target.oid] : [],
    );
    expect(offered).toEqual(expect.arrayContaining([target, rock]));
    expect(offered).not.toContain(source);

    const announced = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'permanent', oid: target },
          { kind: 'permanent', oid: rock },
        ],
      },
    });
    const resolved = reduceAll(announced.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(isDetained(resolved.state, target)).toBe(true);
    expect(isDetained(resolved.state, rock)).toBe(true);
  });

  it('removes detained creatures from attack and block offers and rejects constructed declarations', () => {
    const start = scenario({
      battlefield: [
        { card: SOURCE, controller: 0 },
        { card: ATTACKER, controller: 0 },
        { card: TARGET, controller: 1 },
      ],
    });
    const source = oidOf(start.state, SOURCE.name);
    const attacker = oidOf(start.state, ATTACKER.name);
    const blocker = oidOf(start.state, TARGET.name);
    const detained = { ...start, state: detainPermanent(start.state, source, blocker, 0) };
    expect(eligibleBlockers(detained.state)).not.toContain(blocker);
    expect(canBlock(detained.state, blocker, attacker)).toBe(false);

    const attacking = advanceTo(detained, 'declareAttackers');
    const blocking = apply(attacking, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });
    expect(
      validateAction(blocking.state, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker, attacker }],
      }),
    ).not.toBeNull();

    const reverse = scenario({
      battlefield: [
        { card: SOURCE, controller: 1 },
        { card: TARGET, controller: 0 },
      ],
    });
    const reverseSource = oidOf(reverse.state, SOURCE.name);
    const reverseTarget = oidOf(reverse.state, TARGET.name);
    const restricted = detainPermanent(reverse.state, reverseSource, reverseTarget, 1);
    expect(eligibleAttackers(restricted)).not.toContain(reverseTarget);
    const attackState = advanceTo({ ...reverse, state: restricted }, 'declareAttackers').state;
    const action: Action = {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: reverseTarget, defender: 1 }],
    };
    expect(validateAction(attackState, action)).not.toBeNull();
  });

  it('blocks both ordinary and mana activations at enumeration and submission', () => {
    const start = scenario({
      battlefield: [
        { card: SOURCE, controller: 0 },
        { card: ROCK, controller: 1 },
      ],
    });
    const rock = oidOf(start.state, ROCK.name);
    const state = detainPermanent(start.state, oidOf(start.state, SOURCE.name), rock, 0);
    const priority: GameState = { ...state, turn: { ...state.turn, priority: 1 } };
    expect(legalActions(priority).filter((action) => 'oid' in action && action.oid === rock)).toEqual([]);
    expect(
      validateAction(priority, {
        type: 'activateAbility',
        player: 1,
        oid: rock,
        abilityIndex: 0,
        targets: [null],
        sacrifices: [],
      }),
    ).toContain('detained');
    expect(
      validateAction(priority, {
        type: 'activateManaAbility',
        player: 1,
        oid: rock,
        abilityIndex: 1,
        color: 'U',
      }),
    ).toContain('detained');
  });
});
