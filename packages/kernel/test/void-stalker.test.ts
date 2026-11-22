/** Void Stalker: one target, two owner-directed moves, then one shuffle per affected library. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { controlledBy, copies, onlyObject, withContinuous } from './continuous-helpers';
import { creature, ISLAND, lands } from './cards';
import { apply, oidOf } from './helpers';

const VOID_STALKER = parseCard({
  kind: 'creature',
  id: 'm13-77-void-stalker-kernel',
  name: 'Void Stalker',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 77 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Elemental'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, U: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'putSourceAndTargetOnOwnersLibrariesThenShuffle',
          target: { kind: 'targetCreature' },
        },
      ],
    },
  ],
});

const BLANK = creature('Void Stalker Copy Candidate', 1, 1);
const TARGET = creature('Void Stalker Target', 3, 3);

function namedLibrary(prefix: string): readonly Card[] {
  return Array.from({ length: 5 }, (_, index) => creature(`${prefix} ${String(index + 1)}`, 1, 1));
}

function activations(
  state: GameState,
  source: ObjectId,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
}

function activationToward(state: GameState, source: ObjectId, target: ObjectId) {
  const action = activations(state, source).find(
    (candidate) => candidate.targets[0]?.kind === 'permanent' && candidate.targets[0].oid === target,
  );
  if (action === undefined) throw new Error('Void Stalker did not offer the expected target');
  return action;
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 4 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('Void Stalker lost priority during resolution');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

function appendResult(current: ReduceResult, next: ReduceResult): ReduceResult {
  return { state: next.state, events: [...current.events, ...next.events] };
}

function payableBoard(targetController: 0 | 1 = 1, targetToken = false): ReduceResult {
  return scenario({
    battlefield: [
      { card: VOID_STALKER, controller: 0 },
      ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
      { card: TARGET, controller: targetController, token: targetToken },
    ],
    libraries: [[...namedLibrary('Mine')], [...namedLibrary('Theirs')]],
    seed: 'void-stalker',
  });
}

describe('Void Stalker activation legality and payment', () => {
  it('offers every creature including itself, and pays exactly {2}{U} plus tapping the source', () => {
    const start = payableBoard();
    const source = oidOf(start.state, VOID_STALKER.name);
    const target = oidOf(start.state, TARGET.name);
    const options = activations(start.state, source);

    expect(options.map((action) => action.targets[0])).toEqual(
      expect.arrayContaining([
        { kind: 'permanent', oid: source },
        { kind: 'permanent', oid: target },
      ]),
    );

    const activated = reduce(start.state, activationToward(start.state, source, target));
    expect(activated.state.objects[source]?.tapped).toBe(true);
    expect(eventsOfType(activated.events, 'manaPaid')).toEqual([
      expect.objectContaining({ cost: expect.objectContaining({ generic: 2, U: 1 }) }),
    ]);
  });

  it('is absent while summoning sick, tapped, or short on mana and rejects an illegal noncreature target', () => {
    const sick = scenario({ battlefield: [{ card: VOID_STALKER, controller: 0, summoningSick: true }] });
    expect(activations(sick.state, oidOf(sick.state, VOID_STALKER.name))).toEqual([]);

    const tapped = scenario({
      battlefield: [
        { card: VOID_STALKER, controller: 0, tapped: true },
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    expect(activations(tapped.state, oidOf(tapped.state, VOID_STALKER.name))).toEqual([]);

    const short = scenario({
      battlefield: [
        { card: VOID_STALKER, controller: 0 },
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    expect(activations(short.state, oidOf(short.state, VOID_STALKER.name))).toEqual([]);

    const payable = payableBoard();
    const source = oidOf(payable.state, VOID_STALKER.name);
    const land = payable.state.battlefield.find((oid) => payable.state.objects[oid]?.card.kind === 'land');
    if (land === undefined) throw new Error('Void Stalker probe found no land');
    const offered = activations(payable.state, source)[0];
    if (offered === undefined) throw new Error('Void Stalker probe found no activation');
    expect(
      validateAction(payable.state, {
        ...offered,
        targets: [{ kind: 'permanent', oid: land }],
      }),
    ).toContain('illegal target');
  });
});

describe('Void Stalker resolution', () => {
  it('moves both objects before shuffling each different owner library once', () => {
    const start = payableBoard();
    const source = oidOf(start.state, VOID_STALKER.name);
    const target = oidOf(start.state, TARGET.name);
    const done = resolveTop(apply(start, activationToward(start.state, source, target)));

    expect(done.state.objects[source]?.zone).toBe('library');
    expect(done.state.objects[target]?.zone).toBe('library');
    expect(done.state.players[0].library).toContain(source);
    expect(done.state.players[1].library).toContain(target);
    expect(eventsOfType(done.events, 'libraryShuffled').map((event) => event.player)).toEqual([0, 1]);

    const resolution = done.events.slice(done.events.findIndex((event) => event.type === 'resolutionBegan'));
    expect(resolution.map((event) => event.type)).toEqual([
      'resolutionBegan',
      'zoneChanged',
      'zoneChanged',
      'libraryShuffled',
      'libraryShuffled',
      'priorityGained',
    ]);
  });

  it('moves two same-owner creatures but shuffles that library only once, including self-targeting', () => {
    const start = payableBoard(0);
    const source = oidOf(start.state, VOID_STALKER.name);
    const target = oidOf(start.state, TARGET.name);
    const paired = resolveTop(apply(start, activationToward(start.state, source, target)));
    expect(paired.state.players[0].library).toEqual(expect.arrayContaining([source, target]));
    expect(eventsOfType(paired.events, 'libraryShuffled').map((event) => event.player)).toEqual([0]);

    const selfStart = payableBoard();
    const self = oidOf(selfStart.state, VOID_STALKER.name);
    const selfDone = resolveTop(apply(selfStart, activationToward(selfStart.state, self, self)));
    expect(selfDone.state.players[0].library.filter((oid) => oid === self)).toHaveLength(1);
    expect(eventsOfType(selfDone.events, 'libraryShuffled').map((event) => event.player)).toEqual([0]);
  });

  it('moves a token through its owner library, shuffles that library, then lets the token cease to exist', () => {
    const start = payableBoard(1, true);
    const source = oidOf(start.state, VOID_STALKER.name);
    const token = oidOf(start.state, TARGET.name);
    const done = resolveTop(apply(start, activationToward(start.state, source, token)));

    expect(done.state.objects[token]?.zone).toBe('exile');
    expect(done.state.players[1].library).not.toContain(token);
    expect(eventsOfType(done.events, 'zoneChanged')).toContainEqual(
      expect.objectContaining({ oid: token, from: 'battlefield', to: 'library', owner: 1 }),
    );
    expect(eventsOfType(done.events, 'libraryShuffled').map((event) => event.player)).toEqual([0, 1]);
  });

  it('resolves for the legal target when the source is gone or reentered, but fizzles for an illegal target', () => {
    const missingStart = payableBoard();
    const missingSource = oidOf(missingStart.state, VOID_STALKER.name);
    const legalTarget = oidOf(missingStart.state, TARGET.name);
    let missing = apply(missingStart, activationToward(missingStart.state, missingSource, legalTarget));
    missing = appendResult(missing, moveObject(beginTrace(missing.state), missingSource, 'graveyard'));
    const resolved = resolveTop(missing);
    expect(resolved.state.objects[missingSource]?.zone).toBe('graveyard');
    expect(resolved.state.objects[legalTarget]?.zone).toBe('library');
    expect(eventsOfType(resolved.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);

    const reenteredStart = payableBoard();
    const oldSource = oidOf(reenteredStart.state, VOID_STALKER.name);
    const reenteredTarget = oidOf(reenteredStart.state, TARGET.name);
    let reentered = apply(reenteredStart, activationToward(reenteredStart.state, oldSource, reenteredTarget));
    reentered = appendResult(reentered, moveObject(beginTrace(reentered.state), oldSource, 'graveyard'));
    reentered = appendResult(
      reentered,
      moveObject(beginTrace(reentered.state), oldSource, 'battlefield', { controller: 0 }),
    );
    const reenteredDone = resolveTop(reentered);
    expect(reenteredDone.state.objects[oldSource]?.zone).toBe('battlefield');
    expect(reenteredDone.state.objects[reenteredTarget]?.zone).toBe('library');
    expect(eventsOfType(reenteredDone.events, 'libraryShuffled').map((event) => event.player)).toEqual([1]);

    const illegalStart = payableBoard();
    const presentSource = oidOf(illegalStart.state, VOID_STALKER.name);
    const illegalTarget = oidOf(illegalStart.state, TARGET.name);
    let illegal = apply(illegalStart, activationToward(illegalStart.state, presentSource, illegalTarget));
    illegal = appendResult(illegal, moveObject(beginTrace(illegal.state), illegalTarget, 'graveyard'));
    const fizzled = resolveTop(illegal);
    expect(fizzled.state.objects[presentSource]?.zone).toBe('battlefield');
    expect(fizzled.state.objects[presentSource]?.tapped).toBe(true);
    expect(fizzled.state.objects[illegalTarget]?.zone).toBe('graveyard');
    expect(eventsOfType(fizzled.events, 'libraryShuffled')).toEqual([]);
  });

  it('reads the physical owners under control changes and the copied ability from layer 1', () => {
    const stolenBase = scenario({
      battlefield: [
        { card: VOID_STALKER, controller: 1 },
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
        { card: TARGET, controller: 0 },
      ],
      libraries: [[...namedLibrary('Mine')], [...namedLibrary('Theirs')]],
      seed: 'void-stalker/stolen',
    });
    const stolen = oidOf(stolenBase.state, VOID_STALKER.name);
    const target = oidOf(stolenBase.state, TARGET.name);
    const controlled = withContinuous(stolenBase.state, [controlledBy(onlyObject(stolen), 0)]);
    const stolenDone = resolveTop({
      state: reduce(controlled, activationToward(controlled, stolen, target)).state,
      events: [],
    });
    expect(stolenDone.state.players[1].library).toContain(stolen);
    expect(stolenDone.state.players[0].library).toContain(target);
    expect(eventsOfType(stolenDone.events, 'libraryShuffled').map((event) => event.player)).toEqual([1, 0]);

    const copiedBase = scenario({
      battlefield: [
        { card: VOID_STALKER, controller: 1 },
        { card: BLANK, controller: 0 },
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
        { card: TARGET, controller: 1 },
      ],
      libraries: [[...namedLibrary('Mine')], [...namedLibrary('Theirs')]],
      seed: 'void-stalker/copy',
    });
    const printed = oidOf(copiedBase.state, VOID_STALKER.name);
    const copy = oidOf(copiedBase.state, BLANK.name);
    const copyTarget = oidOf(copiedBase.state, TARGET.name);
    const copied = withContinuous(copiedBase.state, [copies(onlyObject(copy), printed)]);
    const copyDone = resolveTop({
      state: reduce(copied, activationToward(copied, copy, copyTarget)).state,
      events: [],
    });
    expect(copyDone.state.players[0].library).toContain(copy);
    expect(copyDone.state.objects[copy]?.card.name).toBe(BLANK.name);
    expect(copyDone.state.players[1].library).toContain(copyTarget);
  });
});
