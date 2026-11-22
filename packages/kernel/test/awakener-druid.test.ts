/** Awakener Druid's source-incarnation-bound land animation through CR 613. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Effect } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  characteristicsOf,
  controllerOf,
  eligibleBlockers,
  hasCardType,
  hasSubtype,
  manaSourceColorsOf,
  moveObject,
  pendingDecision,
  powerOf,
  scenario,
  stateFingerprint,
  toughnessOf,
  validateBlocks,
} from '@mtg/kernel';
import { applyEffect } from '../src/effects';
import { creature, FOREST } from './cards';
import { controlledBy, onlyObject, withContinuous } from './continuous-helpers';
import { apply, handOidOf, oidOf, oidsOf } from './helpers';

const ANIMATE: Extract<Effect, { kind: 'animateLandWhileSourceOnBattlefield' }> = {
  kind: 'animateLandWhileSourceOnBattlefield',
  power: 4,
  toughness: 5,
  colors: ['G'],
  subtypes: ['Treefolk'],
  target: { kind: 'targetPermanent', filter: { subtypes: ['Forest'] } },
};

const AWAKENER = creature('Awakener Druid', 1, 1, {
  cost: { generic: 2, G: 1 },
  subtypes: ['Human', 'Druid'],
  abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [ANIMATE] }],
});

const ATTACKER = creature('Attacker', 2, 2, { cost: { generic: 2 } });

const CLONE = parseCard({
  kind: 'creature',
  id: 'awakener-clone',
  name: 'Clone',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 49 },
  manaCost: {},
  colors: [],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

interface Board {
  readonly state: GameState;
  readonly source: ObjectId;
  readonly forest: ObjectId;
}

function board(): Board {
  const start = scenario({
    battlefield: [
      { card: AWAKENER, controller: 0 },
      { card: FOREST, controller: 0 },
    ],
  });
  return {
    state: start.state,
    source: oidOf(start.state, 'Awakener Druid'),
    forest: oidOf(start.state, 'Forest'),
  };
}

function animate(state: GameState, source: ObjectId, forest: ObjectId): ReduceResult {
  const incarnation = state.objects[source]?.incarnation ?? 0;
  return applyEffect(
    beginTrace(state),
    source,
    0,
    ANIMATE,
    { kind: 'permanent', oid: forest },
    0,
    null,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    incarnation,
  );
}

function resolveAnimation(subject: Board): GameState {
  return animate(subject.state, subject.source, subject.forest).state;
}

function passUntilNotPriority(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the Awakener Druid stack did not settle');
}

function recordPasses(from: ReduceResult): {
  readonly result: ReduceResult;
  readonly actions: readonly Action[];
} {
  let current = from;
  let actions: readonly Action[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority' || current.state.stack.length === 0) {
      return { result: current, actions };
    }
    const action: Action = { type: 'passPriority', player: decision.player };
    actions = [...actions, action];
    current = apply(current, action);
  }
  throw new Error('the Awakener Druid action recording did not settle');
}

function enterAndAim(): {
  readonly aimed: ReduceResult;
  readonly source: ObjectId;
  readonly forest: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
    ],
    hands: [[AWAKENER], []],
  });
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, 'Awakener Druid'),
    targets: [],
  });
  const choosing = passUntilNotPriority(cast);
  const decision = pendingDecision(choosing.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('the entry trigger did not ask for a Forest');
  const forest = oidsOf(choosing.state, 'Forest')[0];
  if (forest === undefined) throw new Error('the target Forest disappeared');
  return {
    aimed: apply(choosing, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: decision.oid,
      targets: [{ kind: 'permanent', oid: forest }],
    }),
    source: oidOf(choosing.state, 'Awakener Druid'),
    forest,
  };
}

describe('the layered animation', () => {
  it('records the three-layer change as one truthful animation event', () => {
    const subject = board();
    const resolved = animate(subject.state, subject.source, subject.forest);

    expect(resolved.events).toEqual([
      {
        type: 'permanentAnimated',
        effectIds: resolved.state.continuous.map((effect) => effect.id),
        sourceOid: subject.source,
        targetOid: subject.forest,
        power: 4,
        toughness: 5,
        colors: ['G'],
        subtypes: ['Treefolk'],
      },
    ]);
  });

  it('adds creature and Treefolk, sets green and base 4/5, and keeps land, Forest, and mana', () => {
    const subject = board();
    const state = resolveAnimation(subject);

    expect(hasCardType(state, subject.forest, 'land')).toBe(true);
    expect(hasCardType(state, subject.forest, 'creature')).toBe(true);
    expect(hasSubtype(state, subject.forest, 'Forest')).toBe(true);
    expect(hasSubtype(state, subject.forest, 'Treefolk')).toBe(true);
    expect(characteristicsOf(state, subject.forest).colors).toEqual(['G']);
    expect(powerOf(state, subject.forest)).toBe(4);
    expect(toughnessOf(state, subject.forest)).toBe(5);
    expect(manaSourceColorsOf(state, subject.forest)).toEqual(['G']);
    expect(state.continuous.map((effect) => effect.layer)).toEqual(['4', '5', '7b']);
    expect(new Set(state.continuous.map((effect) => effect.timestamp)).size).toBe(1);
  });

  it('accepts the animated land as a blocker after offering it as one', () => {
    const start = scenario({
      battlefield: [
        { card: AWAKENER, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: ATTACKER, controller: 1 },
      ],
    }).state;
    const source = oidOf(start, 'Awakener Druid');
    const forest = oidOf(start, 'Forest');
    const attacker = oidOf(start, 'Attacker');
    const animated = animate(start, source, forest).state;
    const attacking: GameState = {
      ...animated,
      turn: { ...animated.turn, active: 1 },
      combat: { ...animated.combat, attacks: [{ oid: attacker, defender: 0 }] },
    };

    expect(eligibleBlockers(attacking)).toContain(forest);
    expect(validateBlocks(attacking, 0, [{ blocker: forest, attacker }])).toBeNull();
  });
});

describe('the linked lifetime', () => {
  it('expires every layer together when the source leaves', () => {
    const subject = board();
    const animated = resolveAnimation(subject);
    const gone = moveObject(beginTrace(animated), subject.source, 'graveyard').state;

    expect(gone.continuous).toEqual([]);
    expect(hasCardType(gone, subject.forest, 'creature')).toBe(false);
    expect(hasCardType(gone, subject.forest, 'land')).toBe(true);
  });

  it('does not follow the target through a zone change', () => {
    const subject = board();
    const animated = resolveAnimation(subject);
    const left = moveObject(beginTrace(animated), subject.forest, 'hand');
    const returned = moveObject(left, subject.forest, 'battlefield', { controller: 0 }).state;

    expect(returned.continuous).toEqual([]);
    expect(hasCardType(returned, subject.forest, 'creature')).toBe(false);
    expect(hasSubtype(returned, subject.forest, 'Treefolk')).toBe(false);
  });

  it('does not attach after the triggering source has blinked into a new incarnation', () => {
    const subject = board();
    const oldIncarnation = subject.state.objects[subject.source]?.incarnation ?? 0;
    const left = moveObject(beginTrace(subject.state), subject.source, 'graveyard');
    const returned = moveObject(left, subject.source, 'battlefield', { controller: 0 });
    const resolved = applyEffect(
      returned,
      subject.source,
      0,
      ANIMATE,
      { kind: 'permanent', oid: subject.forest },
      0,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      oldIncarnation,
    ).state;

    expect(resolved.continuous).toEqual([]);
    expect(hasCardType(resolved, subject.forest, 'creature')).toBe(false);
  });

  it('survives controller changes to both source and target', () => {
    const subject = board();
    const animated = resolveAnimation(subject);
    const changed = withContinuous(animated, [
      controlledBy(onlyObject(subject.source), 1, { ts: 100 }),
      controlledBy(onlyObject(subject.forest), 1, { ts: 101 }),
    ]);

    expect(controllerOf(changed, subject.source)).toBe(1);
    expect(controllerOf(changed, subject.forest)).toBe(1);
    expect(hasCardType(changed, subject.forest, 'creature')).toBe(true);
    expect(powerOf(changed, subject.forest)).toBe(4);
    expect(toughnessOf(changed, subject.forest)).toBe(5);
  });

  it('keeps independent source lifetimes when two Druids animate the same Forest', () => {
    const start = scenario({
      battlefield: [
        { card: AWAKENER, controller: 0 },
        { card: AWAKENER, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    }).state;
    const sources = oidsOf(start, 'Awakener Druid');
    const first = sources[0];
    const second = sources[1];
    if (first === undefined || second === undefined) throw new Error('the two Druids were not created');
    const forest = oidOf(start, 'Forest');
    const twice = animate(animate(start, first, forest).state, second, forest).state;
    const oneLeft = moveObject(beginTrace(twice), first, 'graveyard').state;

    expect(oneLeft.continuous).toHaveLength(3);
    expect(hasCardType(oneLeft, forest, 'creature')).toBe(true);
    const noneLeft = moveObject(beginTrace(oneLeft), second, 'graveyard').state;
    expect(noneLeft.continuous).toEqual([]);
    expect(hasCardType(noneLeft, forest, 'creature')).toBe(false);
  });
});

describe('the real entry trigger', () => {
  it('offers a Forest, records one target, and installs the animation on resolution', () => {
    const { aimed, forest } = enterAndAim();
    const resolved = passUntilNotPriority(aimed);

    expect(hasCardType(resolved.state, forest, 'creature')).toBe(true);
    expect(powerOf(resolved.state, forest)).toBe(4);
    expect(toughnessOf(resolved.state, forest)).toBe(5);
  });

  it('installs nothing if the original source leaves before the trigger resolves', () => {
    const { aimed, source, forest } = enterAndAim();
    const removed = moveObject(beginTrace(aimed.state), source, 'graveyard');
    const resolved = passUntilNotPriority({
      state: removed.state,
      events: [...aimed.events, ...removed.events],
    });

    expect(resolved.state.continuous).toEqual([]);
    expect(hasCardType(resolved.state, forest, 'creature')).toBe(false);
  });

  it('fizzles if the targeted Forest leaves before resolution', () => {
    const { aimed, forest } = enterAndAim();
    const removed = moveObject(beginTrace(aimed.state), forest, 'graveyard');
    const resolved = passUntilNotPriority({
      state: removed.state,
      events: [...aimed.events, ...removed.events],
    });

    expect(resolved.state.continuous).toEqual([]);
  });

  it('lets a Clone copying Awakener Druid create its own source-bound animation', () => {
    const start = scenario({
      battlefield: [
        { card: AWAKENER, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[CLONE], []],
    });
    const original = oidOf(start.state, 'Awakener Druid');
    const forest = oidOf(start.state, 'Forest');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Clone'),
      targets: [],
    });
    const awaitingCopy = passUntilNotPriority(cast);
    const copyAction = pendingDecision(awaitingCopy.state)?.options.find(
      (option) => option.type === 'chooseEntryCopy' && option.copyOf === original,
    );
    if (copyAction === undefined) throw new Error('Clone did not offer Awakener Druid');
    const entered = apply(awaitingCopy, copyAction);
    const targetDecision = pendingDecision(entered.state);
    if (targetDecision?.kind !== 'triggerTargets')
      throw new Error('the copied entry trigger chose no target');
    const aimed = apply(entered, {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: targetDecision.oid,
      targets: [{ kind: 'permanent', oid: forest }],
    });
    const animated = passUntilNotPriority(aimed).state;
    const clone = animated.battlefield.find((oid) => animated.objects[oid]?.card.id === CLONE.id);
    if (clone === undefined) throw new Error('the copied Druid disappeared');

    const originalGone = moveObject(beginTrace(animated), original, 'graveyard').state;
    expect(hasCardType(originalGone, forest, 'creature')).toBe(true);
    const cloneGone = moveObject(beginTrace(originalGone), clone, 'graveyard').state;
    expect(hasCardType(cloneGone, forest, 'creature')).toBe(false);
  });

  it('replays the recorded resolution choices to identical state and event bytes', () => {
    const { aimed } = enterAndAim();
    const first = recordPasses(aimed);
    const replayed = first.actions.reduce(
      (current, action) => apply(current, structuredClone(action)),
      structuredClone(aimed),
    );

    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(first.result.state));
    expect(replayed.events).toEqual(first.result.events);
  });
});
