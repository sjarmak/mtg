/**
 * A sweep narrowed by a keyword, resolving: `{X}{G}{G}: This creature deals X
 * damage to each creature with flying.`
 *
 * The announcement half of that ability already ran (`x-activation.test.ts`);
 * what this file is about is the group. A `scopeFilter` naming a keyword is
 * compiled by `targetObjectFilter` into an `ObjectFilter`, and `matchesFilter`
 * answers it off `characteristicsOf` — the CR 613 walk, not the printed card.
 * That is the same derivation `hasKeyword` hands `canBlock` for evasion, which
 * is the point: the creature this Spider can be blocked by and the creature its
 * sweep burns are decided once. A second reading would eventually disagree with
 * the first, and the disagreement would be a card that burns a flier it cannot
 * block or blocks one it cannot burn.
 *
 * So the third case below is the load-bearing one. A creature with no printed
 * flying, handed flying by an anthem, is in the group; take the anthem off the
 * board and the same creature is out of it.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { ReduceResult } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { creature, FOREST, keywordAnthem, lands } from './cards';
import { apply, damageOn, oidOf } from './helpers';

/** Silklash Spider: `{X}{G}{G}: … X damage to each creature with flying.` */
const SPIDER = creature('Silklash Spider', 2, 7, {
  cost: { generic: 4, G: 2 },
  keywords: ['reach'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { G: 2, hasX: true } },
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'chosenX' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'], keywords: ['flying'] },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

// Both five toughness, so a sweep this file measures leaves them on the
// battlefield to be measured. A 2/2 pair would have died to the acceptance run's
// X=3 and the assertion would have read "gone" where it means "took three".
const FLIER = creature('Cloud Sentry', 2, 5, { keywords: ['flying'] });
const GROUND = creature('Thicket Ox', 2, 5);

/** Six Forests pays `{X}{G}{G}` up to X=4, so X=3 is inside the board. */
function board(extra: readonly { card: Card; controller: 0 | 1 }[]): ReduceResult {
  return scenario({
    battlefield: [
      { card: SPIDER, controller: 0 },
      ...lands(FOREST, 6).map((land) => ({ card: land, controller: 0 as const })),
      ...extra,
    ],
  });
}

/** Announces X, then lets both players pass so the ability resolves. */
function sweep(from: ReduceResult, x: number): ReduceResult {
  const activated = apply(from, {
    type: 'activateAbility',
    player: 0,
    oid: oidOf(from.state, SPIDER.name),
    abilityIndex: 0,
    // One slot per effect even when the effect chooses nobody (CR 115.1): the
    // slot is present and empty, which is how the kernel tells "this sweep
    // targets nothing" apart from "this action forgot a target".
    targets: [null],
    sacrifices: [],
    x,
  });
  return apply(apply(activated, { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

describe('a sweep filtered on a keyword', () => {
  /**
   * The acceptance run, and it is a run rather than a reading: X=3, one flier,
   * one ground creature, and the ground creature is not a member of the group
   * the effect built.
   */
  it('deals the announced damage to the flier and none to the ground creature', () => {
    const start = board([
      { card: FLIER, controller: 1 },
      { card: GROUND, controller: 1 },
    ]);
    const after = sweep(start, 3);

    expect(damageOn(after.state, oidOf(after.state, FLIER.name))).toBe(3);
    expect(damageOn(after.state, oidOf(after.state, GROUND.name))).toBe(0);
  });

  /**
   * Reach is not flying, and the Spider is the card that proves the filter
   * reads the keyword rather than "can interact with fliers": Silklash Spider
   * survives its own ability, which is the entire reason M13 could print it at
   * six mana.
   */
  it('spares the sweeping creature, whose reach is not flying', () => {
    const after = sweep(board([{ card: FLIER, controller: 1 }]), 4);

    expect(damageOn(after.state, oidOf(after.state, SPIDER.name))).toBe(0);
    expect(damageOn(after.state, oidOf(after.state, FLIER.name))).toBe(4);
  });

  /**
   * Granted flying counts, because the filter asks the layer walk and not the
   * card face. This is what makes the field mean what the rules mean: an anthem
   * that hands a bear flying hands it to this sweep as well, and the same bear
   * on a board with no anthem takes nothing.
   */
  it('burns a creature that was granted flying and spares it without the grant', () => {
    const anthem = keywordAnthem('Skyward Chant', 'flying');
    const granted = sweep(
      board([
        { card: GROUND, controller: 1 },
        { card: anthem, controller: 1 },
      ]),
      2,
    );
    expect(damageOn(granted.state, oidOf(granted.state, GROUND.name))).toBe(2);

    const ungranted = sweep(board([{ card: GROUND, controller: 1 }]), 2);
    expect(damageOn(ungranted.state, oidOf(ungranted.state, GROUND.name))).toBe(0);
  });
});
