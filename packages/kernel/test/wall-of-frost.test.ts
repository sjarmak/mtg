/** Native block-pair and one-shot untap-debt proofs for M11 Wall of Frost. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  resolveTop,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature } from './cards';
import { apply, oidOf, playCombat } from './helpers';

function wallOfFrost(extraAbilities: CardInput['abilities'] = []): Card {
  return parseCard({
    kind: 'creature',
    id: 'm11-079-wall-of-frost-kernel',
    name: 'Wall of Frost',
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 79 },
    manaCost: { generic: 1, U: 2 },
    colors: ['U'],
    subtypes: ['Wall'],
    power: 0,
    toughness: 7,
    keywords: [],
    keywordAbilities: [{ kind: 'defender' }],
    abilities: [
      ...extraAbilities,
      {
        kind: 'triggered',
        condition: 'selfBlocksCreature',
        effects: [{ kind: 'skipNextUntap', target: { kind: 'triggeringCreature' } }],
      },
    ],
  } as unknown as CardInput);
}

const ATTACKER = creature('Patient Attacker', 2, 8);
const FROST_SCOUT = creature('Frost Scout', 0, 7, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfBlocksCreature',
      effects: [{ kind: 'skipNextUntap', target: { kind: 'triggeringCreature' } }],
    },
  ],
});

function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 500; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended before the turn arrived');
    const option: Action | undefined =
      decision.kind === 'priority' ? { type: 'passPriority', player: decision.player } : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${String(turn)}`);
}

function blockPairTriggers(result: ReduceResult, source: ObjectId): number {
  return eventsOfType(result.events, 'abilityTriggered').filter(
    (event) => event.source === source && event.condition === 'selfBlocksCreature',
  ).length;
}

function tapped(state: GameState, oid: ObjectId): boolean {
  return state.objects[oid]?.tapped === true;
}

describe("Wall of Frost's retained block pairing", () => {
  it('retains the creature it blocked without making that creature a CR 115 target', () => {
    let current = scenario({
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: wallOfFrost(), controller: 1 },
      ],
      active: 0,
      turn: 2,
      step: 'declareAttackers',
    });
    const attacker = oidOf(current.state, ATTACKER.name);
    const wall = oidOf(current.state, 'Wall of Frost');
    current = apply(current, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });
    for (
      let guard = 0;
      guard < 20 && pendingDecision(current.state)?.kind !== 'declareBlockers';
      guard += 1
    ) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'priority') throw new Error('combat did not reach blockers');
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    current = apply(current, {
      type: 'declareBlockers',
      player: 1,
      blocks: [{ blocker: wall, attacker }],
    });

    const trigger = current.state.stack.find((entry) => entry.ability !== null);
    expect(trigger?.triggerContext).toEqual({
      kind: 'selfBlocksCreature',
      triggeringCreature: attacker,
      triggeringCreatureIncarnation: 0,
    });
    expect(trigger?.targets).toEqual([]);
  });

  it('does not follow the blocked card through a zone change', () => {
    const start = scenario({
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: wallOfFrost(), controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, ATTACKER.name);
    const wall = oidOf(start.state, 'Wall of Frost');
    let current = apply(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });
    while (pendingDecision(current.state)?.kind === 'priority') {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'priority') throw new Error('combat did not reach blockers');
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    current = apply(current, {
      type: 'declareBlockers',
      player: 1,
      blocks: [{ blocker: wall, attacker }],
    });

    const left = moveObject(beginTrace(current.state), attacker, 'hand');
    const returned = moveObject(left, attacker, 'battlefield', { controller: 0 });
    const resolved = resolveTop(returned);

    expect(resolved.state.objects[attacker]?.incarnation).toBe(2);
    expect(resolved.state.objects[attacker]?.skipsNextUntap).toBeUndefined();
  });

  it('marks the blocked creature for exactly its next untap step', () => {
    const start = scenario({
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: wallOfFrost(), controller: 1 },
      ],
      active: 0,
      turn: 2,
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, ATTACKER.name);
    const wall = oidOf(start.state, 'Wall of Frost');
    const fought = playCombat(start, {
      attackers: [attacker],
      blocks: [{ blocker: wall, attacker }],
    });

    expect(blockPairTriggers(fought, wall)).toBe(1);
    expect(tapped(fought.state, attacker)).toBe(true);
    expect(fought.state.objects[attacker]?.skipsNextUntap).toBe(true);

    const nextUntap = passUntilTurn(fought, 4);
    expect(tapped(nextUntap.state, attacker)).toBe(true);
    expect(nextUntap.state.objects[attacker]?.skipsNextUntap).toBeUndefined();
    expect(
      eventsOfType(nextUntap.events, 'untapSkipped').filter((event) => event.oid === attacker),
    ).toHaveLength(1);

    const followingUntap = passUntilTurn(nextUntap, 6);
    expect(tapped(followingUntap.state, attacker)).toBe(false);
  });

  it('does not fire when the source attacks and becomes blocked', () => {
    const start = scenario({
      battlefield: [
        { card: FROST_SCOUT, controller: 0 },
        { card: ATTACKER, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    const scout = oidOf(start.state, FROST_SCOUT.name);
    const blocker = oidOf(start.state, ATTACKER.name);

    const fought = playCombat(start, {
      attackers: [scout],
      blocks: [{ blocker, attacker: scout }],
    });

    expect(blockPairTriggers(fought, scout)).toBe(0);
    expect(fought.state.objects[blocker]?.skipsNextUntap).toBeUndefined();
  });

  it('fires once per blocked creature when another effect grants unlimited blocks', () => {
    const many = wallOfFrost([
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'canBlockAnyNumber' },
      },
    ]);
    const first = creature('First Patient Attacker', 1, 8);
    const second = creature('Second Patient Attacker', 1, 8);
    const start = scenario({
      battlefield: [
        { card: first, controller: 0 },
        { card: second, controller: 0 },
        { card: many, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    const firstOid = oidOf(start.state, first.name);
    const secondOid = oidOf(start.state, second.name);
    const wall = oidOf(start.state, many.name);

    const fought = playCombat(start, {
      attackers: [firstOid, secondOid],
      blocks: [
        { blocker: wall, attacker: firstOid },
        { blocker: wall, attacker: secondOid },
      ],
    });

    expect(blockPairTriggers(fought, wall)).toBe(2);
    expect(fought.state.objects[firstOid]?.skipsNextUntap).toBe(true);
    expect(fought.state.objects[secondOid]?.skipsNextUntap).toBe(true);
  });
});

describe('the unqualified blocks trigger remains once per combat', () => {
  it('fires once when one unlimited blocker blocks two attackers', () => {
    const watcher = creature('Many-Block Watcher', 0, 20, {
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'canBlockAnyNumber' },
        },
        {
          kind: 'triggered',
          condition: 'selfBlocks',
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const first = creature('First Small Attacker', 1, 1);
    const second = creature('Second Small Attacker', 1, 1);
    const start = scenario({
      battlefield: [
        { card: first, controller: 0 },
        { card: second, controller: 0 },
        { card: watcher, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    const firstOid = oidOf(start.state, first.name);
    const secondOid = oidOf(start.state, second.name);
    const watcherOid = oidOf(start.state, watcher.name);

    const fought = playCombat(start, {
      attackers: [firstOid, secondOid],
      blocks: [
        { blocker: watcherOid, attacker: firstOid },
        { blocker: watcherOid, attacker: secondOid },
      ],
    });

    expect(
      eventsOfType(fought.events, 'abilityTriggered').filter(
        (event) => event.source === watcherOid && event.condition === 'selfBlocks',
      ),
    ).toHaveLength(1);
  });
});
