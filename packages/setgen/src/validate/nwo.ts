/**
 * New World Order complexity gate for commons.
 *
 * The community red-flag checklist is written for full-rules Magic; DSL v0 can
 * only express a subset of it, so this implements the subset rather than
 * pretending to run the whole list. Five rules are computable inside the slice:
 * multiple effects on one spell, multiple keywords on one creature, long
 * printed text, a token effect that puts several permanents on the battlefield
 * at once (the board-complexity rule of thumb), and a printed ability the
 * reader has to keep track of.
 *
 * The semantic half of NWO ("needs to be read twice", lenticular quality) is
 * deliberately absent: it belongs to the critique pass, not to a validator (ZFC,
 * and set-design section 14's own warning).
 *
 * Two gates: a common carrying two or more red flags moves up in rarity (an
 * error), and the set's red-flag rate must stay inside the profile budget the
 * caller passes as `budgetShare`. The community codification of the New World
 * Order article puts that share at 20%; `@mtg/design-data`'s
 * `NWO_RED_FLAG_BUDGET` widens it to 35% for the profile this package actually
 * derives from, because that 20% prices *board* complexity and this file
 * prices one card at a time — see that constant's docblock for the argument
 * and the measurement it is answering.
 */
import type { Ability, AbilityKind, Card, Effect } from '@mtg/dsl';
import { hasAbilityEffects, isLiteralAmount, renderOracleText } from '@mtg/dsl';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { cardOwnEffects } from './mechanics';
import type { Slot } from '../slot';

/** Printed-text ceilings below the "four lines of rules text" red flag. */
const MAX_TEXT_LINES = 3;
const MAX_TEXT_CHARS = 140;
/** A token effect making this many bodies at once is board complexity. */
const WIDE_TOKEN_COUNT = 2;
/**
 * Keywords on the type line below this are ordinary; at this many or more the
 * card is doing several things at once.
 *
 * Real Magic prints two evergreen keywords on a common routinely (a 2/2 flier
 * with lifelink is Vampire Nighthawk's shape one rarity down); three is the
 * point a common starts reading like a rare. The rule used to fire at two,
 * which made *any* two-keyword common a red flag — the exact "cheap body
 * doing two things" shape a New World Order budget should have room for, not
 * tax. A false positive here costs a design a common can never recover: the
 * card either drops a keyword it earned or moves up in rarity for carrying
 * two ordinary words, and the set is left with french-vanilla creatures
 * because a second keyword was never worth the flag.
 */
const MULTI_KEYWORD_THRESHOLD = 3;

/**
 * Ability kinds that cost the reader something on every turn the permanent is
 * on the battlefield.
 *
 * A static ability is read once and then forgotten: the creature is a 3/3 with
 * first strike and stays one, so after the first look there is nothing to do
 * about it. A trigger is a thing to remember - it fires while the player is
 * thinking about something else, and forgetting it is the mistake. An
 * activation is a thing to decide, every turn, at every price. That recurring
 * cost is what the New World Order budget is spent on, so the two of them count
 * and the static does not.
 *
 * The three commons the recorded Hearthglass run prints with an ability carry
 * exactly one each, which is the shape the rule is priced for. Those three are
 * also the whole allowance: fifteen commons at the profile's 20% budget is a
 * budget of three, so that run sits on the line rather than under it and a
 * fourth ability-bearing common at that set size is `NWO_BUDGET_EXCEEDED`.
 * `recorded-abilities.test.ts` asserts the three numbers, because a rule that
 * spends a whole budget should say so where it is read.
 */
export const TRACKED_ABILITY_KINDS: readonly AbilityKind[] = ['triggered', 'activated'];

export const RED_FLAG_RULES = [
  'multiEffect',
  'multiKeyword',
  'longText',
  'wideBoard',
  'trackedAbility',
] as const;
export type RedFlagRule = (typeof RED_FLAG_RULES)[number];

export interface RedFlag {
  readonly slotId: string;
  readonly rules: readonly RedFlagRule[];
}

/**
 * `renderOracleText`, minus reminder text, for the `longText` measurement.
 *
 * Reminder text is a reader aid, not complexity: it exists so a keyword or a
 * counter can be understood without looking anything up, and it says nothing
 * a rules-literate reader needed printed. Charging it against `MAX_TEXT_CHARS`
 * inverts the incentive it exists to serve — a mechanic that ships a reminder
 * (a named counter, `grantLandwalk`) becomes the *expensive* way to say the
 * same thing, and the cheap way is to omit the explanation and make the card
 * harder to read. Two commons in the flagship build are the concrete case:
 * 102- and 99-character trigger clauses, pushed to 148 and 145 by the printed
 * "(A creature with a gloom counter gets -1/-1.)" alone. That reminder is
 * `counterReminderText` (`@mtg/dsl`'s `counters.ts`) attaches to `putCounters`
 * inside `renderEffect`, and the only reason either card was ever
 * `NWO_MULTI_RED_FLAG`.
 *
 * `renderOracleText` has no mode that omits reminders — the only two things it
 * ever parenthesizes are that `putCounters` reminder and the landwalk clause
 * `renderAuraModificationClause` attaches to `grantLandwalk` (verified by
 * reading every literal `(` `renderOracleText` can reach; nothing else in the
 * DSL's oracle renderer prints one) — so both are reminder text and a
 * parenthetical strip is exact today. A rendering mode that never runs the
 * reminder through in the first place would be the better home for this and
 * belongs in `@mtg/dsl`'s `oracle.ts`, which this package does not own; this
 * is the smallest change that stays inside `nwo.ts`. If `renderOracleText`
 * ever parenthesizes something that is not a reminder, this strips that too,
 * and the fix is to give it the mode instead.
 */
function textForComplexity(card: Card): string {
  return renderOracleText(card)
    .split('\n')
    .map((line) => line.replace(/ ?\([^)]*\)/g, '').trimEnd())
    .join('\n');
}

export function redFlagsFor(card: Card): RedFlagRule[] {
  const rules: RedFlagRule[] = [];
  // A modal card's own effects live in `card.modes`, one list per mode
  // (CR 700.2), and `card.effects` is empty by construction — `cardOwnEffects`
  // reads whichever the card actually populates. Every mode is a clause a
  // reader has to read before choosing one, so the count below is a clause
  // count whether the modes are printed as a fixed list or as a choice.
  const ownEffects = cardOwnEffects(card);
  if (ownEffects.length >= 2) rules.push('multiEffect');
  if (card.keywords.length >= MULTI_KEYWORD_THRESHOLD) rules.push('multiKeyword');
  const text = textForComplexity(card);
  if (text.split('\n').length > MAX_TEXT_LINES || text.length > MAX_TEXT_CHARS) rules.push('longText');
  // One flag for the card, not one per ability: a permanent carrying a trigger
  // and an activation is a card to keep track of, and a card cannot be more
  // than that. Counting per ability would put a Monster that drops a Key and
  // spends one over the two-flag error line on its own, which is the drop
  // economy priced out of common by an accident of arithmetic.
  if (card.abilities.some((ability) => TRACKED_ABILITY_KINDS.includes(ability.kind))) {
    rules.push('trackedAbility');
  }
  // Board complexity does not care which line of the card made the bodies, so
  // this rule reads a permanent's abilities as well as a spell's effect list.
  // The other three deliberately do not: `multiEffect` counts the clauses on one
  // spell, `multiKeyword` counts the words on the type line, and `longText`
  // already reads the ability through `renderOracleText`.
  const wide = [...ownEffects, ...card.abilities.flatMap(abilityEffects)].some(
    (effect) =>
      effect.kind === 'createToken' &&
      // A count nobody can read off the card is a wide board by assumption: the
      // rule is about how many bodies a common may put down, and "as many as
      // the resolution counted" has no ceiling to compare against. No generated
      // card can carry one — `ModelEffectSchema` is built over `z.int()` — so
      // this branch is only ever reached by a hand-authored card.
      (!isLiteralAmount(effect.count) || effect.count >= WIDE_TOKEN_COUNT),
  );
  if (wide) rules.push('wideBoard');
  return rules;
}

function abilityEffects(ability: Ability): readonly Effect[] {
  return hasAbilityEffects(ability) ? ability.effects : [];
}

export interface NwoResult {
  readonly commons: number;
  readonly flagged: readonly RedFlag[];
  readonly budget: number;
  readonly findings: readonly SetFinding[];
}

export function checkNewWorldOrder(
  entries: ReadonlyArray<{ readonly slot: Slot; readonly card: Card }>,
  budgetShare: number,
): NwoResult {
  const commons = entries.filter((entry) => entry.slot.rarity === 'common');
  const flagged = commons
    .map((entry) => ({ slotId: entry.slot.id, rules: redFlagsFor(entry.card) }))
    .filter((flag) => flag.rules.length > 0);

  const findings: SetFinding[] = flagged
    .filter((flag) => flag.rules.length >= 2)
    .map((flag) =>
      finding(
        'NWO_MULTI_RED_FLAG',
        'error',
        `common ${flag.slotId} trips ${flag.rules.length} New World Order red flags (${flag.rules.join(', ')}); simplify it or the card belongs at uncommon`,
        [flag.slotId],
      ),
    );

  const budget = Math.floor(commons.length * budgetShare);
  if (flagged.length > budget) {
    findings.push(
      finding(
        'NWO_BUDGET_EXCEEDED',
        'error',
        `${flagged.length} of ${commons.length} commons are red-flagged, over the budget of ${budget} (${Math.round(budgetShare * 100)}%); simplify the flagged commons`,
        flagged.map((flag) => flag.slotId),
      ),
    );
  }
  return { commons: commons.length, flagged, budget, findings };
}
