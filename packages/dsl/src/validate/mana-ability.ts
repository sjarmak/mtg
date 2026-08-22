/**
 * Where `addMana` may be printed, and what shape the ability around it takes.
 *
 * Five rules, and every one of them exists to keep a promise the kernel already
 * made before this effect existed. `activateManaAbility` carries `(oid, color)`
 * and nothing else — no ability index, no cost payload, no resolution pause —
 * because a land was the only mana source when the action was designed, and the
 * action is written into the replay log schema, the UI rail, the referee's
 * projection and the backend contract. Widening it is a lane; making the DSL
 * print only cards that fit it is this file.
 *
 * So:
 *
 *  1. **A mana ability is activated.** CR 605.1a: a mana ability could add
 *     mana, does not target, and is not a loyalty ability. A trigger that adds
 *     mana would have to use the stack, which CR 605.3a says a mana ability
 *     never does, so it is refused rather than run down a second path.
 *  2. **It prints exactly one effect.** A mana ability that also drew a card
 *     would resolve outside the stack, which is a different card from the one
 *     printed. One effect keeps "activate it" and "resolve it" the same event.
 *  3. **Its cost is `{T}`, plus mana if it wants.** The tap is what stops the
 *     ability being repeatable at one priority — `{2}: Add {G}{G}{G}` with no
 *     tap is infinite mana, and `checkActivationCost`'s own free-and-repeatable
 *     rule is the same argument one step earlier. A sacrifice and a loyalty
 *     cost are refused for the other reason: the frozen action payload has
 *     nowhere to carry which permanent was eaten.
 *  4. **A card prints at most one, and a land that already produces mana
 *     prints none.** This is what makes `oid` name one activation. Two mana
 *     abilities on one permanent, or an ability beside `producesMana`, and
 *     `(oid, color)` stops identifying which one the player meant.
 *  5. **A choice of colors is legal only on an activated ability, and carries a
 *     quantity only as "any one color".** The choice rides on the activation,
 *     which is where a dual land's choice has always ridden. A spell has nobody
 *     to ask as it resolves, and `PendingScry` is this engine's only pause
 *     mechanism — a second one for this would be a mechanism per effect. The
 *     quantity is the narrower half: Magic prints no "Add two {W} or {U}", but
 *     it does print "Add three mana of any one color", so a number beside a
 *     choice is legal exactly where every color is offered and one of them
 *     takes the whole amount. Nothing widens to carry it — the amount already
 *     rides on the printed effect, and `activateManaSource` narrows `produces`
 *     to the chosen color and hands the amount through untouched, so
 *     `(oid, color)` still says everything the action must say.
 *
 * One rule is deliberately absent: nothing here compares the mana an ability
 * costs against the mana it adds. `{1}, {T}: Add {G}` is a filter and
 * `{2}, {T}: Add {B} for each Swamp you control` is a Coffers, and whether
 * either is well priced is a curve question about the whole set rather than a
 * fact about the card. Rule 3's tap symbol is what makes an unbounded engine
 * impossible; with it, the worst a badly priced mana ability can be is a bad
 * card.
 *
 * The range on the quantity is not here — it is `LIMITS.manaAmount`, checked
 * through `EFFECT_RULES` like every other printed number, so a mana amount and
 * a damage amount are refused by the same machinery.
 */
import type { Ability } from '../abilities';
import type { Card } from '../card';
import type { Effect } from '../effects';
import { isManaEffect } from '../effects';
import { isManaAbility } from '../mana-ability';
import { COLORS } from '../vocabulary';
import type { Violation } from '../violations';
import { violation } from '../violations';

type AddManaEffect = Extract<Effect, { readonly kind: 'addMana' }>;

/**
 * Is this choice the whole of "any color", the one choice a quantity may ride
 * beside? Magic prints "Add three mana of any one color" and nothing shaped
 * like "Add three {W} or {U}", so the quantity is allowed exactly where the
 * templating exists: every color offered, one of them chosen, the whole amount
 * arriving in it.
 */
function offersEveryColor(effect: AddManaEffect): boolean {
  const distinct = new Set(effect.produces);
  return COLORS.every((color) => distinct.has(color)) && distinct.size === COLORS.length;
}

function invalid(path: string, message: string): Violation {
  return violation('MANA_ABILITY_INVALID', path, message);
}

/** The distinct-colors rule and the choice-implies-one-mana rule, wherever printed. */
function checkProduces(effect: AddManaEffect, path: string, activated: boolean): Violation[] {
  const found: Violation[] = [];
  const distinct = new Set(effect.produces);
  if (distinct.size !== effect.produces.length) {
    found.push(
      invalid(
        `${path}.produces`,
        `"${effect.produces.join(', ')}" repeats a color, and a choice between one thing and itself is not a choice; name each color once`,
      ),
    );
  }
  if (effect.produces.length <= 1) return found;
  if (!activated) {
    found.push(
      invalid(
        `${path}.produces`,
        'a spell has nobody to ask which color as it resolves; a choice of colors is printed on an activated ability, where the choice is made as the ability is activated',
      ),
    );
    return found;
  }
  if (effect.amount !== 1 && !offersEveryColor(effect)) {
    found.push(
      invalid(
        `${path}.amount`,
        'a quantity beside a choice of colors is printed only as "any one color", which names every color; "Add two {W} or {U}" is not a line Magic prints',
      ),
    );
  }
  return found;
}

/** Rules 2 and 3: the ability around the mana. */
function checkManaAbilityShape(ability: Ability, path: string): Violation[] {
  if (ability.kind !== 'activated') return [];
  const found: Violation[] = [];
  if (ability.effects.length !== 1) {
    found.push(
      invalid(
        `${path}.effects`,
        `a mana ability resolves without using the stack, so everything it does happens the instant it is activated; this one prints ${String(ability.effects.length)} effects and a mana ability prints exactly one`,
      ),
    );
  }
  if (!ability.cost.tapSelf) {
    found.push(
      invalid(
        `${path}.cost`,
        'a mana ability with no tap symbol is activatable again the moment it resolves, so any amount at or above its own cost is infinite mana; give it {T}',
      ),
    );
  }
  if (ability.cost.sacrificeSelf || ability.cost.sacrificeOther !== undefined) {
    found.push(
      invalid(
        `${path}.cost`,
        'a mana ability is activated through an action that carries only the source and the color chosen, and a sacrifice has no room in it; print the cost as mana and {T}',
      ),
    );
  }
  if (ability.loyaltyCost !== undefined) {
    found.push(
      invalid(
        `${path}.loyaltyCost`,
        'CR 605.1a: a loyalty ability is never a mana ability; print the mana on a permanent that taps for it',
      ),
    );
  }
  return found;
}

/** Rule 4: one mana source per card, said one way. */
function checkOneSource(card: Card): Violation[] {
  const abilities = card.abilities.filter((ability) => isManaAbility(ability));
  const found: Violation[] = [];
  if (abilities.length > 1) {
    found.push(
      invalid(
        'abilities',
        `a permanent is activated for mana by naming the permanent and the color, so it prints one mana ability; this card prints ${String(abilities.length)}`,
      ),
    );
  }
  if (card.kind === 'land' && card.producesMana.length > 0 && abilities.length > 0) {
    found.push(
      invalid(
        'abilities',
        'this land already taps for mana through producesMana, which is CR 605.1a intrinsic ability rather than printed text; a second, printed mana ability leaves nothing to say which one an activation meant',
      ),
    );
  }
  return found;
}

/** Every `addMana` printed on the card, wherever it is printed. */
export function checkManaAbilities(card: Card): Violation[] {
  const found: Violation[] = [...checkOneSource(card)];

  for (const [index, effect] of card.effects.entries()) {
    if (effect.kind !== 'addMana') continue;
    found.push(...checkProduces(effect, `effects[${index}]`, false));
  }
  for (const [modeIndex, mode] of (card.modes ?? []).entries()) {
    for (const [index, effect] of mode.effects.entries()) {
      if (effect.kind !== 'addMana') continue;
      found.push(...checkProduces(effect, `modes[${modeIndex}].effects[${index}]`, false));
    }
  }

  for (const [abilityIndex, ability] of card.abilities.entries()) {
    if (ability.kind === 'static') continue;
    const path = `abilities[${abilityIndex}]`;
    const mana = ability.effects.filter((effect) => isManaEffect(effect.kind));
    if (mana.length === 0) continue;
    if (ability.kind !== 'activated') {
      found.push(
        invalid(
          `${path}.effects`,
          'CR 605.3a: a mana ability never uses the stack, and a triggered ability always does; print the mana on an activated ability',
        ),
      );
      continue;
    }
    found.push(...checkManaAbilityShape(ability, path));
    for (const [index, effect] of ability.effects.entries()) {
      if (effect.kind !== 'addMana') continue;
      found.push(...checkProduces(effect, `${path}.effects[${index}]`, true));
    }
  }
  return found;
}
