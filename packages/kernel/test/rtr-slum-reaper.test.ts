/** RTR #77 through APNAP creature choices banked before simultaneous sacrifice. */
import { parseCard, type Card } from '@mtg/dsl';
import { eventsOfType, pendingDecision, scenario, validateAction, type ReduceResult } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-077-slum-reaper-kernel',
  name: 'Slum Reaper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 77 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Horror'],
  power: 4,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'sacrificePermanent', players: 'eachPlayer', target: { kind: 'noTarget' } }],
    },
  ],
});

const CASTER_ONE = creature('Slum Caster One', 2, 2);
const CASTER_TWO = creature('Slum Caster Two', 2, 2);
const RIVAL_ONE = creature('Slum Rival One', 2, 2);
const RIVAL_TWO = creature('Slum Rival Two', 2, 2);

function board(opponentCreatures: readonly Card[] = [RIVAL_ONE, RIVAL_TWO]): ReduceResult {
  return scenario({
    seed: 'rtr/slum-reaper',
    battlefield: [
      ...lands(SWAMP, 4).map((card) => ({ card, controller: 0 as const })),
      { card: CASTER_ONE, controller: 0 },
      { card: CASTER_TWO, controller: 0 },
      ...opponentCreatures.map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[CARD], []],
    libraries: [[], []],
  });
}

function untilSacrifice(start: ReduceResult): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, CARD.name),
    targets: [],
  });
  for (let guard = 0; guard < 16; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'permanentSacrifice') return current;
    if (decision?.kind !== 'priority')
      throw new Error(`Slum Reaper stopped on ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Slum Reaper did not reach its sacrifice choice');
}

function chooseNamed(current: ReduceResult, name: string): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'permanentSacrifice') throw new Error('Slum Reaper choice is not pending');
  return apply(current, {
    type: 'sacrificePermanent',
    player: decision.player,
    oid: oidOf(current.state, name),
  });
}

describe('RTR Slum Reaper in the kernel', () => {
  it('asks each seat for its own creature and banks both choices before either moves', () => {
    const casterAsked = untilSacrifice(board());
    const first = pendingDecision(casterAsked.state);
    if (first?.kind !== 'permanentSacrifice') throw new Error('the caster was not asked');
    const casterNames = first.permanents.map((oid) => casterAsked.state.objects[oid]?.card.name);
    expect(first.player).toBe(0);
    expect(casterNames).toEqual([CASTER_ONE.name, CASTER_TWO.name, CARD.name]);
    expect(
      validateAction(casterAsked.state, {
        type: 'sacrificePermanent',
        player: 0,
        oid: oidOf(casterAsked.state, RIVAL_ONE.name),
      }),
    ).not.toBeNull();
    expect(first.permanents.every((oid) => casterAsked.state.objects[oid]?.card.kind === 'creature')).toBe(
      true,
    );

    const casterChoice = oidOf(casterAsked.state, CASTER_TWO.name);
    const rivalAsked = chooseNamed(casterAsked, CASTER_TWO.name);
    expect(rivalAsked.state.objects[casterChoice]?.zone).toBe('battlefield');
    const second = pendingDecision(rivalAsked.state);
    if (second?.kind !== 'permanentSacrifice') throw new Error('the rival was not asked');
    expect(second.player).toBe(1);
    expect(second.permanents.map((oid) => rivalAsked.state.objects[oid]?.card.name)).toEqual([
      RIVAL_ONE.name,
      RIVAL_TWO.name,
    ]);

    const rivalChoice = oidOf(rivalAsked.state, RIVAL_ONE.name);
    const done = chooseNamed(rivalAsked, RIVAL_ONE.name);
    expect(done.state.objects[casterChoice]?.zone).toBe('graveyard');
    expect(done.state.objects[rivalChoice]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.player)).toEqual([0, 1]);
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });

  it('skips a seat with no creature and never asks it for a sacrifice', () => {
    const casterAsked = untilSacrifice(board([]));
    const done = chooseNamed(casterAsked, CASTER_ONE.name);

    expect(pendingDecision(done.state)?.kind).not.toBe('permanentSacrifice');
    expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.player)).toEqual([0]);
  });
});
