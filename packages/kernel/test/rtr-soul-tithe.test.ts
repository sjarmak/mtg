/** Live attachment, payer, and mana-value probes for RTR #23, Soul Tithe. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState, ObjectId, Trace } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  isLegalAuraHost,
  moveObject,
  pendingDecision,
  putTriggersOnStack,
  resolveTop,
  reduce,
  scenario,
  stackAwaitingUnless,
} from '@mtg/kernel';
import { artifact, FOREST, lands } from './cards';
import { handOidOf, oidOf } from './helpers';

const SOUL_TITHE = parseCard({
  kind: 'enchantment',
  id: 'rtr-23-soul-tithe-kernel',
  name: 'Soul Tithe',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 23 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: { enchant: 'nonlandPermanent', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      sacrificeEnchantedPermanentUnlessControllerPaysManaValue: true,
      effects: [],
    },
  ],
});

function board(
  host = artifact('Tithe Host', { generic: 3 }),
  payerLands = 3,
): { readonly state: GameState; readonly aura: ObjectId; readonly host: ObjectId } {
  const start = scenario({
    battlefield: [
      { card: host, controller: 1 },
      ...lands(FOREST, payerLands).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[SOUL_TITHE], []],
  }).state;
  const aura = handOidOf(start, 0, SOUL_TITHE.name);
  const hostOid = oidOf(start, host.name);
  return {
    state: moveObject(beginTrace(start), aura, 'battlefield', { auraHost: hostOid }).state,
    aura,
    host: hostOid,
  };
}

function stacked(state: GameState): Trace {
  const event: GameEvent = { type: 'stepBegan', turn: state.turn.number, active: 1, step: 'upkeep' };
  const scan: Trace = { state, events: [event], eventStates: [state] };
  const fired = collectTriggers(scan, 0);
  if (fired.length !== 1) throw new Error(`Soul Tithe fired ${String(fired.length)} trigger(s)`);
  return putTriggersOnStack(beginTrace(state), fired);
}

describe('Soul Tithe in the kernel', () => {
  it('enchants every nonland permanent and no land', () => {
    const { state, aura, host } = board();
    const forest = state.battlefield.find((oid) => state.objects[oid]?.card.name === 'Forest');
    if (forest === undefined) throw new Error('missing Forest');
    expect(isLegalAuraHost(state, state.objects[aura]!.card, host)).toBe(true);
    expect(isLegalAuraHost(state, state.objects[aura]!.card, forest)).toBe(false);
  });

  it('asks the enchanted permanent controller for its live mana value', () => {
    const { state, host } = board();
    const onStack = stacked(state);
    expect(stackAwaitingUnless(onStack.state)).toEqual(
      expect.objectContaining({ kind: 'sacrificeEnchantedPermanent', permanent: host }),
    );
    const stopped = resolveTop(onStack);
    const decision = pendingDecision(stopped.state);
    if (decision?.kind !== 'unless') throw new Error('Soul Tithe did not ask its payer');
    expect(decision.player).toBe(1);
    expect(decision.cost.generic).toBe(3);

    const paid = reduce(stopped.state, { type: 'answerUnless', player: 1, oid: decision.oid, pay: true });
    expect(paid.state.objects[host]?.zone).toBe('battlefield');
    expect(
      paid.state.battlefield.filter(
        (oid) =>
          paid.state.objects[oid]?.controller === 1 &&
          paid.state.objects[oid]?.card.kind === 'land' &&
          paid.state.objects[oid]?.tapped,
      ),
    ).toHaveLength(3);
  });

  it('sacrifices when declined or unaffordable, including mana value zero', () => {
    const declinedBoard = board();
    const stopped = resolveTop(stacked(declinedBoard.state));
    const decision = pendingDecision(stopped.state);
    if (decision?.kind !== 'unless') throw new Error('Soul Tithe did not ask its payer');
    const declined = reduce(stopped.state, {
      type: 'answerUnless',
      player: 1,
      oid: decision.oid,
      pay: false,
    });
    expect(declined.state.objects[declinedBoard.host]?.zone).toBe('graveyard');

    const freeBoard = board(artifact('Zero Tithe Host', {}), 0);
    const freeStop = resolveTop(stacked(freeBoard.state));
    expect(pendingDecision(freeStop.state)).toEqual(
      expect.objectContaining({ kind: 'unless', player: 1, cost: expect.objectContaining({ generic: 0 }) }),
    );
    const freeDecision = pendingDecision(freeStop.state);
    if (freeDecision?.kind !== 'unless') throw new Error('the zero toll was not asked');
    expect(
      reduce(freeStop.state, { type: 'answerUnless', player: 1, oid: freeDecision.oid, pay: false }).state
        .objects[freeBoard.host]?.zone,
    ).toBe('graveyard');

    const poorBoard = board(artifact('Expensive Tithe Host', { generic: 4 }), 0);
    expect(resolveTop(stacked(poorBoard.state)).state.objects[poorBoard.host]?.zone).toBe('graveyard');
  });

  it('uses the current host, falls back to the last host after Aura departure, and retains the upkeep player', () => {
    const first = artifact('First Tithe Host', { generic: 2 });
    const second = artifact('Second Tithe Host', { generic: 4 });
    const start = scenario({
      battlefield: [
        { card: first, controller: 1 },
        { card: second, controller: 0 },
        ...lands(FOREST, 4).map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[SOUL_TITHE], []],
    }).state;
    const aura = handOidOf(start, 0, SOUL_TITHE.name);
    const firstOid = oidOf(start, first.name);
    const secondOid = oidOf(start, second.name);
    const attached = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: firstOid }).state;

    const triggered = stacked(attached);
    const movedState: GameState = {
      ...triggered.state,
      objects: {
        ...triggered.state.objects,
        [aura]: { ...triggered.state.objects[aura]!, attachedTo: secondOid },
      },
    };
    const moved = resolveTop({ ...triggered, state: movedState });
    expect(pendingDecision(moved.state)).toEqual(
      expect.objectContaining({ kind: 'unless', player: 1, cost: expect.objectContaining({ generic: 4 }) }),
    );
    const movedDecision = pendingDecision(moved.state);
    if (movedDecision?.kind !== 'unless') throw new Error('the moved Aura toll was not asked');
    const cannotSacrifice = reduce(moved.state, {
      type: 'answerUnless',
      player: 1,
      oid: movedDecision.oid,
      pay: false,
    });
    expect(cannotSacrifice.state.objects[secondOid]?.zone).toBe('battlefield');

    const departed = resolveTop(moveObject(stacked(attached), aura, 'graveyard'));
    expect(pendingDecision(departed.state)).toEqual(
      expect.objectContaining({ kind: 'unless', player: 1, cost: expect.objectContaining({ generic: 2 }) }),
    );
    const departedDecision = pendingDecision(departed.state);
    if (departedDecision?.kind !== 'unless') throw new Error('the departed Aura toll was not asked');
    expect(
      reduce(departed.state, {
        type: 'answerUnless',
        player: 1,
        oid: departedDecision.oid,
        pay: false,
      }).state.objects[firstOid]?.zone,
    ).toBe('graveyard');
  });
});
