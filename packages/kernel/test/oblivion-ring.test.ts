/** Oblivion Ring's exact target and source-incarnation linked exile behavior. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  moveObject,
  pendingDecision,
  scenario,
  settle,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { artifact, PLAINS } from './cards';
import { abilities, onlyObject, withContinuous } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

const RING = parseCard({
  kind: 'enchantment',
  id: 'm13-22-oblivion-ring-kernel',
  name: 'Oblivion Ring',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 22 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetPermanent',
            filter: { excludeCardTypes: ['land'] },
            excludeSource: true,
          },
          linkToSource: true,
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner' }],
    },
  ],
});

const RELIC = artifact('Ring Relic');
const DECOY = artifact('Unrelated Exile');

function appendTrace(current: ReduceResult, trace: Trace): ReduceResult {
  return { state: trace.state, events: [...current.events, ...trace.events] };
}

function passUntil(start: ReduceResult, predicate: (current: ReduceResult) => boolean): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 30; guard += 1) {
    if (predicate(current)) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Oblivion Ring lost priority before its stop');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Oblivion Ring did not reach its stop');
}

function opened(token = false): ReduceResult {
  return scenario({
    battlefield: [
      ...Array.from({ length: 3 }, () => ({ card: PLAINS, controller: 0 as const })),
      { card: RELIC, controller: 1, token },
      { card: DECOY, controller: 1 },
    ],
    hands: [[RING], []],
    active: 0,
  });
}

function castToTargetChoice(start = opened()): ReduceResult {
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, RING.name),
    targets: [],
  });
  return passUntil(cast, (current) => pendingDecision(current.state)?.kind === 'triggerTargets');
}

function aim(start: ReduceResult, target: ObjectId): ReduceResult {
  const decision = pendingDecision(start.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Oblivion Ring did not ask for a target');
  const option = decision.options.find(
    (entry) =>
      entry.type === 'chooseTriggerTargets' &&
      entry.targets[0]?.kind === 'permanent' &&
      entry.targets[0].oid === target,
  );
  if (option === undefined) throw new Error('Oblivion Ring did not offer the requested target');
  return apply(start, option);
}

function resolveStack(start: ReduceResult): ReduceResult {
  return passUntil(start, (current) => current.state.stack.length === 0);
}

function leave(start: ReduceResult, ring: ObjectId): ReduceResult {
  return appendTrace(start, settle(moveObject(beginTrace(start.state), ring, 'graveyard')));
}

describe('Oblivion Ring', () => {
  it('offers another nonland permanent, excluding itself and every land', () => {
    const choice = castToTargetChoice();
    const ring = oidOf(choice.state, RING.name);
    const offered = pendingDecision(choice.state);
    if (offered?.kind !== 'triggerTargets') throw new Error('Oblivion Ring did not ask for a target');
    const oids = offered.options.flatMap((option) =>
      option.type === 'chooseTriggerTargets' && option.targets[0]?.kind === 'permanent'
        ? [option.targets[0].oid]
        : [],
    );

    expect(oids).toEqual([oidOf(choice.state, RELIC.name), oidOf(choice.state, DECOY.name)]);
    expect(oids).not.toContain(ring);
    expect(oids.some((oid) => choice.state.objects[oid]?.card.name === PLAINS.name)).toBe(false);
  });

  it("returns only its exact linked card under that card's owner", () => {
    const choice = castToTargetChoice();
    const relic = oidOf(choice.state, RELIC.name);
    const ring = oidOf(choice.state, RING.name);
    const exiled = resolveStack(aim(choice, relic));
    expect(exiled.state.objects[relic]?.zone).toBe('exile');

    const returned = resolveStack(leave(exiled, ring));
    expect(returned.state.objects[relic]?.zone).toBe('battlefield');
    expect(returned.state.objects[relic]?.controller).toBe(1);
    expect(returned.state.objects[oidOf(returned.state, DECOY.name)]?.zone).toBe('battlefield');
  });

  it('leaving before the enters trigger resolves produces an unlinked indefinite exile', () => {
    const choice = castToTargetChoice();
    const relic = oidOf(choice.state, RELIC.name);
    const ring = oidOf(choice.state, RING.name);
    const aimed = aim(choice, relic);
    const leftEarly = leave(aimed, ring);
    const resolved = resolveStack(leftEarly);

    expect(resolved.state.objects[relic]?.zone).toBe('exile');
    expect(resolved.state.objects[ring]?.zone).toBe('graveyard');
  });

  it('does not return a later exile incarnation through an old link', () => {
    const choice = castToTargetChoice();
    const relic = oidOf(choice.state, RELIC.name);
    const ring = oidOf(choice.state, RING.name);
    const exiled = resolveStack(aim(choice, relic));
    const left = moveObject(beginTrace(exiled.state), relic, 'hand');
    const reexiled = appendTrace(exiled, settle(moveObject(left, relic, 'exile')));
    const resolved = resolveStack(leave(reexiled, ring));

    expect(resolved.state.objects[relic]?.zone).toBe('exile');
  });

  it('suppresses a leave trigger when abilities were removed before departure but not after it fired', () => {
    const choice = castToTargetChoice();
    const relic = oidOf(choice.state, RELIC.name);
    const ring = oidOf(choice.state, RING.name);
    const exiled = resolveStack(aim(choice, relic));
    const stripped = withContinuous(exiled.state, [abilities(onlyObject(ring), { removeAll: true })]);
    const silent = appendTrace(exiled, settle(moveObject(beginTrace(stripped), ring, 'graveyard')));
    expect(silent.state.stack).toHaveLength(0);
    expect(silent.state.objects[relic]?.zone).toBe('exile');

    const secondChoice = castToTargetChoice();
    const secondRelic = oidOf(secondChoice.state, RELIC.name);
    const secondRing = oidOf(secondChoice.state, RING.name);
    const secondExiled = resolveStack(aim(secondChoice, secondRelic));
    const fired = leave(secondExiled, secondRing);
    const removedAfter = withContinuous(fired.state, [
      abilities(onlyObject(secondRing), { removeAll: true }),
    ]);
    const resolved = resolveStack({ state: removedAfter, events: fired.events });
    expect(resolved.state.objects[secondRelic]?.zone).toBe('battlefield');
  });

  it('does not return an exiled token after it ceases to exist', () => {
    const choice = castToTargetChoice(opened(true));
    const relic = oidOf(choice.state, RELIC.name);
    const ring = oidOf(choice.state, RING.name);
    const exiled = resolveStack(aim(choice, relic));
    expect(exiled.state.objects[relic]?.zone).toBe('exile');

    const resolved = resolveStack(leave(exiled, ring));
    expect(resolved.state.objects[relic]?.zone).toBe('exile');
  });

  it('fizzles when the chosen permanent leaves and returns before resolution', () => {
    const choice = castToTargetChoice();
    const relic = oidOf(choice.state, RELIC.name);
    const aimed = aim(choice, relic);
    const left = moveObject(beginTrace(aimed.state), relic, 'hand');
    const blinked = appendTrace(aimed, settle(moveObject(left, relic, 'battlefield')));
    const resolved = resolveStack(blinked);

    expect(resolved.state.objects[relic]?.zone).toBe('battlefield');
  });
});
