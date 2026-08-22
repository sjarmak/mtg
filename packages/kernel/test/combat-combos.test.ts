import { describe, expect, it } from 'vitest';
import {
  assignAttackerDamage,
  canBlock,
  eventsOfType,
  lethalDamageFor,
  pendingDecision,
  scenario,
  validateBlocks,
} from '@mtg/kernel';
import { creature, instant, MOUNTAIN } from './cards';
import { apply, damageOn, handOidOf, inGraveyard, oidOf, oidsOf, playCombat } from './helpers';

const bolt = instant('Combo Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
  generic: 1,
  R: 1,
});

describe('deathtouch plus trample', () => {
  it('assigns one damage per blocker and tramples the rest through', () => {
    const stalker = creature('Stalker', 5, 5, { keywords: ['deathtouch', 'trample'] });
    const guard = creature('Guard', 3, 3);
    const start = scenario({
      battlefield: [
        { card: stalker, controller: 0 },
        { card: guard, controller: 1 },
        { card: guard, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const stalkerOid = oidOf(start.state, 'Stalker');
    const [guardA, guardB] = oidsOf(start.state, 'Guard');

    // 1 is lethal to each blocker because of deathtouch, so 3 tramples over.
    expect(lethalDamageFor(start.state, guardA ?? '', true)).toBe(1);

    const done = playCombat(start, {
      attackers: [stalkerOid],
      blocks: [
        { blocker: guardA ?? '', attacker: stalkerOid },
        { blocker: guardB ?? '', attacker: stalkerOid },
      ],
    });
    expect(inGraveyard(done.state, guardA ?? '')).toBe(true);
    expect(inGraveyard(done.state, guardB ?? '')).toBe(true);
    expect(done.state.players[1].life).toBe(17);
    // Two 3/3s striking back is exactly lethal to the 5/5.
    expect(inGraveyard(done.state, stalkerOid)).toBe(true);
  });

  it('without deathtouch it has to pay full lethal before trampling', () => {
    const beast = creature('Big Beast', 5, 5, { keywords: ['trample'] });
    const guard = creature('Tough Guard', 3, 3);
    const start = scenario({
      battlefield: [
        { card: beast, controller: 0 },
        { card: guard, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const beastOid = oidOf(start.state, 'Big Beast');
    const guardOid = oidOf(start.state, 'Tough Guard');
    const done = playCombat(start, {
      attackers: [beastOid],
      blocks: [{ blocker: guardOid, attacker: beastOid }],
    });
    expect(done.state.players[1].life).toBe(18);
  });

  it('counts damage already marked when working out lethal', () => {
    const beast = creature('Marked Beast', 3, 3, { keywords: ['trample'] });
    const guard = creature('Wounded Guard', 1, 4);
    const start = scenario({
      battlefield: [
        { card: beast, controller: 0 },
        { card: guard, controller: 1, damage: 3 },
      ],
      step: 'declareAttackers',
    });
    const beastOid = oidOf(start.state, 'Marked Beast');
    const guardOid = oidOf(start.state, 'Wounded Guard');
    expect(lethalDamageFor(start.state, guardOid, false)).toBe(1);
    const done = playCombat(start, {
      attackers: [beastOid],
      blocks: [{ blocker: guardOid, attacker: beastOid }],
    });
    expect(done.state.players[1].life).toBe(18);
    expect(inGraveyard(done.state, guardOid)).toBe(true);
  });
});

describe('first strike plus deathtouch', () => {
  it('kills the blocker before it can deal any damage back', () => {
    const assassin = creature('Assassin', 1, 1, { keywords: ['firstStrike', 'deathtouch'] });
    const giant = creature('Giant', 4, 4);
    const start = scenario({
      battlefield: [
        { card: assassin, controller: 0 },
        { card: giant, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const assassinOid = oidOf(start.state, 'Assassin');
    const giantOid = oidOf(start.state, 'Giant');
    const done = playCombat(start, {
      attackers: [assassinOid],
      blocks: [{ blocker: giantOid, attacker: assassinOid }],
    });
    expect(inGraveyard(done.state, giantOid)).toBe(true);
    expect(inGraveyard(done.state, assassinOid)).toBe(false);
    expect(damageOn(done.state, assassinOid)).toBe(0);
  });

  it('a first-strike blocker with deathtouch kills the attacker first', () => {
    const attacker = creature('Charger', 4, 4);
    const defenderCreature = creature('Viper', 1, 1, { keywords: ['firstStrike', 'deathtouch'] });
    const start = scenario({
      battlefield: [
        { card: attacker, controller: 0 },
        { card: defenderCreature, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const chargerOid = oidOf(start.state, 'Charger');
    const viperOid = oidOf(start.state, 'Viper');
    const done = playCombat(start, {
      attackers: [chargerOid],
      blocks: [{ blocker: viperOid, attacker: chargerOid }],
    });
    expect(inGraveyard(done.state, chargerOid)).toBe(true);
    expect(inGraveyard(done.state, viperOid)).toBe(false);
  });
});

describe('flying with menace', () => {
  it('needs two blockers that can also handle the evasion', () => {
    const roc = creature('Roc', 3, 3, { keywords: ['flying', 'menace'] });
    const hawk = creature('Hawk', 1, 1, { keywords: ['flying'] });
    const ground = creature('Footman', 2, 2);
    const start = scenario({
      battlefield: [
        { card: roc, controller: 0 },
        { card: hawk, controller: 1 },
        { card: ground, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const rocOid = oidOf(start.state, 'Roc');
    const hawkOid = oidOf(start.state, 'Hawk');
    const footmanOid = oidOf(start.state, 'Footman');
    expect(canBlock(start.state, footmanOid, rocOid)).toBe(false);

    const declared = advanceToBlockers(
      apply(start, { type: 'declareAttackers', player: 0, attackers: [{ oid: rocOid, defender: 1 }] }),
    );
    // The only legal blocker is the hawk, and one blocker is not enough.
    expect(validateBlocks(declared.state, 1, [{ blocker: hawkOid, attacker: rocOid }])).toMatch(/menace/);
    expect(
      validateBlocks(declared.state, 1, [
        { blocker: hawkOid, attacker: rocOid },
        { blocker: footmanOid, attacker: rocOid },
      ]),
    ).toMatch(/evasion/);
    const decision = pendingDecision(declared.state);
    expect(decision?.kind).toBe('declareBlockers');
    expect(decision?.options).toEqual([{ type: 'declareBlockers', player: 1, blocks: [] }]);
  });
});

describe('damage assignment order', () => {
  it('is a real choice: the attacker picks who eats the damage', () => {
    const ogre = creature('Ogre', 4, 4);
    const shield = creature('Shieldbearer', 1, 5);
    const pike = creature('Pikeman', 1, 6);
    const build = () =>
      scenario({
        battlefield: [
          { card: ogre, controller: 0 },
          { card: shield, controller: 1 },
          { card: pike, controller: 1 },
        ],
        step: 'declareAttackers',
      });

    const first = build();
    const ogreOid = oidOf(first.state, 'Ogre');
    const shieldOid = oidOf(first.state, 'Shieldbearer');
    const pikeOid = oidOf(first.state, 'Pikeman');
    const blocks = [
      { blocker: shieldOid, attacker: ogreOid },
      { blocker: pikeOid, attacker: ogreOid },
    ];

    const shieldFirst = playCombat(first, {
      attackers: [ogreOid],
      blocks,
      orders: [{ attacker: ogreOid, blockers: [shieldOid, pikeOid] }],
    });
    expect(damageOn(shieldFirst.state, shieldOid)).toBe(4);
    expect(damageOn(shieldFirst.state, pikeOid)).toBe(0);

    const pikeFirst = playCombat(build(), {
      attackers: [ogreOid],
      blocks,
      orders: [{ attacker: ogreOid, blockers: [pikeOid, shieldOid] }],
    });
    expect(damageOn(pikeFirst.state, pikeOid)).toBe(4);
    expect(damageOn(pikeFirst.state, shieldOid)).toBe(0);

    expect(eventsOfType(shieldFirst.events, 'blockerOrderChosen')).toHaveLength(1);
  });
});

describe('a blocker removed after blocks are declared', () => {
  it('leaves a plain attacker dealing nothing and a trampler hitting for everything', () => {
    const trampler = creature('Rhino', 3, 3, { keywords: ['trample'] });
    const plain = creature('Bull', 3, 3);
    const chump = creature('Chump', 0, 1);

    const run = (attackerCard: typeof trampler): number => {
      const start = scenario({
        battlefield: [
          { card: attackerCard, controller: 0 },
          { card: MOUNTAIN, controller: 0 },
          { card: MOUNTAIN, controller: 0 },
          { card: chump, controller: 1 },
        ],
        hands: [[bolt], []],
        step: 'declareAttackers',
      });
      const attackerOid = oidOf(start.state, attackerCard.name);
      const chumpOid = oidOf(start.state, 'Chump');
      const boltOid = handOidOf(start.state, 0, 'Combo Bolt');

      let current = apply(start, {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: attackerOid, defender: 1 }],
      });
      current = advanceToBlockers(current);
      current = apply(current, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker: chumpOid, attacker: attackerOid }],
      });
      // Burn the blocker away after blocks are locked in.
      current = apply(current, {
        type: 'castSpell',
        player: 0,
        oid: boltOid,
        targets: [{ kind: 'permanent', oid: chumpOid }],
      });
      current = apply(current, { type: 'passPriority', player: 0 });
      current = apply(current, { type: 'passPriority', player: 1 });
      expect(inGraveyard(current.state, chumpOid)).toBe(true);

      for (let guard = 0; guard < 20; guard += 1) {
        if (current.state.turn.step === 'endCombat') break;
        const priority = current.state.turn.priority;
        if (priority === null) throw new Error('unexpected non-priority decision');
        current = apply(current, { type: 'passPriority', player: priority });
      }
      return current.state.players[1].life;
    };

    expect(run(plain)).toBe(20);
    expect(run(trampler)).toBe(17);
  });
});

describe('assignAttackerDamage', () => {
  it('is pure and reports the split it will apply', () => {
    const brute = creature('Splitter', 6, 6, { keywords: ['trample'] });
    const blockerCard = creature('Blocker', 2, 2);
    const start = scenario({
      battlefield: [
        { card: brute, controller: 0 },
        { card: blockerCard, controller: 1 },
        { card: blockerCard, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const bruteOid = oidOf(start.state, 'Splitter');
    const [a, b] = oidsOf(start.state, 'Blocker');
    const declared = advanceToBlockers(
      apply(start, { type: 'declareAttackers', player: 0, attackers: [{ oid: bruteOid, defender: 1 }] }),
    );
    const blocked = apply(declared, {
      type: 'declareBlockers',
      player: 1,
      blocks: [
        { blocker: a ?? '', attacker: bruteOid },
        { blocker: b ?? '', attacker: bruteOid },
      ],
    });
    const split = assignAttackerDamage(blocked.state, bruteOid, 6);
    expect(split).toEqual([
      { recipient: a, amount: 2 },
      { recipient: b, amount: 2 },
      { recipient: 'defender', amount: 2 },
    ]);
  });
});

/** Passes priority until blockers are being declared. */
function advanceToBlockers(from: ReturnType<typeof apply>): ReturnType<typeof apply> {
  let current = from;
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('game ended before blockers');
    if (decision.kind === 'declareBlockers') return current;
    if (decision.kind !== 'priority') throw new Error(`unexpected decision ${decision.kind}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('never reached the declare-blockers step');
}
