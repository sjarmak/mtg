/**
 * CR 614/615/616: replacement and prevention effects.
 *
 * The pipeline is driven here through the same kernel entry points a card
 * would use — `applyDamage`, `drawCard`, `gainLife`, `moveObject` — rather than
 * through a test-only path, so what these tests prove is what a game does.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { DamageInstance, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  affectedPlayerFor,
  applyDamage,
  applyReplacements,
  beginTrace,
  chooseInOrder,
  drawCard,
  eventsOfType,
  gainLife,
  getObject,
  moveObject,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature, FOREST } from './cards';
import { handOidOf, oidOf } from './helpers';
import { damageToPermanent, damageToPlayer, replacement, withReplacements } from './continuous-helpers';

const bear = creature('Rep Bear', 2, 2);
const wall = creature('Rep Wall', 0, 5);

function board(): GameState {
  return scenario({
    battlefield: [
      { card: bear, controller: 0 },
      { card: FOREST, controller: 0 },
    ],
    hands: [[wall], []],
    life: [20, 20],
  }).state;
}

function bolt(target: PlayerId | ObjectId, amount: number): DamageInstance {
  const recipient =
    typeof target === 'number'
      ? ({ kind: 'player', player: target } as const)
      : ({ kind: 'permanent', oid: target } as const);
  return {
    sourceOid: 'source',
    controller: 0,
    recipient,
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
  };
}

function lifeOf(state: GameState, player: PlayerId): number {
  return state.players[player].life;
}

describe('CR 615 prevention', () => {
  it('prevents part of the damage and lets the rest through', () => {
    const state = withReplacements(board(), [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 2 }, { id: 'shield' }),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(1, 5)]);
    expect(lifeOf(result.state, 1)).toBe(17);
    expect(eventsOfType(result.events, 'damageDealt')[0]?.amount).toBe(3);
    expect(eventsOfType(result.events, 'replacementApplied').map((event) => event.id)).toEqual(['shield']);
    // The shield was fully spent, so it is gone.
    expect(result.state.replacements).toHaveLength(0);
  });

  it('spends a shield across several damage events until it runs out', () => {
    const state = withReplacements(board(), [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 3 }, { id: 'shield' }),
    ]);
    const first = applyDamage(beginTrace(state), [bolt(1, 2)]);
    expect(lifeOf(first.state, 1)).toBe(20);
    expect(first.state.replacements).toHaveLength(1);

    const second = applyDamage(first, [bolt(1, 2)]);
    // 1 point of shield was left, so 1 of the 2 gets through.
    expect(lifeOf(second.state, 1)).toBe(19);
    expect(second.state.replacements).toHaveLength(0);
  });

  it('prevents all of it and logs that nothing happened', () => {
    const state = withReplacements(board(), [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 'all' }),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(1, 7)]);
    expect(lifeOf(result.state, 1)).toBe(20);
    expect(eventsOfType(result.events, 'damageDealt')).toHaveLength(0);
    expect(eventsOfType(result.events, 'damagePrevented')[0]?.amount).toBe(7);
    // A blanket shield is not consumed.
    expect(result.state.replacements).toHaveLength(1);
  });

  it('keeps a creature alive when its damage is prevented', () => {
    const start = board();
    const bearOid = oidOf(start, 'Rep Bear');
    const state = withReplacements(start, [
      replacement(damageToPermanent(bearOid), { kind: 'preventDamage', amount: 'all' }),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(bearOid, 4)]);
    expect(getObject(result.state, bearOid).damage).toBe(0);
  });
});

describe('CR 614.5 an effect applies once per event', () => {
  it('doubles damage exactly once rather than looping', () => {
    const state = withReplacements(board(), [
      replacement(damageToPlayer(1), { kind: 'multiplyDamage', factor: 2 }, { id: 'double' }),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(1, 3)]);
    expect(lifeOf(result.state, 1)).toBe(14);
    expect(eventsOfType(result.events, 'replacementApplied')).toHaveLength(1);
  });

  it('lets the same effect apply again to the next event', () => {
    const state = withReplacements(board(), [
      replacement(damageToPlayer(1), { kind: 'multiplyDamage', factor: 2 }),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(1, 1), bolt(1, 1)]);
    expect(lifeOf(result.state, 1)).toBe(16);
  });
});

describe('CR 616.1 the affected player chooses the order', () => {
  const preventTwo = replacement(
    damageToPlayer(1),
    { kind: 'preventDamage', amount: 2 },
    {
      id: 'prevent',
      ts: 1,
    },
  );
  const doubleIt = replacement(
    damageToPlayer(1),
    { kind: 'multiplyDamage', factor: 2 },
    {
      id: 'double',
      ts: 2,
    },
  );

  it('names the damaged player as the chooser', () => {
    const state = withReplacements(board(), [preventTwo, doubleIt]);
    expect(
      affectedPlayerFor(state, {
        kind: 'damage',
        sourceOid: 'source',
        controller: 0,
        recipient: { kind: 'player', player: 1 },
        amount: 4,
        deathtouch: false,
        lifelink: false,
        combat: false,
      }),
    ).toBe(1);
  });

  it('gives 4 damage two different answers depending on the order chosen', () => {
    const state = withReplacements(board(), [preventTwo, doubleIt]);
    const event = {
      kind: 'damage' as const,
      sourceOid: 'source',
      controller: 0 as PlayerId,
      recipient: { kind: 'player' as const, player: 1 as PlayerId },
      amount: 4,
      deathtouch: false,
      lifelink: false,
      combat: false,
    };

    // Prevent first: 4 - 2 = 2, then doubled = 4.
    const preventFirst = applyReplacements(state, event, chooseInOrder(['prevent', 'double']));
    expect(preventFirst.event?.kind === 'damage' ? preventFirst.event.amount : null).toBe(4);
    expect(preventFirst.appliedIds).toEqual(['prevent', 'double']);

    // Double first: 4 * 2 = 8, then prevent 2 = 6.
    const doubleFirst = applyReplacements(state, event, chooseInOrder(['double', 'prevent']));
    expect(doubleFirst.event?.kind === 'damage' ? doubleFirst.event.amount : null).toBe(6);
    expect(doubleFirst.appliedIds).toEqual(['double', 'prevent']);
  });

  it('defaults to the earliest timestamp so replays stay deterministic', () => {
    const state = withReplacements(board(), [preventTwo, doubleIt]);
    const result = applyDamage(beginTrace(state), [bolt(1, 4)]);
    expect(lifeOf(result.state, 1)).toBe(16);
  });

  it('rejects a chooser that names an effect which does not apply', () => {
    // With two candidates there is a real choice to make, so the chooser is
    // consulted — and a chooser that answers with something outside the
    // candidate set is a bug in the agent, not something to silently absorb.
    const state = withReplacements(board(), [preventTwo, doubleIt]);
    const other = replacement(damageToPlayer(0), { kind: 'multiplyDamage', factor: 2 }, { id: 'wrong' });
    expect(() =>
      applyReplacements(
        state,
        {
          kind: 'damage',
          sourceOid: 'source',
          controller: 0,
          recipient: { kind: 'player', player: 1 },
          amount: 4,
          deathtouch: false,
          lifelink: false,
          combat: false,
        },
        () => other,
      ),
    ).toThrow(/not applicable/);
  });
});

describe('CR 614.15 self-replacement effects go first', () => {
  it('applies the damaged permanent’s own effect before anything else', () => {
    const start = board();
    const bearOid = oidOf(start, 'Rep Bear');
    // The bear's own effect prevents 1; an unrelated effect doubles. The
    // self-replacement applies first regardless of timestamp or chooser
    // preference: 4 - 1 = 3, then doubled = 6.
    const state = withReplacements(start, [
      replacement(
        damageToPermanent(bearOid),
        { kind: 'multiplyDamage', factor: 2 },
        {
          id: 'double',
          ts: 1,
        },
      ),
      replacement(
        damageToPermanent(bearOid),
        { kind: 'preventDamage', amount: 1 },
        {
          id: 'self',
          ts: 2,
          source: bearOid,
          self: true,
        },
      ),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(bearOid, 4)]);
    expect(eventsOfType(result.events, 'replacementApplied').map((event) => event.id)).toEqual([
      'self',
      'double',
    ]);
    expect(getObject(result.state, bearOid).damage).toBe(6);
  });

  it('treats an effect flagged self-replacement on someone else as ordinary', () => {
    const start = board();
    const bearOid = oidOf(start, 'Rep Bear');
    const state = withReplacements(start, [
      replacement(
        damageToPermanent(bearOid),
        { kind: 'multiplyDamage', factor: 2 },
        {
          id: 'double',
          ts: 1,
        },
      ),
      replacement(
        damageToPermanent(bearOid),
        { kind: 'preventDamage', amount: 1 },
        {
          id: 'liar',
          ts: 2,
          source: 'somewhere-else',
          self: true,
        },
      ),
    ]);
    // No true self-replacement, so timestamp order: 4 * 2 = 8, then -1 = 7.
    const result = applyDamage(beginTrace(state), [bolt(bearOid, 4)]);
    expect(eventsOfType(result.events, 'replacementApplied').map((event) => event.id)).toEqual([
      'double',
      'liar',
    ]);
    expect(getObject(result.state, bearOid).damage).toBe(7);
  });
});

describe('replacement effects on other event kinds', () => {
  it('redirects damage from a player to a permanent', () => {
    const start = board();
    const bearOid = oidOf(start, 'Rep Bear');
    const state = withReplacements(start, [
      replacement(damageToPlayer(0), {
        kind: 'redirectDamage',
        to: { kind: 'permanent', oid: bearOid },
      }),
    ]);
    const result = applyDamage(beginTrace(state), [bolt(0, 2)]);
    expect(lifeOf(result.state, 0)).toBe(20);
    expect(getObject(result.state, bearOid).damage).toBe(2);
  });

  it('applies protection after an earlier effect redirects damage to the protected creature', () => {
    const protectedCard = parseCard({
      kind: 'creature',
      id: 'replacement-protection-red',
      name: 'Red-Protected Bear',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 901 },
      manaCost: { W: 1 },
      colors: ['W'],
      subtypes: ['Bear'],
      power: 2,
      toughness: 2,
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
    });
    const redSource = parseCard({
      kind: 'instant',
      id: 'replacement-red-source',
      name: 'Redirected Flame',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 902 },
      manaCost: { R: 1 },
      colors: ['R'],
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetPlayer' } }],
    });
    const start = scenario({ battlefield: [{ card: protectedCard, controller: 1 }] }).state;
    const protectedOid = oidOf(start, 'Red-Protected Bear');
    const state = withReplacements(start, [
      replacement(
        damageToPlayer(1),
        { kind: 'redirectDamage', to: { kind: 'permanent', oid: protectedOid } },
        { id: 'redirect-first', ts: 1 },
      ),
    ]);
    const result = applyDamage(beginTrace(state), [{ ...bolt(1, 2), sourceCard: redSource }]);
    expect(getObject(result.state, protectedOid).damage).toBe(0);
    expect(eventsOfType(result.events, 'replacementApplied').map((event) => event.id)).toEqual([
      'redirect-first',
      `protection:source:${protectedOid}`,
    ]);
    expect(eventsOfType(result.events, 'damagePrevented')[0]?.target).toEqual({
      kind: 'permanent',
      oid: protectedOid,
    });
  });

  it('skips a draw entirely', () => {
    const state = withReplacements(board(), [replacement({ kind: 'draw', player: 0 }, { kind: 'skipDraw' })]);
    const before = state.players[0].hand.length;
    const result = drawCard(beginTrace(state), 0);
    expect(result.state.players[0].hand).toHaveLength(before);
    expect(eventsOfType(result.events, 'cardDrawn')).toHaveLength(0);
  });

  it('turns one draw into two', () => {
    const state = withReplacements(board(), [
      replacement({ kind: 'draw', player: 0 }, { kind: 'drawAdditional', extra: 1 }),
    ]);
    const before = state.players[0].hand.length;
    const result = drawCard(beginTrace(state), 0);
    expect(result.state.players[0].hand).toHaveLength(before + 2);
    expect(eventsOfType(result.events, 'cardDrawn')).toHaveLength(2);
  });

  it('leaves the other player’s draws alone', () => {
    const state = withReplacements(board(), [replacement({ kind: 'draw', player: 0 }, { kind: 'skipDraw' })]);
    const before = state.players[1].hand.length;
    const result = drawCard(beginTrace(state), 1);
    expect(result.state.players[1].hand).toHaveLength(before + 1);
  });

  it('doubles life gain', () => {
    const state = withReplacements(board(), [
      replacement({ kind: 'lifeGain', player: 0 }, { kind: 'multiplyLifeGain', factor: 2 }),
    ]);
    const result = gainLife(beginTrace(state), 0, 3, false);
    expect(lifeOf(result.state, 0)).toBe(26);
    expect(eventsOfType(result.events, 'lifeChanged')[0]?.delta).toBe(6);
  });

  it('brings a permanent onto the battlefield tapped and with a counter', () => {
    const start = board();
    const wallOid = handOidOf(start, 0, 'Rep Wall');
    const state = withReplacements(start, [
      replacement(
        { kind: 'enters', oid: wallOid, controller: null },
        { kind: 'entersTapped' },
        {
          ts: 1,
        },
      ),
      replacement(
        { kind: 'enters', oid: wallOid, controller: null },
        { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 1 },
        { ts: 2 },
      ),
    ]);
    const result = moveObject(beginTrace(state), wallOid, 'battlefield');
    const placed = getObject(result.state, wallOid);
    expect(placed.zone).toBe('battlefield');
    expect(placed.tapped).toBe(true);
    expect(placed.counters).toEqual({ plusOnePlusOne: 1, minusOneMinusOne: 0 });
    // Layer 7d picks the counter up: a 0/5 wall is a 1/6.
    expect(powerOf(result.state, wallOid)).toBe(1);
    expect(toughnessOf(result.state, wallOid)).toBe(6);
    expect(eventsOfType(result.events, 'countersChanged')).toHaveLength(1);
  });

  it('does nothing at all when there are no replacement effects', () => {
    const state = board();
    const outcome = applyReplacements(state, { kind: 'draw', player: 0, count: 1 });
    expect(outcome.event).toEqual({ kind: 'draw', player: 0, count: 1 });
    expect(outcome.appliedIds).toEqual([]);
    expect(outcome.replacements).toBe(state.replacements);
  });
});
