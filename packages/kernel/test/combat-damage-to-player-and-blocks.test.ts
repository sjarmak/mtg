/**
 * `selfDealsCombatDamageToPlayer` (CR 510.1c) and `selfBlocks` (CR 509.1h).
 *
 * The first is `damageDealt`'s other branch from `gloom.test.ts`'s: that file
 * pins the creature-recipient half of the event, and the negative arm here is
 * its mirror — a blocked attacker's damage goes to the blocker, not the
 * defending player, so the trigger has to read `event.target.kind` rather
 * than fire off any combat damage its source deals. `selfBlocks` reads a
 * different event entirely (`blockersDeclared`, CR 509.1h) and fires at
 * declare-blockers, before any damage is dealt, which is why the assertions
 * below never need the damage step to run — `playCombat`'s `blocks` alone is
 * enough. Both conditions read `sourceOid`/the ability-bearer's own object,
 * so "took no part in this combat" is the negative arm each carries.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, scenario } from '@mtg/kernel';
import { creature } from './cards';
import { oidOf, playCombat } from './helpers';

/** A 2/2 that gains a life whenever it connects with the defending player. */
const PLAYER_DAMAGE_WARDEN: Card = creature('Player Damage Warden', 2, 2, {
  cost: { generic: 2 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** A 0/5 that gains a life whenever it blocks, regardless of what it blocks. */
const BLOCK_WARDEN: Card = creature('Block Warden', 0, 5, {
  cost: { generic: 3 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfBlocks',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** A body with no printed text, to stand in the way or attack unwatched. */
const RIVAL: Card = creature('Rival Body', 3, 3, { cost: { generic: 3 } });

/** A high-toughness wall, so a blocked attacker survives to be checked. */
const BULWARK: Card = creature('Stone Bulwark', 0, 5, { cost: { generic: 3 } });

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

describe('whenever this creature deals combat damage to a player', () => {
  it('fires when the attack goes through unblocked', () => {
    const start = scenario({
      battlefield: [{ card: PLAYER_DAMAGE_WARDEN, controller: 0 }],
      step: 'declareAttackers',
    });
    const warden = oidOf(start.state, 'Player Damage Warden');

    const done = playCombat(start, { attackers: [warden], blocks: [] });

    expect(conditionsFiredBy(done, warden)).toEqual(['selfDealsCombatDamageToPlayer']);
    expect(done.state.players[1].life).toBe(18);
  });

  it('does not fire when the attack is blocked, since the damage lands on the blocker', () => {
    const start = scenario({
      battlefield: [
        { card: PLAYER_DAMAGE_WARDEN, controller: 0 },
        { card: BULWARK, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const warden = oidOf(start.state, 'Player Damage Warden');
    const bulwark = oidOf(start.state, 'Stone Bulwark');

    const done = playCombat(start, { attackers: [warden], blocks: [{ blocker: bulwark, attacker: warden }] });

    expect(conditionsFiredBy(done, warden)).toEqual([]);
    expect(done.state.players[1].life).toBe(20);
  });

  it('does not fire on a combat its source took no part in', () => {
    const start = scenario({
      battlefield: [
        { card: PLAYER_DAMAGE_WARDEN, controller: 0 },
        { card: RIVAL, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const warden = oidOf(start.state, 'Player Damage Warden');
    const rival = oidOf(start.state, 'Rival Body');

    const done = playCombat(start, { attackers: [rival], blocks: [] });

    expect(conditionsFiredBy(done, warden)).toEqual([]);
  });
});

describe('whenever this creature blocks', () => {
  it('fires the moment it is declared as a blocker, before damage is dealt', () => {
    const start = scenario({
      battlefield: [
        { card: RIVAL, controller: 0 },
        { card: BLOCK_WARDEN, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const rival = oidOf(start.state, 'Rival Body');
    const warden = oidOf(start.state, 'Block Warden');

    const done = playCombat(start, { attackers: [rival], blocks: [{ blocker: warden, attacker: rival }] });

    expect(conditionsFiredBy(done, warden)).toEqual(['selfBlocks']);
  });

  it('does not fire when it stays home and the attack goes unblocked', () => {
    const start = scenario({
      battlefield: [
        { card: RIVAL, controller: 0 },
        { card: BLOCK_WARDEN, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const rival = oidOf(start.state, 'Rival Body');
    const warden = oidOf(start.state, 'Block Warden');

    const done = playCombat(start, { attackers: [rival], blocks: [] });

    expect(conditionsFiredBy(done, warden)).toEqual([]);
  });

  it('does not fire when it attacks instead of blocking', () => {
    const start = scenario({
      battlefield: [{ card: BLOCK_WARDEN, controller: 0 }],
      step: 'declareAttackers',
    });
    const warden = oidOf(start.state, 'Block Warden');

    const done = playCombat(start, { attackers: [warden], blocks: [] });

    expect(conditionsFiredBy(done, warden)).toEqual([]);
  });
});
