/**
 * What a bounce is worth, and whether the builder plays one (`mtg-zyh7`).
 *
 * `returnToHand`'s 1.0 is placed against its neighbors in `DEFAULT_EFFECT_VALUE`
 * rather than derived from any one of them, so the checkable part is the
 * ordering and not the digit. That ordering is an argument written in a comment
 * until something asserts it, and the bead was filed against exactly that
 * situation: a row with no comment, a card measured below zero, and a claim
 * about the builder that nobody had run a build to test.
 *
 *  1. **The ladder.** A bounce sits over a one-turn tap and a diminish, under a
 *     tap that never untaps, a fight and a counter, and far under a destroy.
 *     Every rung is read off the weights, so a retune that reverses two of them
 *     fails here rather than drifting.
 *  2. **The two derivations**, open and narrowed, each written out of the same
 *     weights `evaluateCard` reads. The bead's measurement (-0.050 for the
 *     narrowed one) predates `instantSpeedPremium`; what replaced it is stated
 *     as arithmetic rather than as a literal, so the next weight to land moves
 *     the expectation with it.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;
const ROW = WEIGHTS.effectValue;

let serial = 900;

/** A one-mana blue instant carrying exactly the effects it is handed. */
function spell(effects: readonly unknown[]): Card {
  serial += 1;
  return parseCard({
    kind: 'instant',
    id: `bounce-${String(serial)}`,
    name: `Bounce ${String(serial)}`,
    rarity: 'common',
    set: { code: 'BNC', collectorNumber: serial },
    manaCost: { generic: 0, U: 1 },
    colors: ['U'],
    effects,
  } as CardInput);
}

const OPEN = spell([{ kind: 'returnToHand', target: { kind: 'targetCreature' } }]);
const NARROWED = spell([
  { kind: 'returnToHand', target: { kind: 'targetCreature', filter: { combat: 'attacking' } } },
]);

/** One mana of blue, which is what both spells above cost. */
const ONE_MANA = WEIGHTS.spellManaPenaltyPerMana;

function score(card: Card): number {
  return evaluateCard(card, WEIGHTS).score;
}

describe('where a bounce sits among the effects around it', () => {
  it('is worth more than a turn of denial and more than a diminish', () => {
    // A tap gives the creature back untapped on the opponent's next untap step;
    // a diminish gives its printed body back at cleanup. A bounce gives back
    // neither, and asks for the mana again.
    expect(ROW.returnToHand.base).toBeGreaterThan(ROW.tapPermanent.perUnit);
    expect(ROW.returnToHand.base).toBeGreaterThan(ROW.setBasePtUntilEndOfTurn.base);
    expect(ROW.returnToHand.base).toBeGreaterThan(ROW.cantBeBlockedThisTurn.base);
  });

  it('is worth less than a tap that never ends, a fight and a counter', () => {
    // The held tap is the nearest rung above, and it is the right one to be
    // under: `doesNotUntap` denies the creature for the rest of the game, where
    // a bounce denies it until its controller pays for it a second time.
    expect(ROW.returnToHand.base).toBeLessThan(ROW.tapPermanent.perUnit * WEIGHTS.heldTapFactor);
    expect(ROW.returnToHand.base).toBeLessThan(ROW.fight.base);
    expect(ROW.returnToHand.base).toBeLessThan(ROW.counterSpell.base);
  });

  it('is worth well under removal, because the card comes back', () => {
    expect(ROW.returnToHand.base).toBeLessThan(ROW.destroyPermanent.perUnit / 2);
  });
});

describe('the two bounce spells the bead measured', () => {
  it('prices an open bounce at the row, plus the instant, less its mana', () => {
    expect(score(OPEN)).toBeCloseTo(ROW.returnToHand.base + WEIGHTS.instantSpeedPremium - ONE_MANA, 10);
  });

  it('prices a bounce narrowed to attackers at the same arithmetic, halved once', () => {
    // Once, not twice: `targetNarrowingFactor` discounts a target that carries a
    // restriction and a filter one time, and this target carries only the
    // filter.
    expect(score(NARROWED)).toBeCloseTo(
      ROW.returnToHand.base * WEIGHTS.restrictedTargetFactor + WEIGHTS.instantSpeedPremium - ONE_MANA,
      10,
    );
  });

  it('puts the narrowed one above zero, which is what the bead asked', () => {
    // -0.050 when `mtg-zyh7` was filed, before `instantSpeedPremium` existed.
    // Above zero is the claim; the number is the line above.
    expect(score(NARROWED)).toBeGreaterThan(0);
    expect(score(OPEN)).toBeGreaterThan(score(NARROWED));
  });
});
