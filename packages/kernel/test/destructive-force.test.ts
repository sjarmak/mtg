/** Destructive Force through APNAP choices, simultaneous sacrifice, and damage. */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { ObjectId, PlayerId, ReduceResult } from '@mtg/kernel';
import { controllerOf, eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { creature, lands, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const DESTRUCTIVE_FORCE: Card = parseCard({
  kind: 'sorcery',
  id: 'm11-133',
  name: 'Destructive Force',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 133 },
  manaCost: { generic: 5, R: 2 },
  colors: ['R'],
  effects: [
    {
      kind: 'sacrificePermanent',
      count: 5,
      filter: { cardTypes: ['land'] },
      players: 'eachPlayer',
      target: { kind: 'noTarget' },
    },
    {
      kind: 'dealDamage',
      amount: 5,
      target: { kind: 'noTarget' },
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
    },
  ],
} as unknown as CardInput);

function destructiveBoard(): ReduceResult {
  return scenario({
    seed: 'm11/destructive-force',
    battlefield: [
      ...lands(MOUNTAIN, 7).map((card) => ({ card, controller: 0 as const })),
      { card: creature('Caster Survivor', 4, 6), controller: 0 as const },
      { card: creature('Caster Casualty', 4, 5), controller: 0 as const },
      ...lands(MOUNTAIN, 6).map((card) => ({ card, controller: 1 as const })),
      { card: creature('Opponent Survivor', 2, 6), controller: 1 as const },
      { card: creature('Opponent Casualty', 2, 2), controller: 1 as const },
    ],
    hands: [[DESTRUCTIVE_FORCE], []],
    libraries: [[creature('Caster Deck', 1, 1)], [creature('Opponent Deck', 1, 1)]],
  });
}

function landsOf(state: ReduceResult['state'], player: PlayerId): readonly ObjectId[] {
  return state.battlefield.filter(
    (oid) => controllerOf(state, oid) === player && state.objects[oid]?.card.kind === 'land',
  );
}

function castAndPass(start: ReduceResult): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, DESTRUCTIVE_FORCE.name),
    targets: [null, null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function chooseFirst(current: ReduceResult, player: PlayerId): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'permanentSacrifice') throw new Error('a land sacrifice was not pending');
  expect(decision.player).toBe(player);
  const action = decision.options[0];
  if (action?.type !== 'sacrificePermanent') throw new Error('the sacrifice choice has no permanent option');
  return apply(current, action);
}

describe('Destructive Force resolution', () => {
  it('banks both players choices before sacrificing five lands each in APNAP order', () => {
    const start = destructiveBoard();
    const before = [landsOf(start.state, 0), landsOf(start.state, 1)] as const;
    let current = castAndPass(start);

    for (let picked = 0; picked < 5; picked += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'permanentSacrifice') throw new Error('player zero was not asked for a land');
      expect(decision.player).toBe(0);
      expect(decision.remaining).toBe(5 - picked);
      expect(decision.permanents.every((oid) => before[0].includes(oid))).toBe(true);
      current = chooseFirst(current, 0);
      expect(eventsOfType(current.events, 'permanentSacrificed')).toEqual([]);
    }

    for (let picked = 0; picked < 5; picked += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'permanentSacrifice') throw new Error('player one was not asked for a land');
      expect(decision.player).toBe(1);
      expect(decision.remaining).toBe(5 - picked);
      expect(decision.permanents.every((oid) => before[1].includes(oid))).toBe(true);
      current = chooseFirst(current, 1);
    }

    expect(eventsOfType(current.events, 'permanentSacrificed')).toHaveLength(10);
    expect(landsOf(current.state, 0)).toHaveLength(2);
    expect(landsOf(current.state, 1)).toHaveLength(1);
  });

  it('never offers a creature, then kills five-toughness bodies and marks six-toughness survivors', () => {
    const asked = castAndPass(destructiveBoard());
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('a land sacrifice was not pending');
    const creatureOid = oidOf(asked.state, 'Caster Survivor');
    expect(decision.permanents).not.toContain(creatureOid);
    expect(
      validateAction(asked.state, { type: 'sacrificePermanent', player: 0, oid: creatureOid }),
    ).not.toBeNull();

    let current = asked;
    while (pendingDecision(current.state)?.kind === 'permanentSacrifice') {
      const pending = pendingDecision(current.state);
      if (pending?.kind !== 'permanentSacrifice') throw new Error('the sacrifice decision disappeared');
      current = chooseFirst(current, pending.player);
    }

    expect(current.state.objects[oidOf(current.state, 'Caster Survivor')]?.damage).toBe(5);
    expect(current.state.objects[oidOf(current.state, 'Opponent Survivor')]?.damage).toBe(5);
    expect(current.state.players[0].graveyard.map((oid) => current.state.objects[oid]?.card.name)).toContain(
      'Caster Casualty',
    );
    expect(current.state.players[1].graveyard.map((oid) => current.state.objects[oid]?.card.name)).toContain(
      'Opponent Casualty',
    );
  });
});
