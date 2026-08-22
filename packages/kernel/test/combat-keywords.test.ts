import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '@mtg/kernel';
import { canBlock, eligibleAttackers, eventsOfType, scenario, validateBlocks } from '@mtg/kernel';
import { creature } from './cards';
import { damageOn, inGraveyard, oidOf, playCombat } from './helpers';

const bear = creature('Bear', 2, 2);
const sentry = creature('Sentry', 2, 2, { keywords: ['vigilance'] });
const raider = creature('Raider', 2, 1, { keywords: ['haste'] });
const drake = creature('Drake', 2, 2, { keywords: ['flying'] });
const spider = creature('Spider', 1, 4, { keywords: ['reach'] });
const brute = creature('Brute', 3, 3, { keywords: ['menace'] });
const duelist = creature('Duelist', 2, 2, { keywords: ['firstStrike'] });
const paladin = creature('Paladin', 2, 2, { keywordAbilities: [{ kind: 'doubleStrike' }] });
const adder = creature('Adder', 1, 1, { keywords: ['deathtouch'] });
const ox = creature('Ox', 5, 5);
const knight = creature('Knight', 3, 3, { keywords: ['lifelink'] });
const beast = creature('Beast', 5, 5, { keywords: ['trample'] });
const wall = creature('Wall', 0, 2);

describe('vigilance', () => {
  it('keeps the attacker untapped, while a plain creature taps', () => {
    const start = scenario({
      battlefield: [
        { card: sentry, controller: 0 },
        { card: bear, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const sentryOid = oidOf(start.state, 'Sentry');
    const bearOid = oidOf(start.state, 'Bear');
    const done = playCombat(start, { attackers: [sentryOid, bearOid] });
    expect(done.state.objects[sentryOid]?.tapped).toBe(false);
    expect(done.state.objects[bearOid]?.tapped).toBe(true);
    expect(done.state.players[1].life).toBe(16);
  });
});

describe('haste', () => {
  it('lets a creature that just arrived attack, and holds back one that cannot', () => {
    const start = scenario({
      battlefield: [
        { card: raider, controller: 0, summoningSick: true },
        { card: bear, controller: 0, summoningSick: true },
      ],
      step: 'declareAttackers',
    });
    const eligible = eligibleAttackers(start.state);
    expect(eligible).toEqual([oidOf(start.state, 'Raider')]);
  });
});

describe('flying and reach', () => {
  it('cannot be blocked by a ground creature', () => {
    const start = scenario({
      battlefield: [
        { card: drake, controller: 0 },
        { card: bear, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const drakeOid = oidOf(start.state, 'Drake');
    const bearOid = oidOf(start.state, 'Bear');
    expect(canBlock(start.state, bearOid, drakeOid)).toBe(false);

    const done = playCombat(start, {
      attackers: [drakeOid],
      blocks: [],
    });
    expect(done.state.players[1].life).toBe(18);
  });

  it('can be blocked by a flyer or by reach', () => {
    const start = scenario({
      battlefield: [
        { card: drake, controller: 0 },
        { card: spider, controller: 1 },
        { card: bear, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const drakeOid = oidOf(start.state, 'Drake');
    const spiderOid = oidOf(start.state, 'Spider');
    expect(canBlock(start.state, spiderOid, drakeOid)).toBe(true);

    const done = playCombat(start, {
      attackers: [drakeOid],
      blocks: [{ blocker: spiderOid, attacker: drakeOid }],
    });
    expect(done.state.players[1].life).toBe(20);
    expect(damageOn(done.state, spiderOid)).toBe(2);
    expect(damageOn(done.state, drakeOid)).toBe(1);
  });
});

describe('menace', () => {
  it('rejects a single blocker and accepts two', () => {
    const start = scenario({
      battlefield: [
        { card: brute, controller: 0 },
        { card: bear, controller: 1 },
        { card: wall, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const bruteOid = oidOf(start.state, 'Brute');
    const bearOid = oidOf(start.state, 'Bear');
    const wallOid = oidOf(start.state, 'Wall');
    const unblocked = playCombat(start, { attackers: [bruteOid], blocks: [] });
    expect(unblocked.state.players[1].life).toBe(17);

    const attacking = withAttack(start.state, bruteOid);
    expect(validateBlocks(attacking, 1, [{ blocker: bearOid, attacker: bruteOid }])).toMatch(/menace/);
    expect(
      validateBlocks(attacking, 1, [
        { blocker: bearOid, attacker: bruteOid },
        { blocker: wallOid, attacker: bruteOid },
      ]),
    ).toBeNull();
  });

  it('is enforced through the declaration action itself', () => {
    const start = scenario({
      battlefield: [
        { card: brute, controller: 0 },
        { card: bear, controller: 1 },
        { card: wall, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const bruteOid = oidOf(start.state, 'Brute');
    const bearOid = oidOf(start.state, 'Bear');
    const wallOid = oidOf(start.state, 'Wall');
    const done = playCombat(start, {
      attackers: [bruteOid],
      blocks: [
        { blocker: bearOid, attacker: bruteOid },
        { blocker: wallOid, attacker: bruteOid },
      ],
    });
    expect(done.state.players[1].life).toBe(20);
    expect(inGraveyard(done.state, bearOid)).toBe(true);
  });
});

describe('first strike', () => {
  it('kills before the ordinary damage step, so the blocker never strikes back', () => {
    const start = scenario({
      battlefield: [
        { card: duelist, controller: 0 },
        { card: bear, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const duelistOid = oidOf(start.state, 'Duelist');
    const bearOid = oidOf(start.state, 'Bear');
    const done = playCombat(start, {
      attackers: [duelistOid],
      blocks: [{ blocker: bearOid, attacker: duelistOid }],
    });
    expect(inGraveyard(done.state, bearOid)).toBe(true);
    expect(damageOn(done.state, duelistOid)).toBe(0);
    const steps = eventsOfType(done.events, 'combatDamageStep').map((event) => event.firstStrike);
    expect(steps).toEqual([true, false]);
  });

  it('does not create a first-strike step when nobody has it', () => {
    const start = scenario({
      battlefield: [
        { card: bear, controller: 0 },
        { card: wall, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const done = playCombat(start, { attackers: [oidOf(start.state, 'Bear')] });
    expect(eventsOfType(done.events, 'combatDamageStep').map((event) => event.firstStrike)).toEqual([false]);
  });
});

/**
 * `mtg-zd0y`. Double strike is the only keyword in this file whose consequence
 * is a second *step* rather than a restriction on one, so each case here pins a
 * different half of CR 702.4: that the first-strike step exists at all when
 * nobody has first strike (702.4b), that both steps land (702.4c), and that the
 * second step is computed against the board the first one left behind.
 */
describe('double strike', () => {
  it('deals its damage twice when unblocked', () => {
    const start = scenario({
      battlefield: [{ card: paladin, controller: 0 }],
      step: 'declareAttackers',
    });
    const done = playCombat(start, { attackers: [oidOf(start.state, 'Paladin')] });
    expect(done.state.players[1].life).toBe(16);
    const steps = eventsOfType(done.events, 'combatDamageStep').map((event) => event.firstStrike);
    expect(steps).toEqual([true, false]);
  });

  it('creates the first-strike step on its own, with no first striker anywhere', () => {
    const start = scenario({
      battlefield: [
        { card: paladin, controller: 0 },
        { card: wall, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const paladinOid = oidOf(start.state, 'Paladin');
    const wallOid = oidOf(start.state, 'Wall');
    const done = playCombat(start, {
      attackers: [paladinOid],
      blocks: [{ blocker: wallOid, attacker: paladinOid }],
    });
    expect(eventsOfType(done.events, 'combatDamageStep').map((event) => event.firstStrike)).toEqual([
      true,
      false,
    ]);
    expect(inGraveyard(done.state, wallOid)).toBe(true);
  });

  it('kills its blocker in the first step and takes nothing back in the second', () => {
    const start = scenario({
      battlefield: [
        { card: paladin, controller: 0 },
        { card: bear, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const paladinOid = oidOf(start.state, 'Paladin');
    const bearOid = oidOf(start.state, 'Bear');
    const done = playCombat(start, {
      attackers: [paladinOid],
      blocks: [{ blocker: bearOid, attacker: paladinOid }],
    });
    expect(inGraveyard(done.state, bearOid)).toBe(true);
    expect(damageOn(done.state, paladinOid)).toBe(0);
    // No trample, so the second hit has nowhere to go once the blocker is gone.
    expect(done.state.players[1].life).toBe(20);
  });

  it('accumulates both hits on a blocker that survived the first', () => {
    const start = scenario({
      battlefield: [
        { card: paladin, controller: 0 },
        { card: spider, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const paladinOid = oidOf(start.state, 'Paladin');
    const spiderOid = oidOf(start.state, 'Spider');
    const done = playCombat(start, {
      attackers: [paladinOid],
      blocks: [{ blocker: spiderOid, attacker: paladinOid }],
    });
    // 2 power against 4 toughness kills nothing in either step alone, so the
    // 1/4 in the graveyard is the two hits added together. The spider strikes
    // back in the ordinary step only, which is the whole asymmetry: one hit
    // taken for two dealt.
    expect(inGraveyard(done.state, spiderOid)).toBe(true);
    expect(inGraveyard(done.state, paladinOid)).toBe(false);
    expect(damageOn(done.state, paladinOid)).toBe(1);
  });
});

describe('deathtouch', () => {
  it('makes any nonzero damage lethal', () => {
    const start = scenario({
      battlefield: [
        { card: adder, controller: 0 },
        { card: ox, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const adderOid = oidOf(start.state, 'Adder');
    const oxOid = oidOf(start.state, 'Ox');
    const done = playCombat(start, {
      attackers: [adderOid],
      blocks: [{ blocker: oxOid, attacker: adderOid }],
    });
    expect(inGraveyard(done.state, oxOid)).toBe(true);
    expect(inGraveyard(done.state, adderOid)).toBe(true);
  });
});

describe('lifelink', () => {
  it('gains life equal to the damage dealt', () => {
    const start = scenario({
      battlefield: [{ card: knight, controller: 0 }],
      life: [20, 20],
      step: 'declareAttackers',
    });
    const done = playCombat(start, { attackers: [oidOf(start.state, 'Knight')] });
    expect(done.state.players[0].life).toBe(23);
    expect(done.state.players[1].life).toBe(17);
    const gains = eventsOfType(done.events, 'lifeChanged').filter((event) => event.reason === 'lifelink');
    expect(gains).toHaveLength(1);
  });
});

describe('trample', () => {
  it('pushes damage past a blocker once lethal is assigned', () => {
    const start = scenario({
      battlefield: [
        { card: beast, controller: 0 },
        { card: bear, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const beastOid = oidOf(start.state, 'Beast');
    const bearOid = oidOf(start.state, 'Bear');
    const done = playCombat(start, {
      attackers: [beastOid],
      blocks: [{ blocker: bearOid, attacker: beastOid }],
    });
    expect(inGraveyard(done.state, bearOid)).toBe(true);
    expect(done.state.players[1].life).toBe(17);
  });

  it('keeps every point on the blockers without trample', () => {
    const start = scenario({
      battlefield: [
        { card: ox, controller: 0 },
        { card: bear, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const done = playCombat(start, {
      attackers: [oidOf(start.state, 'Ox')],
      blocks: [{ blocker: oidOf(start.state, 'Bear'), attacker: oidOf(start.state, 'Ox') }],
    });
    expect(done.state.players[1].life).toBe(20);
  });
});

/** A state that already has `attacker` attacking, for direct legality checks. */
function withAttack(state: GameState, attacker: ObjectId): GameState {
  return {
    ...state,
    combat: { ...state.combat, attacks: [{ oid: attacker, defender: 1 }] },
  };
}
