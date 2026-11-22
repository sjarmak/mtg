/** Faerie Impostor's non-targeting return-or-sacrifice entry choice. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  pendingDecision,
  putTriggersOnStack,
  resolveTop,
  scenario,
  validateAction,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const IMPOSTOR = parseCard({
  kind: 'creature',
  id: 'rtr-39-faerie-impostor-kernel',
  name: 'Faerie Impostor',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 39 },
  manaCost: { U: 1 },
  colors: ['U'],
  subtypes: ['Faerie', 'Rogue'],
  power: 2,
  toughness: 1,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
      returnAnotherCreatureOrSacrificeSelf: true,
    },
  ],
});

const FRIEND = creature('Impostor Friend', 3, 2);
const ENEMY = creature('Impostor Enemy', 2, 2);

function enterWith(friends: number): { readonly paused: ReduceResult; readonly source: ObjectId } {
  const start = scenario({
    battlefield: [
      ...Array.from({ length: friends }, () => ({ card: FRIEND, controller: 0 as const })),
      { card: ENEMY, controller: 1 },
    ],
    hands: [[IMPOSTOR], []],
  });
  const source = handOidOf(start.state, 0, IMPOSTOR.name);
  const entered = moveObject(beginTrace(start.state), source, 'battlefield', { controller: 0 });
  const stacked = putTriggersOnStack(entered, collectTriggers(entered, 0));
  return { paused: resolveTop(stacked), source };
}

describe("Faerie Impostor's entry choice", () => {
  it('offers return or sacrifice, then returns only another controlled creature', () => {
    const { paused, source } = enterWith(1);
    const first = pendingDecision(paused.state);
    if (first?.kind !== 'optionalTrigger') throw new Error('the return cost was not offered');
    expect(first.options).toEqual([
      { type: 'answerOptionalTrigger', player: 0, oid: first.oid, accept: true },
      { type: 'answerOptionalTrigger', player: 0, oid: first.oid, accept: false },
    ]);

    const accepted = apply(paused, first.options[0]!);
    const choice = pendingDecision(accepted.state);
    if (choice?.kind !== 'battlefieldChoice') throw new Error('the creature choice was not asked');
    const friend = oidOf(accepted.state, FRIEND.name);
    const enemy = oidOf(accepted.state, ENEMY.name);
    expect(choice.permanents).toEqual([friend]);
    expect(choice.permanents).not.toContain(source);
    expect(choice.permanents).not.toContain(enemy);

    const returned = apply(accepted, choice.options[0]!);
    expect(returned.state.objects[friend]?.zone).toBe('hand');
    expect(returned.state.objects[source]?.zone).toBe('battlefield');
    expect(returned.state.stack).toEqual([]);
  });

  it('sacrifices the Impostor when its controller declines or has no other creature', () => {
    const payable = enterWith(1);
    const decision = pendingDecision(payable.paused.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('the return cost was not offered');
    const declined = apply(payable.paused, decision.options[1]!);
    expect(declined.state.objects[payable.source]?.zone).toBe('graveyard');

    const impossible = enterWith(0);
    expect(pendingDecision(impossible.paused.state)?.kind).not.toBe('optionalTrigger');
    expect(impossible.paused.state.objects[impossible.source]?.zone).toBe('graveyard');
    expect(impossible.paused.state.stack).toEqual([]);
  });

  it('rejects a forged return of the source or an opposing creature', () => {
    const { paused, source } = enterWith(1);
    const first = pendingDecision(paused.state);
    if (first?.kind !== 'optionalTrigger') throw new Error('the return cost was not offered');
    const accepted = apply(paused, first.options[0]!);
    const enemy = oidOf(accepted.state, ENEMY.name);
    expect(
      validateAction(accepted.state, { type: 'chooseFromBattlefield', player: 0, chosen: source }),
    ).not.toBeNull();
    expect(
      validateAction(accepted.state, { type: 'chooseFromBattlefield', player: 0, chosen: enemy }),
    ).not.toBeNull();
  });
});
