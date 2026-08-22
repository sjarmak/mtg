/**
 * Which printed ability is a mana ability, and what colors a permanent can tap
 * for.
 *
 * Its own file because the two questions need `Card` and `Ability` together,
 * and `effects.ts` — where `isManaEffect` lives — cannot import `card.ts`
 * without a cycle. It is also the seam every reader outside this package goes
 * through: the kernel enumerates mana abilities here, the validator refuses the
 * shapes here, and neither reaches into `card.abilities` to compare a `kind`
 * string against `'addMana'` itself.
 *
 * ## One mana ability per card, and one way to print it
 *
 * `manaSourceColors` returns a single list whichever way the card says it,
 * which is the whole reason both functions exist. A land says it in
 * `producesMana` — a field, not an ability, because CR 605.1a's intrinsic
 * "{T}: Add {G}" on a basic Forest is not printed text and never was — and
 * everything else says it in an activated ability whose one effect is
 * `addMana`. `validate/mana-ability.ts` refuses a card that says it both ways
 * and a card that says it twice, so these two functions are total: there is at
 * most one answer and it is the one they return.
 *
 * That is not tidiness. The kernel's `activateManaAbility` action carries
 * `(oid, color)` and no ability index — it has carried exactly that since
 * lands were the only mana source, and widening it would reach the replay log
 * schema, the UI rail, the referee and the backend projection — so `oid` has
 * to name one activation. The validator is what makes that true, and this file
 * is what reads it back.
 *
 * ## What mtg-nhyv.9 decided not to widen
 *
 * Four mana sources were said to be refused here — Llanowar Elves, Birds of
 * Paradise, Pyretic Ritual and Gilded Lotus — and the premise held for one of
 * them. Three were expressible the day the bead was written: `{T}: Add {G}` is
 * an `addMana` with one color, "one mana of any color" is the same effect with
 * `produces` read as the choice list it already is, and a ritual is not a mana
 * ability at all. Only Gilded Lotus was refused, and by one validator line
 * rather than by the action's shape.
 *
 * So the action does not grow a field, and here is each half of that:
 *
 *  - **No ability index.** Birds of Paradise is five legal `activateManaAbility`
 *    actions on one `oid`, not one action carrying a choice. The color is
 *    picked as the ability is activated, which is where a dual land's has
 *    always been picked, and rule 4 keeps one mana ability per card so `oid`
 *    still names one activation.
 *  - **No amount.** The amount already rides on the printed effect.
 *    `activateManaSource` narrows `produces` to the chosen color and hands the
 *    whole effect to `applyEffect`, and `addManaToPool` emits one
 *    `manaProduced` carrying the quantity. Gilded Lotus needed the validator to
 *    stop refusing "any one color" beside a number; it needed nothing of the
 *    kernel.
 *  - **No second path for a mana spell.** CR 605.1a: Pyretic Ritual is an
 *    instant, so it is cast, it uses the stack, and the mana arrives as it
 *    resolves through the ordinary resolution runner. `activateManaAbility` is
 *    the wrong path for it, not a path that needs widening.
 *
 * The replay log schema, the UI rail, the referee and the backend projection
 * are therefore untouched by this lane. The paragraph above still states the
 * cost of widening; nothing has been widened, and the reason is that nothing
 * these four cards say needs the action to say more than `(oid, color)`.
 */
import type { ActivatedAbility, Ability } from './abilities';
import type { Card } from './card';
import { isManaEffect } from './effects';
import type { ManaColor } from './vocabulary';

/**
 * True when this printed ability is a mana ability: activated, and it adds
 * mana.
 *
 * Deliberately a plain `boolean` rather than an `ability is ActivatedAbility`
 * predicate. Every caller that wants the narrowing already holds an
 * `ActivatedAbility` — `activationOptions` and `validateActivation` both ask
 * this *after* the kind check, to refuse the stack to a mana ability (CR
 * 605.3a) — and for them a predicate narrows the false branch to `never`, so
 * the next line that reads `ability.effects` stops compiling. A guard that
 * breaks its own callers is worse than the one `manaAbilityOf` writes inline.
 */
export function isManaAbility(ability: Ability): boolean {
  if (ability.kind !== 'activated') return false;
  return ability.effects.some((effect) => isManaEffect(effect.kind));
}

/**
 * The mana ability printed on this card, or `null` when it prints none.
 *
 * The first one found, and the validator's "at most one" rule is what makes
 * "the first" and "the only" the same permanent. A land's intrinsic ability is
 * deliberately not synthesized here: it has no printed cost to return and
 * nothing needs one, so the field is read directly by `manaSourceColors`.
 */
export function manaAbilityOf(card: Card): ActivatedAbility | null {
  for (const ability of card.abilities) {
    if (ability.kind === 'activated' && isManaAbility(ability)) return ability;
  }
  return null;
}

/**
 * Every color this permanent can tap for, however its card says so.
 *
 * Empty for a permanent that is not a mana source, which is the answer the
 * kernel's enumeration wants: no colors, no activations. Colors only: how many
 * of the chosen one arrive is `addMana`'s `amount`, and the two travel together
 * only in the kernel, where `tapPromise` pairs them for the payment planner. The
 * kernel's `landProduces` is the narrow half of this — lands only — and stays,
 * because a land's one mana is CR 605.1a's intrinsic ability rather than a
 * printed number to read.
 */
export function manaSourceColors(card: Card): readonly ManaColor[] {
  if (card.kind === 'land' && card.producesMana.length > 0) return card.producesMana;
  const ability = manaAbilityOf(card);
  if (ability === null) return [];
  for (const effect of ability.effects) {
    if (effect.kind === 'addMana') return effect.produces;
  }
  return [];
}
