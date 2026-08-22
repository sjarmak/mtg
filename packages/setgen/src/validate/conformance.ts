/**
 * Per-slot conformance: does the printed card match the slot it was designed for?
 *
 * These are the checks that make the skeleton binding rather than advisory. A
 * card can be perfectly legal DSL and still be the wrong card — a four-drop in a
 * two-drop slot, a green card in the white pool, a burn spell in a counterspell
 * slot — and each of those is a targeted regeneration, not a set-wide failure.
 */
import type { Card, Violation } from '@mtg/dsl';
import { cardManaValue, formatViolations, isPricedEffectKind, sortColors } from '@mtg/dsl';
import type { SetFinding } from './findings';
import { finding } from './findings';
import { cardOwnEffects, partCountersCreatedBy, subtypesCreatedBy } from './mechanics';
import type { Slot } from '../slot';

export function checkCardViolations(slot: Slot, violations: readonly Violation[]): SetFinding[] {
  if (violations.length === 0) return [];
  return [
    finding('CARD_INVALID', 'error', `${slot.id} is not a legal DSL card: ${formatViolations(violations)}`, [
      slot.id,
    ]),
  ];
}

export function checkSlotConformance(slot: Slot, card: Card): SetFinding[] {
  return [
    ...checkKind(slot, card),
    ...checkColor(slot, card),
    ...checkManaValue(slot, card),
    ...checkEffectKinds(slot, card),
    ...checkAbilityKinds(slot, card),
    ...checkAuraModifications(slot, card),
    ...checkTriggerConditions(slot, card),
    ...checkPartDrop(slot, card),
    ...checkSacrificeCost(slot, card),
    ...checkSupply(slot, card),
  ];
}

/**
 * A slot the brief told to drop a named permanent came home dropping it.
 *
 * The word has to match exactly, because that is the whole of the link between
 * the two cards: `ActivationCost.sacrificeOther` matches by subtype, and a
 * Brigand that leaves a "Keys" token beside a Chest that eats a "Key" is two
 * cards that look like an economy and are not one. `checkSacrificeSupply` would
 * catch the pair; this catches the card, which is the one a regeneration can
 * fix.
 */
function checkSupply(slot: Slot, card: Card): SetFinding[] {
  const wanted = slot.requiredCard?.suppliesSubtype;
  if (wanted === undefined) return [];
  const supplied = subtypesCreatedBy(card);
  if (supplied.includes(wanted)) return [];
  const found = supplied.length === 0 ? 'no token at all' : `tokens typed ${supplied.join(', ')}`;
  return [
    finding(
      'SLOT_SUPPLY_MISSING',
      'error',
      `${slot.id} exists to drop a ${wanted} permanent; "${card.name}" creates ${found}`,
      [slot.id],
    ),
  ];
}

/**
 * A slot the brief reserved for a part came home carrying one.
 *
 * The schema can only offer the Fuse shape; it cannot make the model use it, and
 * a Monster that answered with an ordinary 1/1 token would satisfy every other
 * check on this card. The counter kind is compared as well as the shape, because
 * the counter is the half the brief named and the model was told: a part placing
 * some other declared counter is the wrong part, and a regeneration of one slot
 * fixes it.
 */
function checkPartDrop(slot: Slot, card: Card): SetFinding[] {
  const wanted = slot.requiredCard?.partCounter;
  if (wanted === undefined) return [];
  const dropped = [...partCountersCreatedBy(card)];
  if (dropped.includes(wanted)) return [];
  const found =
    dropped.length === 0 ? 'no token printing Fuse at all' : `a part placing ${dropped.join(', ')}`;
  return [
    finding(
      'SLOT_PART_MISSING',
      'error',
      `${slot.id} exists to drop a part placing a ${wanted} counter; "${card.name}" creates ${found}`,
      [slot.id],
    ),
  ];
}

/**
 * A slot the brief told to eat a named subtype came home eating it.
 *
 * The schema offers `sacrificeOther` with both fields open, because the count is
 * the price and the price is the model's. Which subtype is not, so this is where
 * the brief's word is checked against the printed card, exactly as
 * `checkRequiredCards` checks the brief's name against it.
 */
function checkSacrificeCost(slot: Slot, card: Card): SetFinding[] {
  const wanted = slot.requiredCard?.sacrificeSubtype;
  if (wanted === undefined) return [];
  const eaten = card.abilities.flatMap((ability) =>
    ability.kind === 'activated' && ability.cost.sacrificeOther !== undefined
      ? [ability.cost.sacrificeOther.subtype]
      : [],
  );
  if (eaten.includes(wanted)) return [];
  const found = eaten.length === 0 ? 'nothing' : eaten.join(', ');
  return [
    finding(
      'SLOT_SACRIFICE_MISMATCH',
      'error',
      `${slot.id} opens by sacrificing ${wanted} permanents; "${card.name}" eats ${found}`,
      [slot.id],
    ),
  ];
}

function checkKind(slot: Slot, card: Card): SetFinding[] {
  if (card.kind === slot.cardKind) return [];
  return [
    finding(
      'SLOT_KIND_MISMATCH',
      'error',
      `${slot.id} is a ${slot.cardKind} slot but "${card.name}" is a ${card.kind}`,
      [slot.id],
    ),
  ];
}

function checkColor(slot: Slot, card: Card): SetFinding[] {
  const expected = slot.color === null ? [] : [slot.color];
  const actual = sortColors(card.colors);
  if (actual.length === expected.length && actual.every((color, index) => color === expected[index])) {
    return [];
  }
  const shown = actual.length === 0 ? 'colourless' : actual.join('');
  const want = expected.length === 0 ? 'colourless' : expected.join('');
  return [
    finding(
      'SLOT_COLOR_MISMATCH',
      'error',
      `${slot.id} is the ${want} pool but "${card.name}" costs ${shown}; adjust the mana cost's coloured pips`,
      [slot.id],
    ),
  ];
}

function checkManaValue(slot: Slot, card: Card): SetFinding[] {
  const value = cardManaValue(card);
  if (value >= slot.manaValueMin && value <= slot.manaValueMax) return [];
  return [
    finding(
      'SLOT_MANA_VALUE_MISS',
      'error',
      `${slot.id} needs mana value ${slot.manaValueMin}-${slot.manaValueMax} to keep the colour's curve; "${card.name}" costs ${value}`,
      [slot.id],
    ),
  ];
}

function checkEffectKinds(slot: Slot, card: Card): SetFinding[] {
  if (slot.effectKinds.length === 0) return [];
  // An unpriced primitive is in no slot's menu by construction, so it stays a
  // finding: a slot that asked for removal and got an exile is still a card the
  // slot did not ask for.
  //
  // `cardOwnEffects` reads `card.effects` or every mode's effects (CR 700.2),
  // whichever the card actually populates: a modal card's `card.effects` is
  // empty by construction, and reading it alone would let any mode print
  // whatever it liked past this slot's allowlist with `illegal` never seeing
  // it — the slot's menu enforced against a card that never showed it what
  // the card actually does.
  const illegal = cardOwnEffects(card).filter(
    (effect) => !isPricedEffectKind(effect.kind) || !slot.effectKinds.includes(effect.kind),
  );
  if (illegal.length === 0) return [];
  const kinds = [...new Set(illegal.map((effect) => effect.kind))].join(', ');
  return [
    finding(
      'SLOT_EFFECT_NOT_ALLOWED',
      'error',
      `${slot.id} fills the "${slot.role}" role, which may only use [${slot.effectKinds.join(', ')}]; "${card.name}" uses ${kinds}`,
      [slot.id],
    ),
  ];
}

/**
 * A permanent may print the ability kinds its slot was allocated, and no others.
 *
 * The rule runs in both directions, and the second one is the point. A slot with
 * no ability kinds is never shown the ability schema, so a card carrying one
 * there means the batch schema and the slot list disagree — a bug in the
 * generator, not a design the model got wrong — and it is caught rather than
 * printed. A slot that *was* allocated one, and whose card prints none, is the
 * mechanic quietly failing to appear; `checkMechanicCoverage` would only notice
 * if every slot in the mechanic's colors did it.
 */
function checkAbilityKinds(slot: Slot, card: Card): SetFinding[] {
  if (slot.abilityKinds.length === 0) {
    if (card.abilities.length === 0) return [];
    const kinds = [...new Set(card.abilities.map((ability) => ability.kind))].join(', ');
    return [
      finding(
        'SLOT_ABILITY_NOT_ALLOWED',
        'error',
        `${slot.id} was allocated no printed ability; "${card.name}" carries ${kinds}`,
        [slot.id],
      ),
    ];
  }
  if (card.abilities.length === 0) {
    return [
      finding(
        'SLOT_ABILITY_NOT_ALLOWED',
        'error',
        `${slot.id} exists to print the mechanic as [${slot.abilityKinds.join(', ')}]; "${card.name}" carries no ability`,
        [slot.id],
      ),
    ];
  }
  const illegal = card.abilities.filter((ability) => !slot.abilityKinds.includes(ability.kind));
  if (illegal.length === 0) return [];
  const kinds = [...new Set(illegal.map((ability) => ability.kind))].join(', ');
  return [
    finding(
      'SLOT_ABILITY_NOT_ALLOWED',
      'error',
      `${slot.id} may only print [${slot.abilityKinds.join(', ')}]; "${card.name}" carries ${kinds}`,
      [slot.id],
    ),
  ];
}

/**
 * An Aura prints the modifications its slot was allocated, and no others.
 *
 * Symmetric with `checkAbilityKinds` above, in both directions and for the same
 * reasons. A slot with no modification list is not an Aura slot and was never
 * shown the clause, so a card that came home with one means the batch schema and
 * the slot list disagree. A slot that names modifications and whose card carries
 * no clause is a blanket enchantment printed where an Aura was commissioned,
 * which is the whole difference between the two cards: they share a card kind
 * and differ only here.
 *
 * The kinds are compared and the numbers are not. How much an Aura gives is
 * priced by the rarity policy and ruled on by the color pie; which *property* it
 * changes is what the role decided, and it is the half a regeneration can fix by
 * quoting the slot back.
 */
function checkAuraModifications(slot: Slot, card: Card): SetFinding[] {
  const clause = card.kind === 'enchantment' ? card.aura : undefined;
  if (slot.auraModifications.length === 0) {
    if (clause === undefined) return [];
    return [
      finding(
        'SLOT_AURA_MISMATCH',
        'error',
        `${slot.id} was allocated no Aura clause; "${card.name}" enchants a ${clause.enchant}`,
        [slot.id],
      ),
    ];
  }
  if (clause === undefined) {
    return [
      finding(
        'SLOT_AURA_MISMATCH',
        'error',
        `${slot.id} exists to print an Aura modifying [${slot.auraModifications.join(', ')}]; "${card.name}" carries no Aura clause`,
        [slot.id],
      ),
    ];
  }
  // `some` rather than `includes`, because the two sides are deliberately
  // different types: a printed clause may carry any `AuraModificationKind` and a
  // slot may only name a `ModelAuraModificationKind`. That gap is the containment
  // this check reads back — a hand-authored clause the generator has no word for
  // is reported here as an illegal modification rather than being unaskable.
  const illegal = clause.modifications.filter(
    (modification) => !slot.auraModifications.some((allowed) => allowed === modification.kind),
  );
  if (illegal.length === 0) return [];
  const kinds = [...new Set(illegal.map((modification) => modification.kind))].join(', ');
  return [
    finding(
      'SLOT_AURA_MISMATCH',
      'error',
      `${slot.id} may only modify [${slot.auraModifications.join(', ')}]; "${card.name}" modifies ${kinds}`,
      [slot.id],
    ),
  ];
}

/**
 * A trigger printed on a slot whose mechanic stated its condition watches for
 * that condition.
 *
 * The read-back half of `DesiredMechanic.triggerConditions`, and the reason the
 * field is worth having: a brief that can ask for an enters trigger and cannot
 * tell whether it got one has asked for nothing. A mismatch is an error, so the
 * regeneration loop retries this slot with the condition quoted back at it,
 * rather than a set shipping the trigger the model preferred.
 *
 * Silent on the slots that state nothing, which is every slot every brief in
 * this tree allocates. The condition is then the model's, exactly as it was.
 */
function checkTriggerConditions(slot: Slot, card: Card): SetFinding[] {
  if (slot.triggerConditions.length === 0) return [];
  const printed = card.abilities.flatMap((ability) => (ability.kind === 'triggered' ? [ability] : []));
  const wrong = printed.filter(
    (ability) => !slot.triggerConditions.some((condition) => condition === ability.condition),
  );
  if (wrong.length === 0) return [];
  const found = [...new Set(wrong.map((ability) => ability.condition))].join(', ');
  return [
    finding(
      'SLOT_TRIGGER_MISMATCH',
      'error',
      `${slot.id} prints its mechanic on [${slot.triggerConditions.join(', ')}]; "${card.name}" triggers on ${found}`,
      [slot.id],
    ),
  ];
}

export function checkUnfilled(slot: Slot): SetFinding {
  return finding('SLOT_UNFILLED', 'error', `${slot.id} was never filled with a card`, [slot.id]);
}
