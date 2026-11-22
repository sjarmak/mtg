import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  destroyPermanent,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  type ReduceResult,
} from '@mtg/kernel';
import { beginTurn } from '../src/turn';
import { creature, lands, MOUNTAIN } from './cards';
import { damageToPermanent, replacement, withReplacements } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

const ANNIHILATING_FIRE = parseCard({
  kind: 'instant',
  id: 'rtr-85-annihilating-fire-kernel',
  name: 'Annihilating Fire',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 85 },
  manaCost: { generic: 1, R: 2 },
  colors: ['R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: 3,
      target: { kind: 'anyTarget' },
      exileDamagedCreatureIfItWouldDieThisTurn: true,
    },
  ],
} as unknown as CardInput);

function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Annihilating Fire reached an unexpected decision');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Annihilating Fire stack did not settle');
}

function fireAt(toughness: number): {
  readonly resolved: ReduceResult;
  readonly victimOid: string;
  readonly controlOid: string;
} {
  const victim = creature('Fire Victim', toughness, toughness, {
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });
  const control = creature('Unrelated Fire Control', 2, 2);
  const start = scenario({
    battlefield: [
      ...lands(MOUNTAIN, 3).map((card) => ({ card, controller: 0 as const })),
      { card: victim, controller: 1 },
      { card: control, controller: 1 },
    ],
    hands: [[ANNIHILATING_FIRE], []],
  });
  const victimOid = oidOf(start.state, victim.name);
  const controlOid = oidOf(start.state, control.name);
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, ANNIHILATING_FIRE.name),
    targets: [{ kind: 'permanent', oid: victimOid }],
  });
  return { resolved: resolveStack(cast), victimOid, controlOid };
}

describe('RTR #85 Annihilating Fire', () => {
  it('exiles a creature dealt lethal damage instead of letting it die', () => {
    const { resolved, victimOid } = fireAt(3);
    expect(resolved.state.objects[victimOid]?.zone).toBe('exile');
    expect(resolved.state.turn.battlefieldToGraveyardThisTurn).toEqual([]);
    expect(eventsOfType(resolved.events, 'abilityTriggered')).toEqual([]);
  });

  it('keeps the replacement live for a later same-turn death of the damaged incarnation', () => {
    const { resolved, victimOid } = fireAt(4);
    expect(resolved.state.objects[victimOid]?.zone).toBe('battlefield');

    const destroyed = destroyPermanent(resolved, victimOid, 'destroyEffect');
    expect(destroyed.state.objects[victimOid]?.zone).toBe('exile');
  });

  it('does not exile an unrelated creature that dies during the marked turn', () => {
    const { resolved, controlOid } = fireAt(4);
    const destroyed = destroyPermanent(resolved, controlOid, 'destroyEffect');

    expect(destroyed.state.objects[controlOid]?.zone).toBe('graveyard');
  });

  it('expires the mark at the next turn boundary', () => {
    const { resolved, victimOid } = fireAt(4);
    const nextTurn = beginTurn(beginTrace(resolved.state), 1);
    const destroyed = destroyPermanent(nextTurn, victimOid, 'destroyEffect');

    expect(destroyed.state.objects[victimOid]?.zone).toBe('graveyard');
  });

  it('does not transfer the mark to a new incarnation of the damaged card', () => {
    const { resolved, victimOid } = fireAt(4);
    const departed = moveObject(resolved, victimOid, 'exile');
    const returned = moveObject(departed, victimOid, 'battlefield', { controller: 1 });
    const destroyed = destroyPermanent(returned, victimOid, 'destroyEffect');

    expect(destroyed.state.objects[victimOid]?.zone).toBe('graveyard');
  });

  it('does not mark a creature when all of the damage is prevented', () => {
    const victim = creature('Prevented Fire Victim', 2, 2);
    const start = scenario({ battlefield: [{ card: victim, controller: 1 }] });
    const victimOid = oidOf(start.state, victim.name);
    const shielded = withReplacements(start.state, [
      replacement(damageToPermanent(victimOid), { kind: 'preventDamage', amount: 'all' }),
    ]);
    const prevented = applyDamage(beginTrace(shielded), [
      {
        sourceOid: 'annihilating-fire-source',
        sourceIncarnation: 0,
        controller: 0,
        recipient: { kind: 'permanent', oid: victimOid },
        amount: 3,
        deathtouch: false,
        lifelink: false,
        combat: false,
        preventable: true,
        exileDamagedCreatureIfItWouldDieThisTurn: true,
      },
    ]);
    const destroyed = destroyPermanent(prevented, victimOid, 'destroyEffect');

    expect(eventsOfType(prevented.events, 'damagePrevented')).toHaveLength(1);
    expect(destroyed.state.objects[victimOid]?.zone).toBe('graveyard');
  });

  it('damages a player without creating a creature-death mark', () => {
    const start = scenario({
      battlefield: lands(MOUNTAIN, 3).map((card) => ({ card, controller: 0 as const })),
      hands: [[ANNIHILATING_FIRE], []],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, ANNIHILATING_FIRE.name),
      targets: [{ kind: 'player', player: 1 }],
    });
    const resolved = resolveStack(cast);

    expect(resolved.state.players[1].life).toBe(17);
    expect(resolved.state.turn.damageLinkedDeathExileThisTurn ?? []).toEqual([]);
  });
});
