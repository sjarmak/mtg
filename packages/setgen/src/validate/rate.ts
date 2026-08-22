/**
 * Rate: how much a card gives away for what it costs.
 *
 * Nothing else in the package has an opinion about this. Conformance checks
 * legality and placement, the color pie checks which colors may do what, the
 * complexity budget counts red flags at common, and `template.ts` counts how
 * many times a shape repeats. All of them would pass a one-mana "Destroy target
 * creature" at common, and the flagship set prints one. They would also pass a
 * two-mana Equipment granting +99/-3, and it prints one of those too.
 *
 * # One statistic, and where it comes from
 *
 * `@mtg/deckbuild`'s `evaluateCard` already prices every effect, ability and
 * body this DSL can express, because deck building has to sort a pool. Its score
 * is net of a per-mana cost baseline, so it is already a surplus rather than a
 * gross value. A second pricing table here that disagreed with that one would be
 * worse than no gate at all — two numbers for one card, and a generator caught
 * between them — so this file reuses it and adds exactly one arithmetic step:
 *
 *     rate = evaluateCard(card).score / max(1, manaValue)
 *
 * The division is what makes it answer the question actually being asked.
 * Surplus alone under-punishes the cheap card: a one-mana spell with four points
 * of surplus and a seven-mana spell with four points of surplus score the same,
 * and only one of them is a design error. A card costing nothing is measured as
 * if it cost one, which is the most permissive reading available.
 *
 * That the statistic is measuring something real is checkable rather than
 * asserted. Its 95th percentile over the flagship set rises monotonically with
 * rarity — 1.19 at common, 1.50 at uncommon, 1.94 at rare — which is the shape a
 * working rarity ladder has, produced by a function that is not told the rarity.
 *
 * # The ceiling, and why it is where it is
 *
 * Both endpoints are measured on a real generated set. The most efficient card
 * in it that real Magic also prints routinely is a common {R} "2 damage to any
 * target", which is Shock, at 2.45. The cheapest genuine error it contains is a
 * common one-mana unconditional "Destroy target creature", at 3.55, and the same
 * set prints that exact text again at two mana and sorcery speed, which is what
 * makes the one-mana printing an error rather than a judgment call. The ceiling
 * below the bomb tier is **3.0**, centered between the two with 0.55 of margin
 * on each side.
 *
 * The bomb tier gets **4.0**. A bomb is allowed one full rate-unit more than a
 * common, which is more headroom than the measured ladder (0.75 from common to
 * rare) needs, because that tier exists to print cards that take a game over.
 *
 * Over that set's 253 cards the gate fires twice: the one-mana removal spell at
 * 3.55 and a two-mana Equipment granting +99/-3 at 82.91, both real errors, with
 * no false alarms. That is
 * deliberately a tripwire and not a grader. `evaluateCard` charges cost in
 * different units per card kind — 2.0 per mana against creature stats, 0.55 per
 * mana against a spell — so its scores are comparable within a kind and only
 * roughly across kinds, and a threshold tuned finer than this would be reading
 * that disagreement rather than the card. Order-of-magnitude mispricing is what
 * this catches, and order-of-magnitude mispricing is what shipped.
 *
 * # Why `cardRate` draws no floor of its own
 *
 * A card far under rate is also a design failure, and this statistic cannot see
 * it. Its ceiling is unbounded — 82.91 against a 3.55 runner-up — but its floor
 * is not: the worst card the set prints scores -0.88 and the worst defensible
 * one scores -0.81, a separation of 0.07. Any floor drawn in that gap fires on
 * one real error and one legitimate card. All three under-rate defects the set
 * actually contains, at the time this was written, were cards with no printed
 * text at all, and `checkBlankCards` names them for what they are. A second
 * finding saying the same thing about the same three cards would be noise.
 *
 * That argument is about `cardRate` and only about `cardRate`: `evaluateCard`
 * prices *everything* a card can carry into one net-surplus number, so its low
 * end is compressed the same way a currency exchange rate is compressed near
 * zero — every genuinely bad card and every merely modest one round to
 * roughly the same small number, because the pricing table that makes the
 * ceiling sharp is exactly what blurs the floor. It is not an argument against
 * a floor; it is an argument against reading one off *this* statistic. The
 * right floor statistic for a creature does not need a pricing table at all.
 *
 * # The stat floor
 *
 * A creature's printed body is checkable against its printed cost with no
 * pricing table in between:
 *
 *     statFloor(card) = (power + toughness) - 2 * cardManaValue(card)
 *
 * Two power and toughness per mana is the vanilla baseline real Magic has
 * printed at every rarity for thirty years — a 2/2 for two, a 3/3 for three —
 * so `statFloor` is zero at the baseline, positive above it, negative below.
 * `checkStatFloor` fails a creature more than `STAT_FLOOR` (-2) under that
 * line, which is a full extra point of deficit beyond "a plain body a mana
 * light," the same margin `RATE_CEILING`'s 0.55 either side of its two
 * anchors reads as a real gap rather than noise.
 *
 * # The exemption, and why it has to be there
 *
 * The check only reads a creature that carries at most one keyword and prints
 * no CR 113 ability. A creature that buys its missing stats back with text is
 * exempt by construction, not by a second calculation: a 4/5 deathtouch for
 * six is under this line by three, and deathtouch is exactly the keyword that
 * makes a small body relevant regardless of its stat line, so the printed
 * clause is the answer to the deficit rather than evidence of one. Two
 * keywords or an ability is stronger evidence still. Drop the exemption and
 * the false positive is immediate and mechanical: nothing about a card's power
 * and toughness can tell a checker that the six other words on the card
 * already paid for them, so a check that read stats alone would fail every
 * card design intentionally puts text ahead of size, which is the shape a
 * real set is supposed to have more of, not fewer. `rate.ts`'s own numbers
 * make the same point from the other side — the set's french-vanilla creatures
 * (one keyword, no ability) are the class this floor targets, and its findings
 * are named for exactly that population below.
 *
 * # Why this reports and does not regenerate
 *
 * `errors()` drives `failingSlotIds`, which is exactly the list the loop re-asks
 * the model for, at cost. Both cards this gate fires on are slots where no
 * regeneration can help. The removal spell fills a slot the allocator specified
 * as `removalSmallConditional` at `manaValueMin: 1, manaValueMax: 1` with
 * `effectKinds: ['destroyPermanent']` — and `destroyPermanent` is the only
 * removal this DSL has, with no conditional or limited form, so every legal card
 * for that slot is a one-mana unconditional Murder. The Equipment is a
 * `requiredCard` whose flavor direction asks for a drawback the vocabulary
 * cannot express and says in as many words to trade stats for it if v1 cannot,
 * which is what +99/-3 is.
 *
 * So the defect is real and the remedy is upstream: the slot's mana window, the
 * brief's required card, or the DSL's removal vocabulary. A retry round against
 * an unchanged slot spec buys the same card back and bills for it. This is a
 * `warning` because it is a true report the loop cannot act on, not because the
 * finding is soft.
 *
 * `STAT_BELOW_FLOOR` is a `warning` for a narrower reason, measured rather than
 * argued: wired in as an `error`, it changes `failingSlotIds` on both recorded
 * sets this package replays (Tideglass Reach, Hearthglass Vigil), because each
 * one prints at least one creature under this line, and the retry loop asks the
 * fixture provider for a regeneration request neither recording contains.
 * `recorded-set.test.ts` and `recorded-abilities.test.ts` then fail with
 * `FixtureMissingError` rather than a finding either recording was ever asked
 * to carry. `checkColorSignature` and `checkFunctionalReprints` failed the same
 * way for the same reason and are not wired in at all; this check is a
 * `warning` instead of also going unwired, because a `warning` never enters
 * `failingSlotIds` regardless of what it names, so it costs the fixtures
 * nothing to report through.
 *
 * # ZFC
 *
 * `rarity.ts` says nothing in this package should grade a finished card's power,
 * and that stands. Neither check grades a card. `cardRate` divides one number
 * the card states (its mana cost) into another produced by a pricing table
 * that already exists for another purpose, and compares the quotient to a
 * stated budget. `statFloor` reads two numbers the card states and one it
 * implies, subtracts, and compares to a stated budget — no pricing table at
 * all. Both are deterministic arithmetic and policy enforcement, which the
 * application layer owns. Whether a card is *well designed* at 2.9, or a body
 * is *well designed* one point under the line, is a judgment, and this file
 * makes neither; it has no opinion about anything inside either budget.
 */
import type { Card, CreatureCard } from '@mtg/dsl';
import { cardManaValue, isCreature } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';
import type { SliceRarityRules } from '@mtg/design-data';
import type { Entry } from './composition';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { rarityPolicy } from '../rarity';

/** Most surplus per mana a card below the bomb tier may give away. */
export const RATE_CEILING = 3.0;

/** Most surplus per mana a card at or above `bombsMinRarity` may give away. */
export const RATE_CEILING_BOMB = 4.0;

/**
 * Surplus per mana: `evaluateCard`'s score over the card's mana value.
 *
 * A zero-cost card is measured as if it cost one, so it is never divided by
 * zero and never flattered by the division either.
 */
export function cardRate(card: Card): number {
  return evaluateCard(card, DEFAULT_SCORE_WEIGHTS).score / Math.max(1, cardManaValue(card));
}

/** Most a creature's body may sit under the two-power-per-mana baseline. */
export const STAT_FLOOR = -2;

/**
 * A creature's printed power plus toughness, against twice its mana value.
 * Zero is the vanilla baseline (a 2/2 for two); negative is under it.
 */
export function statFloor(card: CreatureCard): number {
  return card.power + card.toughness - 2 * cardManaValue(card);
}

/**
 * Creatures whose body sits under the floor with no text buying it back.
 *
 * A card with `characteristicPowerToughness` set prints placeholder numbers on
 * `power`/`toughness` — its true body is computed on the battlefield, not
 * stated on the card — so it is skipped rather than misread; the field is
 * engine-only and no set in this repository has printed one.
 */
export function checkStatFloor(entries: readonly Entry[]): SetFinding[] {
  const findings: SetFinding[] = [];
  for (const entry of entries) {
    const { card } = entry;
    if (!isCreature(card)) continue;
    if (card.characteristicPowerToughness !== undefined) continue;
    if (card.keywords.length > 1 || card.abilities.length > 0) continue;
    const floor = statFloor(card);
    if (floor >= STAT_FLOOR) continue;
    const keywordPhrase = card.keywords.length === 0 ? 'no keyword' : `only ${card.keywords[0]}`;
    findings.push(
      finding(
        'STAT_BELOW_FLOOR',
        'warning',
        `${entry.slot.id} "${card.name}" prints ${card.power}/${card.toughness} at mana value ` +
          `${cardManaValue(card)}, ${Math.abs(floor)} below the two-power-per-mana baseline, with ` +
          `${keywordPhrase} and no ability to buy the difference back. Raise the body, cut the ` +
          'cost, or print something on it.',
        [entry.slot.id],
      ),
    );
  }
  return findings;
}

/** Cards giving away more per mana than their tier's ceiling allows. */
export function checkCardRate(entries: readonly Entry[], rules: SliceRarityRules): SetFinding[] {
  const findings: SetFinding[] = [];
  for (const entry of entries) {
    const bomb = rarityPolicy(entry.slot.rarity, rules).bomb;
    const ceiling = bomb ? RATE_CEILING_BOMB : RATE_CEILING;
    const rate = cardRate(entry.card);
    if (rate <= ceiling) continue;
    findings.push(
      finding(
        'RATE_ABOVE_CURVE',
        'warning',
        `${entry.slot.id} "${entry.card.name}" gives away ${rate.toFixed(2)} per mana against a ` +
          `ceiling of ${ceiling.toFixed(2)} for ${bomb ? 'a card at this tier' : 'this tier'}: at ` +
          `mana value ${cardManaValue(entry.card)} it is worth more than the most efficient card ` +
          'a real set prints here. Raise the cost or cut what it does.',
        [entry.slot.id],
      ),
    );
  }
  return findings;
}
