/**
 * `countMatching`: an amount read off the board rather than off an event log.
 *
 * `computed-amount.test.ts` covers `exiledThisResolution`, whose count is a
 * span over the trace. This one is a snapshot of `derivedCharacteristics` at
 * the moment the effect applies — CR 107.3h's "equal to the number of
 * Zombies you control" family — so what is worth asserting here is different:
 * the count is always relative to the *caster*, a `cardTypes`/`subtypes`
 * constraint narrows it, and layer-4 type changes are read the same way a
 * static ability's own `countOf` reads them (`applyPtDefine` in
 * `characteristics.ts`), because both go through `selectMatching`.
 */
import { describe, expect, it } from 'vitest';
import type { Amount } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { creature, SWAMP, sorcery } from './cards';

const CREATURE_COUNT: Amount = { kind: 'countMatching', filter: { cardTypes: ['creature'] } };
const ZOMBIE_COUNT: Amount = {
  kind: 'countMatching',
  filter: { cardTypes: ['creature'], subtypes: ['Zombie'] },
};

/** "Deals damage to target opponent equal to the number of creatures you control." */
const SWARM_CALL = sorcery(
  'Swarm Call',
  [{ kind: 'dealDamage', amount: CREATURE_COUNT, target: { kind: 'targetOpponent' } }],
  { generic: 2, B: 1 },
);

const ZOMBIE_CALL = sorcery(
  'Zombie Call',
  [{ kind: 'dealDamage', amount: ZOMBIE_COUNT, target: { kind: 'targetOpponent' } }],
  { generic: 2, B: 1 },
);

function swamps(count: number, controller: 0 | 1): { card: typeof SWAMP; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller }));
}

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

function castAtOpponent(start: GameState): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'player', player: 1 }],
  });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

describe('an amount counted off the board', () => {
  it('reads the number of creatures the caster controls, not the opponent', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Ally Scout', 1, 1), controller: 0 },
        { card: creature('Ally Brute', 3, 3), controller: 0 },
        { card: creature('Ally Runner', 2, 1), controller: 0 },
        // Two on the opponent's side, which must not be counted.
        { card: creature('Foe Scout', 1, 1), controller: 1 },
        { card: creature('Foe Brute', 3, 3), controller: 1 },
      ],
      hands: [[SWARM_CALL], []],
    }).state;

    const after = castAtOpponent(start);
    expect(playerOf(after, 1).life).toBe(17); // 20 - 3 allies
  });

  it('is zero with no matching permanents, not an error', () => {
    const start = scenario({
      battlefield: [...swamps(3, 0)],
      hands: [[SWARM_CALL], []],
    }).state;

    const after = castAtOpponent(start);
    expect(playerOf(after, 1).life).toBe(20);
  });

  it('narrows by subtype: an Ogre does not count as a Zombie', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Shambler', 1, 1, { subtypes: ['Zombie'] }), controller: 0 },
        { card: creature('Rotter', 2, 2, { subtypes: ['Zombie'] }), controller: 0 },
        { card: creature('Bruiser', 4, 4, { subtypes: ['Ogre'] }), controller: 0 },
      ],
      hands: [[ZOMBIE_CALL], []],
    }).state;

    const after = castAtOpponent(start);
    expect(playerOf(after, 1).life).toBe(18); // 20 - 2 Zombies, the Ogre excluded
  });

  it('is read at resolution, after an earlier effect of the same spell can change it', () => {
    // "Destroy target creature, then deal damage equal to the number of
    // creatures you control": the caster aims the destroy at their own
    // creature below, and the destroyed body must not count.
    // `destroyPermanent`'s only legal target kind is `targetCreature` — it
    // has no "you control" variant (`validate/effects.ts`'s `EFFECT_RULES`)
    // — so the restriction to the caster's own board is enforced by which
    // object this test's `castSpell` action names, not by the effect's
    // printed target kind.
    const shrinkThenSwing = sorcery(
      'Grim Bargain',
      [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
        { kind: 'dealDamage', amount: CREATURE_COUNT, target: { kind: 'targetOpponent' } },
      ],
      { generic: 1, B: 1 },
    );
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Sacrifice Fodder', 1, 1), controller: 0 },
        { card: creature('Keeper One', 2, 2), controller: 0 },
        { card: creature('Keeper Two', 2, 2), controller: 0 },
      ],
      hands: [[shrinkThenSwing], []],
    }).state;

    const fodder =
      start.battlefield.find((oid) => start.objects[oid]?.card.name === 'Sacrifice Fodder') ?? '';
    const oid = playerOf(start, 0).hand[0] ?? '';
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [
        { kind: 'permanent', oid: fodder },
        { kind: 'player', player: 1 },
      ],
    });
    const after = reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
    // Two Keepers remain when damage is counted, not three.
    expect(playerOf(after, 1).life).toBe(18);
  });
});
