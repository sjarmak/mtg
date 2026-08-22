/**
 * Mana-cost well-formedness and color-identity consistency.
 *
 * Color identity is *derived* from the cost, so the declared `colors` field
 * is a redundancy check: any disagreement means the generator produced a card
 * whose color the kernel and the color-pie gates would read differently.
 */
import type { Card } from '../card';
import { isCastable } from '../card';
import { colorsFromCost, isColorless, manaValue } from '../mana';
import { withArticle } from '../text-util';
import type { Violation } from '../violations';
import { violation } from '../violations';
import type { Color, ManaColor } from '../vocabulary';
import { BASIC_LAND_COLOR, COLORS, sortColors } from '../vocabulary';

/**
 * Ceiling on a printed mana value. Exported because an activated ability's cost
 * is the same quantity a card's cost is, and two hand-maintained copies of the
 * ceiling are two chances to widen one of them (`validate/abilities.ts`).
 */
export const MAX_MANA_VALUE = 16;

function sameColorList(a: readonly Color[], b: readonly Color[]): boolean {
  if (a.length !== b.length) return false;
  const right = sortColors(b);
  return sortColors(a).every((color, index) => color === right[index]);
}

/**
 * A printed cost has to be a number the kernel can charge, and nothing more.
 *
 * There is no floor on it. A total mana value of 0 used to be refused here as
 * `MANA_COST_ZERO` ("DSL v0 has no free spells"), and that sentence is about
 * what the *generator* may print rather than about what the kernel can run:
 * `mtg-nhyv.79` cast a hand-authored {0} artifact creature from an opening hand
 * with no lands and an empty mana pool, and the kernel offered the cast,
 * resolved it and put the 0/2 flier on the battlefield. `payFromPool` returns
 * the pool unchanged for an all-zero cost rather than `null` (`kernel/mana.ts`),
 * `effectiveManaCost` already floors a cost reduction at 0 (`kernel/cost.ts`),
 * `formatManaCost`, `costPips` and `forgeManaCost` all spell a free cost as the
 * one symbol a real card prints it with, and `curveBucket` has a 0 bucket. The
 * rule refused a card every layer beneath it was already written for, and it was
 * the only thing standing between Ornithopter and the reference ledger.
 *
 * The generator keeps its own floor, where the policy belongs: every slot states
 * a cost window, `checkSlotConformance` fails a card outside it, and no window
 * can open below 1 — four of the five window sources are constants that start at
 * 1 or above, and `CurveBucketSchema` floors the fifth. Same arrangement as
 * `putCounters` — expressible by hand, unreachable from the generator.
 */
export function checkManaCost(card: Card): Violation[] {
  if (!isCastable(card)) return [];
  const found: Violation[] = [];
  const { manaCost } = card;
  if (manaCost.generic < 0) {
    found.push(
      violation(
        'MANA_COST_NEGATIVE',
        'manaCost.generic',
        `generic mana must be >= 0, got ${manaCost.generic}`,
      ),
    );
  }
  for (const color of COLORS) {
    if (manaCost[color] < 0) {
      found.push(
        violation(
          'MANA_COST_NEGATIVE',
          `manaCost.${color}`,
          `${color} pips must be >= 0, got ${manaCost[color]}`,
        ),
      );
    }
  }
  const value = manaValue(manaCost);
  if (value > MAX_MANA_VALUE) {
    found.push(
      violation(
        'MANA_COST_OUT_OF_RANGE',
        'manaCost',
        `mana value ${value} exceeds the slice ceiling of ${MAX_MANA_VALUE}`,
      ),
    );
  }
  return found;
}

export function checkColorIdentity(card: Card): Violation[] {
  if (card.kind === 'land') return checkLandColors(card);
  const found: Violation[] = [];
  const derived = colorsFromCost(card.manaCost);
  if (!sameColorList(card.colors, derived)) {
    found.push(
      violation(
        'COLOR_IDENTITY_MISMATCH',
        'colors',
        `colors [${sortColors(card.colors).join('')}] must equal the colours implied by the mana cost [${derived.join('')}]`,
      ),
    );
  }
  if (card.kind === 'artifact' && !isColorless(card.manaCost)) {
    found.push(
      violation(
        'ARTIFACT_NOT_COLORLESS',
        'manaCost',
        'noncreature artifacts must have a colourless mana cost',
      ),
    );
  }
  return found;
}

/**
 * A cost reduction registers a continuous effect while its source is on the
 * battlefield (CR 601.2f applies it every time that permanent's controller
 * casts a matching spell), so it is subject to the same restriction
 * `checkPlacement` states for `abilities`: only a permanent that stays on the
 * battlefield can carry one, and lands are out too (`planPayment` auto-taps
 * lands for mana, so a land is a permanent two different costs could tap).
 */
export function checkCostReduction(card: Card): Violation[] {
  if (card.costReduction === null) return [];
  if (card.kind === 'creature' || card.kind === 'artifact') return [];
  return [
    violation(
      'COST_REDUCTION_ILLEGAL_ON_CARD_TYPE',
      'costReduction',
      `a cost reduction is printed on permanents that stay on the battlefield; ${withArticle(card.kind)} cannot carry one`,
    ),
  ];
}

function duplicatesOf(values: readonly ManaColor[]): ManaColor[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function checkLandColors(card: Extract<Card, { kind: 'land' }>): Violation[] {
  const found: Violation[] = [];
  if (card.colors.length > 0) {
    found.push(violation('LAND_NOT_COLORLESS', 'colors', 'lands are colourless cards; leave `colors` empty'));
  }
  const duplicates = duplicatesOf(card.producesMana);
  if (duplicates.length > 0) {
    found.push(
      violation(
        'LAND_MANA_MISMATCH',
        'producesMana',
        `a land must list each mana choice once; repeated [${duplicates.join('')}]`,
      ),
    );
  }
  if (card.basicLandType !== undefined) {
    const expected = BASIC_LAND_COLOR[card.basicLandType];
    if (card.producesMana.length !== 1 || card.producesMana[0] !== expected) {
      found.push(
        violation(
          'LAND_MANA_MISMATCH',
          'producesMana',
          `a ${card.basicLandType} must produce exactly [${expected}], got [${card.producesMana.join('')}]`,
        ),
      );
    }
  }
  const condition = card.entryReplacement;
  if (
    condition?.kind === 'entersTappedUnlessControlsLandSubtype' &&
    new Set(condition.landTypes).size !== condition.landTypes.length
  ) {
    found.push(
      violation(
        'LAND_ENTRY_CONDITION_INVALID',
        'entryReplacement.landTypes',
        'a land-entry condition must list each qualifying land type once',
      ),
    );
  }
  return found;
}
