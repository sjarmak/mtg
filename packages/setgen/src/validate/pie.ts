/**
 * Color-pie conformance.
 *
 * Policy, straight from `@mtg/design-data`'s classification and the set-design
 * lane (section 10, check 4): primary or secondary passes, tertiary warns
 * against a per-set budget, off-pie fails. A card's colors are all valid
 * justifications, so the best placement among them wins.
 *
 * A colorless card has no color to justify anything, so the pie table cannot
 * rule on it at all. It is judged instead against the colorless allowance
 * below, which is exactly what the shipped skeleton allocates to the colorless
 * pool — and it is judged as a *tertiary* placement, because a colorless answer
 * is a deliberate deviation that should cost something from the per-set budget
 * rather than being free.
 */
import type { Ability, Card, EffectKind, StaticModification } from '@mtg/dsl';
import { hasAbilityEffects, isAuraCard, isStaticAuraModification } from '@mtg/dsl';
import type { ColorPieSubject, PieVerdict } from '@mtg/design-data';
import { bestVerdict, classifyForColors, isColorPieSubject } from '@mtg/design-data';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { cardOwnEffects } from './mechanics';
import type { Slot } from '../slot';

/**
 * What the colorless pool may print.
 *
 * `destroyPermanent` is here for `removalExpensive`, the noncreature colorless
 * role in the play-booster skeleton, and it is load-bearing: the pie places both
 * `destroyPermanent` and `dealDamage` off-pie in blue and in green, so a UG
 * deck's only way to answer a creature in DSL v0 is a colorless one.
 *
 * `createToken` arrived with abilities and has a card behind it rather than a
 * category. `cardSubjects` reads a permanent's abilities as well as a spell's
 * effects, so this list is also the whole vocabulary a colorless artifact's
 * printed ability may use, and the flagship set's colorless artifacts are its
 * economy: a Chest is a colorless artifact that yields a part or a weapon
 * (decision 14) and a small Monster's drop is a Key token (decision 8). With
 * only `destroyPermanent` here that Chest was off-pie, so the gate refused the
 * set the design document asks for; and since `destroyPermanent` can only ever
 * name a creature, the triggered-ability menu this list feeds was one effect
 * long and every entry in it unprintable.
 *
 * `putCounters` is the other half of that economy (Fuse, decision 9) and is
 * deliberately absent: it is not in `MODEL_EFFECT_KINDS`, so the generator
 * cannot answer with it, and an allowance for an effect nothing can print is a
 * row that nothing checks. It belongs here in the commit that lets the model
 * emit one.
 */
export const COLORLESS_ALLOWED_EFFECTS: readonly EffectKind[] = ['destroyPermanent', 'createToken'];

export interface PieRuling {
  readonly subject: ColorPieSubject;
  readonly verdict: PieVerdict;
}

/** A subject's name plus the kind of clause that put it on the table. */
interface SubjectSource {
  readonly name: string;
  /** True when the clause that put this subject on the table is an equip clause. */
  readonly viaEquip: boolean;
}

function modificationSubjects(modification: StaticModification, viaEquip: boolean): SubjectSource[] {
  return modification.kind === 'grantKeyword' ? [{ name: modification.keyword, viaEquip }] : [];
}

/**
 * What one printed ability puts on the table.
 *
 * An ability's effects are the same primitives a spell's are, so a trigger that
 * deals damage is red the way a burn spell is red, and a static that grants
 * flying is white and blue the way a printed flier is. Reading only
 * `card.effects` would let a generated card walk its whole vocabulary past the
 * pie by printing it inside an ability instead of on a spell — the one hole
 * teaching the generator abilities would otherwise open.
 *
 * A `statBonus` names no subject and gets no ruling: the pie has rows for
 * keywords and effect kinds, and "+1/+1 on the source" is neither.
 *
 * An equip clause's modifications are read for the same reason a static's are.
 * They were not, until `mtg-bfj6`: a weapon granting flying walked past the pie
 * in every color while an identical static grant was ruled on. What that hole
 * made *look* legal is the only reason the colorless allowance below has to be
 * stated out loud. `attach` was the only such hiding place when that was
 * written; an Aura's clause is the second, and `auraSubjects` reads it.
 */
function abilitySubjects(ability: Ability): SubjectSource[] {
  const effects: SubjectSource[] = hasAbilityEffects(ability)
    ? ability.effects.map((effect) => ({ name: effect.kind, viaEquip: false }))
    : [];
  if (ability.kind === 'static') {
    return [...effects, ...modificationSubjects(ability.modification, false)];
  }
  if (ability.kind === 'activated' && ability.attach !== undefined) {
    return [...effects, ...ability.attach.modifications.flatMap((item) => modificationSubjects(item, true))];
  }
  return effects;
}

/**
 * What an Aura's clause puts on the table.
 *
 * The same argument `abilitySubjects` makes: an Aura granting flying is white
 * and blue the way a printed flier is, and reading only the card's own keywords
 * would let a colored Aura hand out a keyword its color may not print. The hole
 * was real and open for as long as `aura` existed — `cardSubjects` read
 * keywords, effects and abilities, and an Aura carries its clause in none of
 * the three — so neither `checkCardPie` nor `offSignatureSubjects` ruled on a
 * single Aura in the set.
 *
 * Not `viaEquip`, even though both clauses grant a keyword to another
 * permanent. That allowance is about Equipment's colorless convention
 * (Whispersilk Cloak, Lightning Greaves), and an Aura has no such convention:
 * a colorless Aura granting menace is exactly the black card wearing no color
 * that the allowance below refuses.
 *
 * `grantLandwalk` names no subject, the way `statBonus` names none: the pie has
 * rows for `KEYWORDS` and `EFFECT_KINDS`, and forestwalk is in neither.
 */
function auraSubjects(card: Card): SubjectSource[] {
  if (!isAuraCard(card)) return [];
  return card.aura.modifications.flatMap((modification) =>
    isStaticAuraModification(modification) ? modificationSubjects(modification, false) : [],
  );
}

export interface CardSubject {
  readonly subject: ColorPieSubject;
  /** True when this subject reached the table through an equip clause. */
  readonly viaEquip: boolean;
}

/**
 * Every color-pie subject a card puts on the table: keywords, effects,
 * abilities, and an Aura's clause.
 *
 * Each one carries the kind of clause it came from rather than only its name,
 * because the colorless allowance below turns on the clause. Joining the two back
 * together on the keyword's name would let a card that grants menace through an
 * equip clause launder a menace it also has printed on itself.
 *
 * `cardOwnEffects` reads `card.effects` or every mode's effects (CR 700.2),
 * whichever the card actually populates, for the same reason `abilitySubjects`
 * reads an ability's effects rather than stopping at `card.effects`: a modal
 * spell printing `destroyPermanent` inside a mode is exactly as off-pie as one
 * printing it as a fixed effect, and reading `card.effects` alone would let it
 * walk past the pie by printing the effect inside a mode instead.
 */
export function cardSubjects(card: Card): CardSubject[] {
  const sources: SubjectSource[] = [
    ...card.keywords.map((keyword) => ({ name: keyword, viaEquip: false })),
    ...cardOwnEffects(card).map((effect) => ({ name: effect.kind, viaEquip: false })),
    ...card.abilities.flatMap(abilitySubjects),
    ...auraSubjects(card),
  ];
  return sources.flatMap((source) =>
    isColorPieSubject(source.name) ? [{ subject: source.name, viaEquip: source.viaEquip }] : [],
  );
}

/**
 * A colorless card's ruling, and the one keyword grant it is allowed.
 *
 * A colorless permanent may not *have* a keyword the pie places in a color, and
 * it may not hand one out through a static ability: an artifact anthem granting
 * menace is a black card wearing no color, and the allowance list above is the
 * whole of what the colorless pool prints.
 *
 * An equip clause is the exception, and it is a printed one rather than a
 * convenience. Equipment is colorless by convention in real Magic, and granting
 * a keyword is most of what equipment does — Fireshrieker, Whispersilk Cloak,
 * Lightning Greaves are colorless cards handing out double strike, unblockable
 * and haste. The pie has no row for that because the pie is a table of what a
 * *color* may do, and the creature holding the weapon is the one that ends up
 * with the keyword. So an equip grant passes rather than costing tertiary
 * budget: it is not a deviation from the colorless allowance, it is the shape
 * the allowance was always missing. A colored equipment is ruled on normally,
 * against its own colors, so this is a colorless rule and not a hole.
 *
 * The allowance is keyed on the clause a subject came from and not on the
 * keyword's name, which is why `cardSubjects` carries provenance. A colorless
 * weapon that grants menace on equip and also has menace printed on itself is
 * two subjects, and only the equip one passes.
 */
function colorlessVerdict(subject: ColorPieSubject, viaEquip: boolean): PieVerdict {
  if (viaEquip) return 'pass';
  return COLORLESS_ALLOWED_EFFECTS.some((kind) => kind === subject) ? 'warn' : 'fail';
}

export function rulingsFor(card: Card): PieRuling[] {
  return cardSubjects(card).map((item) => ({
    subject: item.subject,
    verdict:
      card.colors.length === 0
        ? colorlessVerdict(item.subject, item.viaEquip)
        : bestVerdict(classifyForColors(item.subject, card.colors)),
  }));
}

/** Off-pie subjects are card-level errors, blamed on the slot that printed them. */
export function checkCardPie(slot: Slot, card: Card): SetFinding[] {
  const offPie = rulingsFor(card).filter((ruling) => ruling.verdict === 'fail');
  if (offPie.length === 0) return [];
  const colors = card.colors.length === 0 ? 'colourless' : card.colors.join('');
  return [
    finding(
      'OFF_PIE',
      'error',
      `${slot.id} "${card.name}" is ${colors} and prints ${offPie.map((r) => r.subject).join(', ')}, which the mechanical colour pie places off-pie there`,
      [slot.id],
    ),
  ];
}

export interface TertiaryUsage {
  readonly slotId: string;
  readonly subject: ColorPieSubject;
}

export function tertiaryUsage(slot: Slot, card: Card): TertiaryUsage[] {
  return rulingsFor(card)
    .filter((ruling) => ruling.verdict === 'warn')
    .map((ruling) => ({ slotId: slot.id, subject: ruling.subject }));
}

/**
 * Tertiary placements are legal design, budgeted per set. Exceeding the budget
 * is reported, never auto-fixed: which tertiary card to cut is a design call.
 */
export function checkTertiaryBudget(usage: readonly TertiaryUsage[], budget: number): SetFinding[] {
  if (usage.length <= budget) return [];
  const slotIds = [...new Set(usage.map((item) => item.slotId))];
  return [
    finding(
      'TERTIARY_OVER_BUDGET',
      'warning',
      `${usage.length} tertiary colour-pie placements exceed the per-set budget of ${budget}: ${usage
        .map((item) => `${item.slotId}/${item.subject}`)
        .join(', ')}`,
      slotIds,
    ),
  ];
}
