/** Native mixed-zone plural targeting and source-linked return for RTR #1. */
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
  type Target,
  type Trace,
} from '@mtg/kernel';
import { artifact, creature, instant } from './cards';
import { apply, handOidOf } from './helpers';

const ANGEL = parseCard({
  kind: 'creature',
  id: 'rtr-1-angel-of-serenity-kernel',
  name: 'Angel of Serenity',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 1 },
  manaCost: { generic: 4, W: 3 },
  colors: ['W'],
  power: 5,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetPermanent',
            filter: { cardTypes: ['creature'] },
            excludeSource: true,
            count: 3,
          },
          linkToSource: true,
          creatureBattlefieldOrGraveyard: true,
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'hand', plural: true }],
    },
  ],
});

const BOARD_MINE = creature('Angel Probe Board Mine', 2, 2);
const BOARD_THEIRS = creature('Angel Probe Board Theirs', 3, 3);
const GRAVE_MINE = creature('Angel Probe Grave Mine', 1, 1);
const GRAVE_THEIRS = creature('Angel Probe Grave Theirs', 4, 4);
const GRAVE_SPELL = instant('Angel Probe Grave Spell', [
  { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
]);
const RELIC = artifact('Angel Probe Relic');

function appendTrace(current: ReduceResult, trace: Trace): ReduceResult {
  return { state: trace.state, events: [...current.events, ...trace.events] };
}

function objectByName(state: ReduceResult['state'], name: string): ObjectId {
  const found = Object.values(state.objects).find((object) => object.card.name === name);
  if (found === undefined) throw new Error(`missing ${name}`);
  return found.oid;
}

function enterAngel(): ReduceResult {
  const start = scenario({
    battlefield: [
      { card: BOARD_MINE, controller: 0 },
      { card: BOARD_THEIRS, controller: 1 },
      { card: RELIC, controller: 1 },
    ],
    hands: [[ANGEL], []],
    graveyards: [[GRAVE_MINE, GRAVE_SPELL], [GRAVE_THEIRS]],
  });
  const angel = handOidOf(start.state, 0, ANGEL.name);
  return appendTrace(start, settle(moveObject(beginTrace(start.state), angel, 'battlefield')));
}

function targetKey(state: ReduceResult['state'], target: Target | null): string {
  if (target === null) return 'finish';
  if (target.kind === 'player') return `player:${String(target.player)}`;
  return `${target.kind}:${state.objects[target.oid]?.card.name ?? target.oid}`;
}

function beginPlural(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Angel trigger targets were not requested');
  return apply(current, {
    type: 'chooseTriggerTargets',
    player: decision.player,
    oid: decision.oid,
    targets: [null],
  });
}

function chooseNamed(current: ReduceResult, name: string): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'pluralTargets') throw new Error('Angel plural targets were not requested');
  const option = decision.options.find(
    (candidate) =>
      candidate.type === 'choosePluralTarget' &&
      candidate.target !== null &&
      candidate.target.kind !== 'player' &&
      current.state.objects[candidate.target.oid]?.card.name === name,
  );
  if (option === undefined) throw new Error(`Angel did not offer ${name}`);
  return apply(current, option);
}

function finishTargets(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'pluralTargets') throw new Error('Angel plural targets were not requested');
  const option = decision.options.find(
    (candidate) => candidate.type === 'choosePluralTarget' && candidate.target === null,
  );
  if (option === undefined) throw new Error('Angel did not offer target completion');
  return apply(current, option);
}

function acceptAndResolve(current: ReduceResult): ReduceResult {
  let offered = current;
  for (let guard = 0; guard < 10; guard += 1) {
    const decision = pendingDecision(offered.state);
    if (decision?.kind === 'optionalTrigger') break;
    if (decision?.kind !== 'priority') {
      throw new Error(`Angel optional was not offered; found ${decision?.kind ?? 'quiet'}`);
    }
    offered = apply(offered, { type: 'passPriority', player: decision.player });
  }
  const optional = pendingDecision(offered.state);
  if (optional?.kind !== 'optionalTrigger') {
    throw new Error(`Angel optional was not offered; found ${optional?.kind ?? 'quiet'}`);
  }
  let done = apply(offered, {
    type: 'answerOptionalTrigger',
    player: optional.player,
    oid: optional.oid,
    accept: true,
  });
  for (let guard = 0; guard < 20 && done.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(done.state);
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'quiet'} decision`);
    done = apply(done, { type: 'passPriority', player: decision.player });
  }
  return done;
}

function resolveStack(current: ReduceResult): ReduceResult {
  let done = current;
  for (let guard = 0; guard < 20 && done.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(done.state);
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'quiet'} decision`);
    done = apply(done, { type: 'passPriority', player: decision.player });
  }
  return done;
}

describe('Angel of Serenity', () => {
  it('offers only other creatures across the battlefield and all graveyards', () => {
    const plural = beginPlural(enterAngel());
    const decision = pendingDecision(plural.state);
    if (decision?.kind !== 'pluralTargets') throw new Error('Angel plural targets were not requested');
    expect(
      decision.options
        .flatMap((option) =>
          option.type === 'choosePluralTarget' ? [targetKey(plural.state, option.target)] : [],
        )
        .sort(),
    ).toEqual([
      'card:Angel Probe Grave Mine',
      'card:Angel Probe Grave Theirs',
      'finish',
      'permanent:Angel Probe Board Mine',
      'permanent:Angel Probe Board Theirs',
    ]);
  });

  it('exiles mixed-zone survivors and returns them to their owners when Angel leaves', () => {
    let chosen = beginPlural(enterAngel());
    chosen = chooseNamed(chosen, BOARD_MINE.name);
    chosen = chooseNamed(chosen, GRAVE_MINE.name);
    chosen = chooseNamed(chosen, GRAVE_THEIRS.name);
    const exiled = acceptAndResolve(chosen);
    const angel = objectByName(exiled.state, ANGEL.name);
    const mine = objectByName(exiled.state, BOARD_MINE.name);
    const graveMine = objectByName(exiled.state, GRAVE_MINE.name);
    const graveTheirs = objectByName(exiled.state, GRAVE_THEIRS.name);
    expect([mine, graveMine, graveTheirs].map((oid) => exiled.state.objects[oid]?.zone)).toEqual([
      'exile',
      'exile',
      'exile',
    ]);

    const departed = appendTrace(exiled, settle(moveObject(beginTrace(exiled.state), angel, 'graveyard')));
    const returned = resolveStack(departed);
    expect(returned.state.objects[mine]?.zone).toBe('hand');
    expect(returned.state.objects[graveMine]?.zone).toBe('hand');
    expect(returned.state.objects[graveTheirs]?.zone).toBe('hand');
    expect(returned.state.objects[mine]?.owner).toBe(0);
    expect(returned.state.objects[graveTheirs]?.owner).toBe(1);
  });

  it('accepts zero targets and partially resolves when one chosen incarnation leaves', () => {
    const zero = acceptAndResolve(finishTargets(beginPlural(enterAngel())));
    expect(zero.state.exile).toEqual([]);

    let chosen = beginPlural(enterAngel());
    chosen = chooseNamed(chosen, BOARD_MINE.name);
    chosen = chooseNamed(chosen, GRAVE_THEIRS.name);
    chosen = finishTargets(chosen);
    const board = objectByName(chosen.state, BOARD_MINE.name);
    const grave = objectByName(chosen.state, GRAVE_THEIRS.name);
    const changed = appendTrace(chosen, settle(moveObject(beginTrace(chosen.state), board, 'hand')));
    const done = acceptAndResolve(changed);
    expect(done.state.objects[board]?.zone).toBe('hand');
    expect(done.state.objects[grave]?.zone).toBe('exile');
  });

  it('does not return an exiled token and cannot link after the source departed', () => {
    const tokenBody = creature('Angel Probe Token', 1, 1);
    const start = scenario({
      battlefield: [{ card: tokenBody, controller: 1, token: true }],
      hands: [[ANGEL], []],
      graveyards: [[GRAVE_MINE], []],
    });
    const angel = handOidOf(start.state, 0, ANGEL.name);
    let chosen = beginPlural(
      appendTrace(start, settle(moveObject(beginTrace(start.state), angel, 'battlefield'))),
    );
    chosen = chooseNamed(chosen, tokenBody.name);
    chosen = chooseNamed(chosen, GRAVE_MINE.name);
    chosen = finishTargets(chosen);
    const token = objectByName(chosen.state, tokenBody.name);
    const grave = objectByName(chosen.state, GRAVE_MINE.name);
    const departed = appendTrace(chosen, settle(moveObject(beginTrace(chosen.state), angel, 'graveyard')));
    const done = acceptAndResolve(departed);
    expect(done.state.objects[token]?.zone).not.toBe('hand');
    expect(done.state.objects[grave]?.zone).toBe('exile');
    expect(done.state.objects[angel]?.linkedExile ?? []).toEqual([]);
  });
});
