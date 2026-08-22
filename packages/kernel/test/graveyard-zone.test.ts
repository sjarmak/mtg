/**
 * CR 611.2c in the kernel: a graveyard is a zone the layer system does not
 * reach, so a card that counts or selects there gets the "second, weaker
 * selector" `zone-filter.ts` argues for — printed values only, no layer walk —
 * rather than `ObjectFilter`'s battlefield/stack-only path.
 *
 * Two primitives exercise it and this file tests both:
 *
 *  - `creatureCardsInPlayerGraveyard`, an `EffectScope` that reads the printed
 *    card type off each graveyard member, mirroring the hand scope
 *    `reveal-hand.test.ts` already covers (a graveyard needs no reveal step
 *    first, because CR 400.2 makes it public already).
 *  - `cardsInGraveyard`, a `ComputedAmount` that reads a graveyard's length at
 *    the moment the effect applies, mirroring the evaluation-order claim
 *    `computed-amount.test.ts` makes for `exiledThisResolution` — a mill-then-
 *    count spell has to see its own mill, and a count-then-mill spell must not.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import { objectsInEffectScope, playerOf, reduce, reduceAll, scenario, stateFingerprint } from '@mtg/kernel';
import { creature, SWAMP, sorcery } from './cards';

const REAP = sorcery(
  'Void Reap',
  [{ kind: 'exileTarget', scope: 'creatureCardsInPlayerGraveyard', target: { kind: 'targetOpponent' } }],
  { generic: 2, B: 1 },
);

const CARDS_IN_YOUR_GRAVEYARD = { kind: 'cardsInGraveyard', whose: 'you' } as const;
const CARDS_IN_EACH_GRAVEYARD = { kind: 'cardsInGraveyard', whose: 'each' } as const;

const HARVEST = sorcery(
  'Void Harvest',
  [{ kind: 'gainLife', amount: CARDS_IN_YOUR_GRAVEYARD, target: { kind: 'targetPlayer' } }],
  { generic: 2, B: 1 },
);

const MILL_THEN_HARVEST = sorcery(
  'Void Reap Feast',
  [
    { kind: 'millCards', count: 3, target: { kind: 'targetPlayer' } },
    { kind: 'gainLife', amount: CARDS_IN_YOUR_GRAVEYARD, target: { kind: 'targetPlayer' } },
  ],
  { generic: 2, B: 1 },
);

const HARVEST_THEN_MILL = sorcery(
  'Void Feast Reap',
  [
    { kind: 'gainLife', amount: CARDS_IN_YOUR_GRAVEYARD, target: { kind: 'targetPlayer' } },
    { kind: 'millCards', count: 3, target: { kind: 'targetPlayer' } },
  ],
  { generic: 2, B: 1 },
);

const HARVEST_EACH = sorcery(
  'Void Communal Feast',
  [{ kind: 'gainLife', amount: CARDS_IN_EACH_GRAVEYARD, target: { kind: 'targetPlayer' } }],
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

/** Casts player 0's only card, its targets all naming the given player. */
function castTargeting(start: GameState, effectCount: number, target: 0 | 1): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const targets = Array.from({ length: effectCount }, () => ({ kind: 'player', player: target }) as const);
  const put = reduce(start, { type: 'castSpell', player: 0, oid, targets });
  return reduceAll(put.state, [pass(put.state), { type: 'passPriority', player: 1 }]).state;
}

describe('exiling creature cards out of a graveyard', () => {
  it('takes the creature cards and leaves the rest of the graveyard alone', () => {
    const start = scenario({
      battlefield: swamps(3, 0),
      hands: [[REAP], []],
      graveyards: [[], [creature('Void Scout', 1, 1), SWAMP, creature('Void Brute', 3, 3)]],
    }).state;
    const before = [...playerOf(start, 1).graveyard];
    const creatures = objectsInEffectScope(start, 'creatureCardsInPlayerGraveyard', 1);
    expect(creatures).toHaveLength(2);

    const after = castTargeting(start, 1, 1);
    for (const oid of creatures) expect(after.objects[oid]?.zone, oid).toBe('exile');
    expect(after.exile).toEqual([...creatures]);
    const survivor = before.find((oid) => !creatures.includes(oid)) ?? '';
    expect(playerOf(after, 1).graveyard).toEqual([survivor]);
  });

  /**
   * Zone order, the same determinism claim `reveal-hand.test.ts` makes for a
   * hand scope: the group is read once, in the order the graveyard list
   * holds, and two identical games come out identical.
   */
  it('is fixed before the first move and ordered by the zone list', () => {
    const bodies = [creature('First In', 1, 1), creature('Second In', 2, 2), creature('Third In', 3, 3)];
    const build = (): GameState =>
      scenario({ battlefield: swamps(3, 0), hands: [[REAP], []], graveyards: [[], [...bodies]] }).state;

    const start = build();
    const group = objectsInEffectScope(start, 'creatureCardsInPlayerGraveyard', 1);
    expect(group.map((oid) => start.objects[oid]?.card.name)).toEqual(['First In', 'Second In', 'Third In']);

    const after = castTargeting(start, 1, 1);
    expect(after.exile).toEqual([...group]);
    expect(playerOf(after, 1).graveyard).toEqual([]);
    expect(stateFingerprint(castTargeting(build(), 1, 1))).toBe(stateFingerprint(after));
  });

  it('resolves against an empty graveyard without exiling anything', () => {
    const start = scenario({ battlefield: swamps(3, 0), hands: [[REAP], []], graveyards: [[], []] }).state;
    const after = castTargeting(start, 1, 1);
    expect(after.exile).toEqual([]);
  });
});

describe('counting the cards in a graveyard', () => {
  it("reads the caster's own graveyard, not an opponent's", () => {
    const start = scenario({
      battlefield: swamps(3, 0),
      hands: [[HARVEST], []],
      graveyards: [
        [creature('Void Scout', 1, 1), creature('Void Brute', 3, 3)],
        [SWAMP, SWAMP, SWAMP],
      ],
    }).state;
    const after = castTargeting(start, 1, 0);
    expect(playerOf(after, 0).life).toBe(22);
  });

  /**
   * Order is the card, the same claim `computed-amount.test.ts` makes for
   * `exiledThisResolution`: a count that comes after an earlier effect of the
   * same spell sees what that effect did.
   */
  it('counts what an earlier effect of the same spell already milled into it', () => {
    const start = scenario({
      battlefield: swamps(6, 0),
      hands: [[MILL_THEN_HARVEST], []],
      graveyards: [[creature('Void Scout', 1, 1)], []],
    }).state;
    const after = castTargeting(start, 2, 0);
    // One card already there, plus the three this same spell just milled.
    expect(playerOf(after, 0).life).toBe(24);
  });

  it('leaves the mill uncounted when the counting clause resolves first', () => {
    const start = scenario({
      battlefield: swamps(6, 0),
      hands: [[HARVEST_THEN_MILL], []],
      graveyards: [[creature('Void Scout', 1, 1)], []],
    }).state;
    const after = castTargeting(start, 2, 0);
    // Only the one card that was already there when the count ran.
    expect(playerOf(after, 0).life).toBe(21);
  });

  it("'each' sums both players' graveyards", () => {
    const start = scenario({
      battlefield: swamps(3, 0),
      hands: [[HARVEST_EACH], []],
      graveyards: [
        [creature('Void Scout', 1, 1), creature('Void Brute', 3, 3)],
        [SWAMP, SWAMP, SWAMP],
      ],
    }).state;
    const after = castTargeting(start, 1, 0);
    expect(playerOf(after, 0).life).toBe(25);
  });
});
