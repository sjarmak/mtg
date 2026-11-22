/** Necrotic Plague through granted abilities, attachment LKI, and trigger targeting. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  attachmentOf,
  beginTrace,
  characteristicsOf,
  collectTriggers,
  controllerOf,
  moveObject,
  pendingDecision,
  reduce,
  resolveTop,
  scenario,
  serializeEvents,
  settle,
  stateFingerprint,
} from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { creature } from './cards';
import { controlledBy, copies, onlyObject, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

const PLAGUE = parseCard({
  kind: 'enchantment',
  id: 'm11-necrotic-plague',
  name: 'Necrotic Plague',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 107 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'grantTriggeredAbility',
        ability: {
          kind: 'triggered',
          condition: 'beginningOfYourUpkeep',
          effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
        },
      },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedCreatureDies',
      targetChooser: 'triggeringPlayer',
      effects: [{ kind: 'returnSourceAuraAttached', target: { kind: 'targetCreatureYouDontControl' } }],
    },
  ],
});

const HOST = creature('Plagued Host', 2, 2);
const FRIEND = creature('Host Friend', 2, 2);
const ENEMY = creature('Host Enemy', 2, 2);
const COPY_CREATURE = creature('Ordinary Copy Source', 3, 3);
const RETURN_AURA = parseCard({
  kind: 'enchantment',
  id: 'test-return-aura-copy',
  name: 'Return Aura Copy',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedCreatureDies',
      targetChooser: 'triggeringPlayer',
      effects: [{ kind: 'returnSourceAuraAttached', target: { kind: 'targetCreatureYouDontControl' } }],
    },
  ],
});

interface Board {
  readonly state: GameState;
  readonly aura: ObjectId;
  readonly host: ObjectId;
  readonly friend: ObjectId;
  readonly enemy: ObjectId;
}

function board(withEnemy = true, hostToken = false): Board {
  const start = scenario({
    battlefield: [
      { card: HOST, controller: 1, token: hostToken },
      { card: FRIEND, controller: 0 },
      ...(withEnemy ? [{ card: ENEMY, controller: 1 as const }] : []),
    ],
    hands: [[PLAGUE], []],
  }).state;
  const aura = start.players[0].hand[0];
  if (aura === undefined) throw new Error('missing Necrotic Plague');
  const host = oidOf(start, HOST.name);
  const friend = oidOf(start, FRIEND.name);
  const state = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host }).state;
  return {
    state,
    aura,
    host,
    friend,
    enemy: withEnemy ? oidOf(state, ENEMY.name) : friend,
  };
}

function killHost(start: GameState, host: ObjectId): ReduceResult {
  const settled = settle(moveObject(beginTrace(start), host, 'graveyard'));
  return { state: settled.state, events: settled.events };
}

function chooseTarget(from: ReduceResult, target: ObjectId): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Plague did not ask for a target');
  return reduce(from.state, {
    type: 'chooseTriggerTargets',
    player: decision.player,
    oid: decision.oid,
    targets: [{ kind: 'permanent', oid: target }],
  });
}

function copiedBoard(copyCard: typeof COPY_CREATURE | typeof RETURN_AURA): Board {
  const copyIsAura = copyCard.kind === 'enchantment';
  const start = scenario({
    battlefield: [
      { card: HOST, controller: 1 },
      { card: FRIEND, controller: 0 },
      { card: ENEMY, controller: 1 },
      ...(copyIsAura ? [] : [{ card: copyCard, controller: 0 as const }]),
    ],
    hands: [[PLAGUE, ...(copyIsAura ? [copyCard] : [])], []],
  }).state;
  const aura = start.players[0].hand[0];
  if (aura === undefined) throw new Error('missing copied Necrotic Plague');
  const host = oidOf(start, HOST.name);
  const enemy = oidOf(start, ENEMY.name);
  const copySource = copyIsAura ? start.players[0].hand[1] : oidOf(start, copyCard.name);
  if (copySource === undefined) throw new Error('missing Aura copy source');
  const prepared = copyIsAura
    ? moveObject(beginTrace(start), copySource, 'battlefield', { auraHost: enemy })
    : beginTrace(start);
  const attached = moveObject(prepared, aura, 'battlefield', { auraHost: host }).state;
  const state = withContinuous(attached, [copies(onlyObject(aura), copySource)]);
  return {
    state,
    aura,
    host,
    friend: oidOf(state, FRIEND.name),
    enemy,
  };
}

describe('Necrotic Plague in the kernel', () => {
  it("grants the ordinary upkeep trigger to its host, using the host's controller", () => {
    const { state, aura, host } = board();
    const controlled = withContinuous(state, [controlledBy(onlyObject(host), 0)]);
    const fired = collectTriggers(
      {
        state: controlled,
        events: [{ type: 'stepBegan', turn: controlled.turn.number, step: 'upkeep', active: 0 }],
        eventStates: [controlled],
      },
      0,
    );
    expect(
      fired.map(({ sourceOid, controller, condition }) => ({ sourceOid, controller, condition })),
    ).toEqual([{ sourceOid: host, controller: 0, condition: 'beginningOfYourUpkeep' }]);
    expect(fired.some(({ sourceOid }) => sourceOid === aura)).toBe(false);
  });

  it("retains the dead host's layered controller as chooser and only offers opposing creatures", () => {
    const { state, aura, host, enemy } = board();
    const controlled = withContinuous(state, [controlledBy(onlyObject(host), 0)]);
    const dead = killHost(controlled, host);
    const decision = pendingDecision(dead.state);
    expect(decision?.kind).toBe('triggerTargets');
    expect(decision?.player).toBe(0);
    if (decision?.kind !== 'triggerTargets') throw new Error('Plague did not ask for a target');
    expect(decision.options).toEqual([
      {
        type: 'chooseTriggerTargets',
        player: 0,
        oid: decision.oid,
        targets: [{ kind: 'permanent', oid: enemy }],
      },
    ]);
    expect(dead.state.objects[aura]?.zone).toBe('graveyard');
  });

  it('returns and attaches the same Aura incarnation after a legal choice', () => {
    const { state, aura, host, friend } = board();
    const aimed = chooseTarget(killHost(state, host), friend);
    const resolved = resolveTop(beginTrace(aimed.state));
    expect(resolved.state.objects[aura]?.zone).toBe('battlefield');
    expect(attachmentOf(resolved.state, aura)).toBe(friend);
  });

  it('does nothing with no target, an invalidated target, or a newer Aura incarnation', () => {
    const noEnemy = board(false);
    const sameSide = withContinuous(noEnemy.state, [controlledBy(onlyObject(noEnemy.host), 0)]);
    const noTarget = killHost(sameSide, noEnemy.host);
    expect(pendingDecision(noTarget.state)?.kind).not.toBe('triggerTargets');
    expect(noTarget.state.objects[noEnemy.aura]?.zone).toBe('graveyard');

    const invalid = board();
    const aimed = chooseTarget(killHost(invalid.state, invalid.host), invalid.friend);
    const targetGone = moveObject(beginTrace(aimed.state), invalid.friend, 'graveyard');
    const fizzled = resolveTop(targetGone);
    expect(fizzled.state.objects[invalid.aura]?.zone).toBe('graveyard');

    const blinked = board();
    const oldTrigger = chooseTarget(killHost(blinked.state, blinked.host), blinked.friend);
    const returned = moveObject(beginTrace(oldTrigger.state), blinked.aura, 'battlefield', {
      auraHost: blinked.friend,
    });
    const departedAgain = moveObject(returned, blinked.aura, 'graveyard');
    const stale = resolveTop(departedAgain);
    expect(stale.state.objects[blinked.aura]?.zone).toBe('graveyard');
    expect(attachmentOf(stale.state, blinked.aura)).toBeUndefined();
  });

  it('fires from a token host death and returns after that token ceases to exist', () => {
    const token = board(true, true);
    const dead = killHost(token.state, token.host);
    expect(dead.state.objects[token.host]?.zone).toBe('exile');

    const resolved = resolveTop(beginTrace(chooseTarget(dead, token.friend).state));
    expect(resolved.state.objects[token.aura]?.zone).toBe('battlefield');
    expect(attachmentOf(resolved.state, token.aura)).toBe(token.friend);
  });

  it('uses copied Aura values while moving the underlying physical source', () => {
    const nonAura = copiedBoard(COPY_CREATURE);
    const departures = moveObject(
      moveObject(beginTrace(nonAura.state), nonAura.host, 'graveyard'),
      nonAura.aura,
      'graveyard',
    );
    const silent = settle(departures);
    expect(pendingDecision(silent.state)?.kind).not.toBe('triggerTargets');
    expect(silent.state.objects[nonAura.aura]?.zone).toBe('graveyard');

    const legalAura = copiedBoard(RETURN_AURA);
    expect(characteristicsOf(legalAura.state, legalAura.aura).name).toBe(RETURN_AURA.name);
    const resolved = resolveTop(
      beginTrace(chooseTarget(killHost(legalAura.state, legalAura.host), legalAura.friend).state),
    );
    expect(resolved.state.objects[legalAura.aura]?.card.id).toBe(PLAGUE.id);
    expect(attachmentOf(resolved.state, legalAura.aura)).toBe(legalAura.friend);
  });

  it('separates Aura control, host control, and Aura ownership across the handoff', () => {
    const changed = board();
    const controlled = withContinuous(changed.state, [
      controlledBy(onlyObject(changed.aura), 1, { duration: 'whileSubjectRemains' }),
      controlledBy(onlyObject(changed.host), 0, { duration: 'whileSubjectRemains' }),
    ]);
    const dead = killHost(controlled, changed.host);
    const decision = pendingDecision(dead.state);
    expect(decision?.kind).toBe('triggerTargets');
    expect(decision?.player).toBe(0);

    const aimed = chooseTarget(dead, changed.enemy);
    expect(aimed.state.stack.at(-1)?.controller).toBe(1);
    const resolved = resolveTop(beginTrace(aimed.state));
    expect(resolved.state.objects[changed.aura]?.owner).toBe(0);
    expect(controllerOf(resolved.state, changed.aura)).toBe(0);
    expect(attachmentOf(resolved.state, changed.aura)).toBe(changed.enemy);
  });

  it('leaves the Aura in its graveyard when the death trigger is countered', () => {
    const current = board();
    const aimed = chooseTarget(killHost(current.state, current.host), current.friend);
    const trigger = aimed.state.stack.at(-1)?.oid;
    if (trigger === undefined) throw new Error('missing Plague trigger');

    const countered = counterStackEntry(beginTrace(aimed.state), trigger, 'test-counter');
    expect(countered.state.stack.some((entry) => entry.oid === trigger)).toBe(false);
    expect(countered.state.objects[current.aura]?.zone).toBe('graveyard');
  });

  it('hands out response priority after targets are chosen and before returning', () => {
    const current = board();
    const aimed = chooseTarget(killHost(current.state, current.host), current.friend);
    expect(pendingDecision(aimed.state)?.kind).toBe('priority');
    expect(aimed.state.stack.at(-1)?.ability?.sourceOid).toBe(current.aura);
    expect(aimed.state.objects[current.aura]?.zone).toBe('graveyard');
  });

  it('orders simultaneous handoffs APNAP before either targeted trigger resolves', () => {
    const hostZero = creature('Active Host', 2, 2);
    const hostOne = creature('Nonactive Host', 2, 2);
    const survivorZero = creature('Active Survivor', 2, 2);
    const survivorOne = creature('Nonactive Survivor', 2, 2);
    const start = scenario({
      battlefield: [
        { card: hostOne, controller: 1 },
        { card: hostZero, controller: 0 },
        { card: survivorZero, controller: 0 },
        { card: survivorOne, controller: 1 },
      ],
      hands: [[PLAGUE], [PLAGUE]],
      active: 0,
    }).state;
    const auraZero = start.players[0].hand[0];
    const auraOne = start.players[1].hand[0];
    if (auraZero === undefined || auraOne === undefined) throw new Error('missing simultaneous Auras');
    const first = moveObject(beginTrace(start), auraZero, 'battlefield', {
      auraHost: oidOf(start, hostZero.name),
    });
    const second = moveObject(first, auraOne, 'battlefield', {
      controller: 1,
      auraHost: oidOf(first.state, hostOne.name),
    });
    const departures = moveObject(
      moveObject(beginTrace(second.state), oidOf(second.state, hostOne.name), 'graveyard'),
      oidOf(second.state, hostZero.name),
      'graveyard',
    );
    const settled = settle(departures);
    expect(pendingDecision(settled.state)?.player).toBe(0);
    const aimedActive = chooseTarget(settled, oidOf(settled.state, survivorOne.name));
    expect(pendingDecision(aimedActive.state)?.player).toBe(1);
    const aimedBoth = chooseTarget(aimedActive, oidOf(aimedActive.state, survivorZero.name));
    expect(aimedBoth.state.stack.map((entry) => entry.controller)).toEqual([0, 1]);
  });

  it('produces the same events and state fingerprint on deterministic replay', () => {
    const play = () => {
      const current = board();
      const dead = killHost(current.state, current.host);
      const aimed = chooseTarget(dead, current.friend);
      const resolved = resolveTop(beginTrace(aimed.state));
      return {
        state: resolved.state,
        events: [...dead.events, ...aimed.events, ...resolved.events],
      };
    };
    const first = play();
    const replayed = play();
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(first.events));
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(first.state));
  });
});
