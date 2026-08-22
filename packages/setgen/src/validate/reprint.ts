/**
 * Functional reprints: one printed effect, several cards, inconsistent cost.
 *
 * The DSL prices eleven effect kinds, so a generator asked for ninety
 * noncreature cards has eleven things it can say. It says them repeatedly, and
 * nothing downstream ever compared one printing of an effect to another: the
 * 253-card flagship printed "Destroy target creature." on nineteen cards at
 * mana values from {1} to {7}, across white, black and colorless, and every
 * deterministic gate passed it.
 *
 * `DUPLICATE_MECHANICS` does not catch this and cannot. `mechanicalFingerprint`
 * hashes the whole card with its mana cost in it, so it answers "is this the
 * same card twice?" — two Murders at {1}{W} and at {3}{W} are, by that
 * question, two different cards. The question this file asks is the other one:
 * *is this the same card at a price the set never decided on?*
 *
 * Three decisions, all arguable and all made here rather than asked about:
 *
 *  1. **The key is the structured effect list, not the rendered string.** Oracle
 *     text is too strict in one direction — two spells that differ only in a
 *     target's wording render differently and are the same card — and too loose
 *     in the other, since flavor text and names are already stripped by
 *     `mechanicalFingerprint` and would be by any string key that tried. The
 *     effects a card prints are the card, and `cardOwnEffects` reads a modal
 *     card's modes too, so a mode cannot launder a reprint.
 *  2. **A rider is a different card.** The key is the whole effect list in
 *     order, so "Destroy target creature." and "Destroy target creature. Create
 *     a Key token." are two signatures, never one. This is deliberate and it is
 *     the direction that under-reports: a conditional or riderd version of a
 *     spell is a design, not a repeat, and a gate that collapsed them would fire
 *     on exactly the cards a set is supposed to differentiate.
 *  3. **Only spells are keyed.** A permanent's body is most of what it costs —
 *     two creatures with the same ETB at {2} and at {5} are priced on their
 *     stats, and calling them a reprint would be pricing a card on a third of
 *     itself. Instants and sorceries are the whole population where the effect
 *     *is* the card, and they are where the defect lives.
 *
 * Real sets print an effect more than once — a common removal spell and its
 * uncommon cousin, a cycle across colors — so the rule is not "never twice".
 * It is two numbers, both stated in `ReprintPolicy` and both defaulted: how many
 * printings of one effect a set may carry, and how far apart their costs may
 * sit. A set with `destroyPermanent` at {2} and {4} is normal; the same effect
 * at {1} and {7} is a set that never decided what the effect is worth.
 */
import type { Card } from '@mtg/dsl';
import {
  canonicalJson,
  cardManaValue,
  formatManaCost,
  isCastable,
  isSpellCard,
  renderOracleText,
} from '@mtg/dsl';
import type { Entry } from './composition';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { cardOwnEffects } from './mechanics';

export interface ReprintPolicy {
  /**
   * How many cards may print one effect signature before the set is reported.
   *
   * Four, because the widest defensible repeat in a real small set is a common,
   * its uncommon variant, and a rare that does the same thing bigger — plus one
   * for the color cycle a set is allowed to run. The fifth printing is where a
   * set stops repeating an effect and starts having only that effect.
   */
  readonly maxPrintings: number;
  /**
   * How far apart, in mana value, the cheapest and dearest printing may sit.
   *
   * Two. A removal spell at {2} and a bigger one at {4} is a curve; the same
   * spell at {1} and at {7} is not a curve, it is an unpriced effect. Two is
   * also the spread a rarity ladder naturally produces, so this number fires on
   * the pathology and not on ordinary design.
   */
  readonly maxCostSpread: number;
}

export const DEFAULT_REPRINT_POLICY: ReprintPolicy = { maxPrintings: 4, maxCostSpread: 2 };

/** One effect signature and every card in the set that prints it. */
export interface ReprintGroup {
  /** The signature's own text, in oracle form, taken from the first printing. */
  readonly text: string;
  readonly cards: readonly Card[];
  readonly minManaValue: number;
  readonly maxManaValue: number;
}

/**
 * The key two functional reprints share: what the card does, and nothing else.
 *
 * Order is kept rather than sorted. A card's effects resolve in the order it
 * prints them, so "Destroy target creature. Draw a card." and "Draw a card.
 * Destroy target creature." are two cards; sorting them together would be the
 * gate inventing a reprint.
 */
export function effectSignature(card: Card): string | null {
  if (!isSpellCard(card)) return null;
  const effects = cardOwnEffects(card);
  if (effects.length === 0) return null;
  return canonicalJson({ modal: card.modes !== undefined, effects });
}

function costOf(card: Card): string {
  return isCastable(card) ? formatManaCost(card.manaCost) : '{0}';
}

/** One line of oracle text, for a finding message that has to stay one line. */
function oneLine(card: Card): string {
  return renderOracleText(card).replace(/\s*\n\s*/g, ' ');
}

/** Every effect signature printed more than once, in first-seen order. */
export function reprintGroups(cards: readonly Card[]): ReprintGroup[] {
  const bySignature = new Map<string, Card[]>();
  for (const card of cards) {
    const key = effectSignature(card);
    if (key === null) continue;
    const seen = bySignature.get(key);
    if (seen === undefined) bySignature.set(key, [card]);
    else seen.push(card);
  }
  return [...bySignature.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const values = group.map(cardManaValue);
      return {
        text: oneLine(group[0] as Card),
        cards: group,
        minManaValue: Math.min(...values),
        maxManaValue: Math.max(...values),
      };
    });
}

function printings(group: ReprintGroup): string {
  return group.cards.map((card) => `${card.name} ${costOf(card)}`).join(', ');
}

/**
 * Both halves of the rule, over cards alone: a committed set file can be read
 * without an allocation, which is how this gate is run against the fixtures.
 * `checkFunctionalReprints` is the same walk with slots to blame.
 */
export function reprintFindings(
  cards: readonly Card[],
  policy: ReprintPolicy = DEFAULT_REPRINT_POLICY,
  slotIdsFor: (group: ReprintGroup) => readonly string[] = () => [],
): SetFinding[] {
  const found: SetFinding[] = [];
  for (const group of reprintGroups(cards)) {
    const spread = group.maxManaValue - group.minManaValue;
    if (spread > policy.maxCostSpread) {
      found.push(
        finding(
          'FUNCTIONAL_REPRINT_SPREAD',
          'error',
          `"${group.text}" is printed on ${group.cards.length} cards spanning ${spread} mana (${group.minManaValue} to ${group.maxManaValue}), over the spread of ${policy.maxCostSpread} this set allows: ${printings(group)}`,
          slotIdsFor(group),
        ),
      );
    }
    if (group.cards.length > policy.maxPrintings) {
      found.push(
        finding(
          'FUNCTIONAL_REPRINT_GLUT',
          'warning',
          `"${group.text}" is printed on ${group.cards.length} cards, over the ${policy.maxPrintings} this set allows: ${printings(group)}`,
          slotIdsFor(group),
        ),
      );
    }
  }
  return found;
}

export function checkFunctionalReprints(
  entries: readonly Entry[],
  policy: ReprintPolicy = DEFAULT_REPRINT_POLICY,
): SetFinding[] {
  const slotByCardId = new Map<string, string>();
  for (const entry of entries) slotByCardId.set(entry.card.id, entry.slot.id);
  return reprintFindings(
    entries.map((entry) => entry.card),
    policy,
    (group) =>
      group.cards.flatMap((card) => {
        const slotId = slotByCardId.get(card.id);
        return slotId === undefined ? [] : [slotId];
      }),
  );
}
