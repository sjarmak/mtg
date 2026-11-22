/** Native execution and hostile submission coverage for M11 Hunters' Feast. */
import { describe, expect, it } from 'vitest';
import type { Target } from '@mtg/kernel';
import {
  beginTrace,
  copySpellOnStack,
  legalActions,
  pendingDecision,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  topOfStack,
  validateAction,
} from '@mtg/kernel';
import type { Effect } from '@mtg/dsl';
import { FOREST, sorcery } from './cards';

const FEAST = sorcery(
  "Hunters' Feast",
  [
    {
      kind: 'gainLife',
      amount: 6,
      target: { kind: 'targetPlayer', anyNumber: true },
    } as unknown as Effect,
  ],
  { generic: 3, G: 1 },
);

function targetKey(target: Target): string {
  return target.kind === 'player' ? `player:${String(target.player)}` : `${target.kind}:${target.oid}`;
}

describe("Hunters' Feast any-number player targets", () => {
  it('reaches none, either player alone, and both players through staged choices', () => {
    const start = scenario({
      battlefield: Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 })),
      hands: [[FEAST], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';

    const begin = legalActions(start.state).find(
      (action) => action.type === 'beginCastSpell' && action.oid === spell,
    );
    if (begin?.type !== 'beginCastSpell') throw new Error("Hunters' Feast was not offered");
    const begun = reduce(start.state, begin);
    const first = pendingDecision(begun.state);
    if (first?.kind !== 'pluralTargets') throw new Error("Hunters' Feast did not stage its targets");
    expect(
      first.options
        .flatMap((action) =>
          action.type === 'choosePluralTarget'
            ? [action.target === null ? 'finish' : targetKey(action.target)]
            : [],
        )
        .sort(),
    ).toEqual(['finish', 'player:0', 'player:1']);
    const chooseYou = first.options.find(
      (action) =>
        action.type === 'choosePluralTarget' &&
        action.target?.kind === 'player' &&
        action.target.player === 0,
    );
    if (chooseYou === undefined) throw new Error('controller target was not offered');
    const second = pendingDecision(reduce(begun.state, chooseYou).state);
    if (second?.kind !== 'pluralTargets') throw new Error('second target was not staged');
    expect(
      second.options.flatMap((action) =>
        action.type === 'choosePluralTarget'
          ? [action.target === null ? 'finish' : targetKey(action.target)]
          : [],
      ),
    ).toEqual(['player:1', 'finish']);
  });

  it('gives 6 life to each selected player and none to an unselected player', () => {
    const start = scenario({
      battlefield: Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 })),
      hands: [[FEAST], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [null],
      multiTargets: { 0: [{ kind: 'player', player: 1 }] },
    });
    const done = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    expect(done.state.players[0].life).toBe(20);
    expect(done.state.players[1].life).toBe(26);
  });

  it('rejects duplicate players and non-player members', () => {
    const start = scenario({
      battlefield: Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 })),
      hands: [[FEAST], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';
    const land = start.state.battlefield[0] ?? '';
    const base = { type: 'castSpell', player: 0, oid: spell, targets: [null] } as const;

    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: {
          0: [
            { kind: 'player', player: 1 },
            { kind: 'player', player: 1 },
          ],
        },
      }),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: { 0: [{ kind: 'permanent', oid: land }] },
      }),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        ...base,
        multiTargets: { 1: [{ kind: 'player', player: 1 }] },
      }),
    ).not.toBeNull();
    expect(validateAction(start.state, { ...base, multiTargets: {} })).not.toBeNull();
  });

  it('preserves tagged player targets when the spell is copied', () => {
    const start = scenario({
      battlefield: Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 })),
      hands: [[FEAST], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'player', player: 0 },
          { kind: 'player', player: 1 },
        ],
      },
    });

    const copied = copySpellOnStack(beginTrace(cast.state), spell);
    expect(topOfStack(copied.state)?.multiTargets?.[0]).toEqual([
      { kind: 'player', player: 0 },
      { kind: 'player', player: 1 },
    ]);
  });
});
