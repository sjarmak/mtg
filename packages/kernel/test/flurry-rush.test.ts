/**
 * Flurry rush N (`selfBlocksOrIsBlockedByGreaterPower`, CR 509.1 both halves).
 *
 * The ability word the flagship set prints on the creatures that win a
 * combat through timing rather than size, so every assertion here is about the
 * *pairing* rather than about one creature: the trigger has to fire when the
 * source blocks something bigger and when something bigger blocks the source,
 * and it has to stay silent when the other creature is the same size or
 * smaller. `combat-damage-to-player-and-blocks.test.ts` pins the unfiltered
 * `selfBlocks` beside it and reads the same `blockersDeclared` event, which is
 * why the two files share a harness: `playCombat`'s `blocks` script is enough
 * to reach declare-blockers, and the trigger resolves on the priority pass
 * before combat damage.
 *
 * That ordering is the mechanic, not an implementation detail. Flurry rush
 * damage lands *before* combat damage, so a rank that finishes the job kills
 * the attacker before it ever swings back — the perfect dodge the card is named
 * for. The last case below is exactly that.
 *
 * The assertions read the `damageDealt` events rather than the marks left on
 * the permanents, and the first draft of this file is why: an attacker that
 * takes flurry damage and then combat damage is often dead by the time the
 * combat ends, and a dead permanent carries no marks at all, so every
 * "took 5" assertion read 0 off an object that had already left. Events record
 * what happened; marks record what is still standing.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { flurryRushAbility } from '@mtg/dsl';
import type { ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, scenario } from '@mtg/kernel';
import { creature } from './cards';
import { inGraveyard, oidOf, playCombat } from './helpers';

/** A 3/3 carrying the mechanic at rank 2. */
const DODGER: Card = creature('Flurry Dodger', 3, 3, {
  cost: { generic: 2, W: 1 },
  abilities: [flurryRushAbility(2)],
});

/** Bigger than the dodger and tough enough to survive it, from either side. */
const DIREHORN: Card = creature('Charging Direhorn', 5, 9, { cost: { generic: 4 } });

/** Also bigger, so a double block has two qualifying creatures in it. */
const SILVER_DIREHORN: Card = creature('Silver Direhorn', 4, 8, { cost: { generic: 4 } });

/** Exactly the dodger's power, so "greater" has something to be strict about. */
const EQUAL: Card = creature('Equal Rival', 3, 6, { cost: { generic: 3 } });

/** Smaller than the dodger, and tough enough to survive the block. */
const SMALLER: Card = creature('Lesser Rival', 2, 6, { cost: { generic: 3 } });

/** Big power, two toughness: the rank alone is lethal before combat damage. */
const GLASS_DIREHORN: Card = creature('Glass Direhorn', 6, 2, { cost: { generic: 5 } });

function flurryFires(result: ReduceResult, source: ObjectId): number {
  return eventsOfType(result.events, 'abilityTriggered').filter(
    (event) => event.source === source && event.condition === 'selfBlocksOrIsBlockedByGreaterPower',
  ).length;
}

/** What the source dealt outside combat, per recipient, in the order it landed. */
function abilityDamage(result: ReduceResult, source: ObjectId): readonly (readonly [ObjectId, number])[] {
  return eventsOfType(result.events, 'damageDealt')
    .filter((event) => !event.combat && event.sourceOid === source && event.target.kind === 'permanent')
    .map((event) => [event.target.kind === 'permanent' ? event.target.oid : source, event.amount] as const);
}

describe('flurry rush', () => {
  it('fires when the source blocks a creature with greater power, and damages that creature', () => {
    const start = scenario({
      battlefield: [
        { card: DIREHORN, controller: 0 },
        { card: DODGER, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const direhorn = oidOf(start.state, 'Charging Direhorn');
    const dodger = oidOf(start.state, 'Flurry Dodger');

    const done = playCombat(start, {
      attackers: [direhorn],
      blocks: [{ blocker: dodger, attacker: direhorn }],
    });

    expect(flurryFires(done, dodger)).toBe(1);
    expect(abilityDamage(done, dodger)).toEqual([[direhorn, 2]]);
  });

  it('fires when a creature with greater power blocks the source', () => {
    const start = scenario({
      battlefield: [
        { card: DODGER, controller: 0 },
        { card: DIREHORN, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const dodger = oidOf(start.state, 'Flurry Dodger');
    const direhorn = oidOf(start.state, 'Charging Direhorn');

    const done = playCombat(start, {
      attackers: [dodger],
      blocks: [{ blocker: direhorn, attacker: dodger }],
    });

    expect(flurryFires(done, dodger)).toBe(1);
    expect(abilityDamage(done, dodger)).toEqual([[direhorn, 2]]);
  });

  it('stays silent against equal power, because greater is strict', () => {
    const start = scenario({
      battlefield: [
        { card: EQUAL, controller: 0 },
        { card: DODGER, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const rival = oidOf(start.state, 'Equal Rival');
    const dodger = oidOf(start.state, 'Flurry Dodger');

    const done = playCombat(start, { attackers: [rival], blocks: [{ blocker: dodger, attacker: rival }] });

    expect(flurryFires(done, dodger)).toBe(0);
    expect(abilityDamage(done, dodger)).toEqual([]);
  });

  it('stays silent against smaller power', () => {
    const start = scenario({
      battlefield: [
        { card: SMALLER, controller: 0 },
        { card: DODGER, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const smaller = oidOf(start.state, 'Lesser Rival');
    const dodger = oidOf(start.state, 'Flurry Dodger');

    const done = playCombat(start, {
      attackers: [smaller],
      blocks: [{ blocker: dodger, attacker: smaller }],
    });

    expect(flurryFires(done, dodger)).toBe(0);
    expect(abilityDamage(done, dodger)).toEqual([]);
  });

  it('fires once per larger creature in a double block, each aimed at its own blocker', () => {
    const start = scenario({
      battlefield: [
        { card: DODGER, controller: 0 },
        { card: DIREHORN, controller: 1 },
        { card: SILVER_DIREHORN, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const dodger = oidOf(start.state, 'Flurry Dodger');
    const direhorn = oidOf(start.state, 'Charging Direhorn');
    const silver = oidOf(start.state, 'Silver Direhorn');

    const done = playCombat(start, {
      attackers: [dodger],
      blocks: [
        { blocker: direhorn, attacker: dodger },
        { blocker: silver, attacker: dodger },
      ],
    });

    // Two triggering events under CR 603.2, because the condition names a
    // creature and two creatures satisfy it. The referent is retained per
    // trigger rather than shared, so neither blocker takes both ranks.
    expect(flurryFires(done, dodger)).toBe(2);
    expect([...abilityDamage(done, dodger)].sort()).toEqual(
      [
        [direhorn, 2],
        [silver, 2],
      ].sort(),
    );
  });

  it('kills before the ordinary damage step, so the attacker never strikes back', () => {
    const start = scenario({
      battlefield: [
        { card: GLASS_DIREHORN, controller: 0 },
        { card: DODGER, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const glass = oidOf(start.state, 'Glass Direhorn');
    const dodger = oidOf(start.state, 'Flurry Dodger');

    const done = playCombat(start, { attackers: [glass], blocks: [{ blocker: dodger, attacker: glass }] });

    expect(inGraveyard(done.state, glass)).toBe(true);
    expect(inGraveyard(done.state, dodger)).toBe(false);
  });
});
