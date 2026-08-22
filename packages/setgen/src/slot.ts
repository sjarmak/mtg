/**
 * A slot: one printed card's worth of design constraints, decided before any
 * model call.
 *
 * Slot ids follow the Nuts & Bolts slot-code convention (CW01 = common white
 * slot 1, UU03 = uncommon blue slot 3, CA02 = common artifact/colorless slot
 * 2), so a generated set can be read against the published skeleton by eye.
 */
import type { SliceRarity } from '@mtg/design-data';
import type {
  AbilityKind,
  CardKind,
  Color,
  EffectKind,
  Keyword,
  ModelAuraModificationKind,
  ModelTriggerCondition,
} from '@mtg/dsl';
import type { RequiredCard } from './brief';

export interface Slot {
  /** Skeleton slot code, unique in the set: `CW01`, `UA02`. */
  readonly id: string;
  /** Position in the allocation, 0-based; drives collector numbers. */
  readonly index: number;
  readonly collectorNumber: number;
  /**
   * The profile's own rarity vocabulary, not a copy of it. That is what routed
   * `mtg-bc2.26.4`'s third tier here: widening `SLICE_RARITIES` broke
   * `RARITY_LETTER` below, which had no letter for a rare, instead of leaving
   * the allocator quietly unable to build the slot. A fourth tier lands the
   * same way.
   */
  readonly rarity: SliceRarity;
  /** `null` is the colorless (artifact) pool. */
  readonly color: Color | null;
  readonly cardKind: CardKind;
  /** Skeleton role name: `creature` or a spell role such as `removalExile`. */
  readonly role: string;
  readonly manaValueMin: number;
  readonly manaValueMax: number;
  /** Keywords the printed card must carry, exactly. Empty for a vanilla slot. */
  readonly keywords: readonly Keyword[];
  /** Effect primitives the printed card may use. Empty on permanents. */
  readonly effectKinds: readonly EffectKind[];
  /**
   * CR 113 ability kinds the printed permanent may carry. Empty on every slot a
   * brief did not ask for an ability on, which is most of them.
   *
   * The list is load-bearing twice over. It decides which fill batches are shown
   * the ability schema at all, so a brief that names no ability kind builds the
   * same prompt and the same JSON Schema it always did and every recorded
   * fixture keeps replaying. And `checkSlotConformance` reads it back: a card
   * carrying a kind its slot was not allocated is a targeted regeneration, the
   * same way an off-role effect is.
   */
  readonly abilityKinds: readonly AbilityKind[];
  /**
   * What an Aura printed here may do to the creature it enchants. Empty on every
   * slot that is not an Aura slot, which is all of them until a brief states one
   * of the Aura roles.
   *
   * Non-empty is also what makes the slot's card an Aura rather than a blanket
   * enchantment: the two share a card kind and differ by whether the clause is
   * there, so the allocator states which one this slot is here and
   * `checkAuraModifications` reads the printed card back against it. The list is
   * `ModelAuraModificationKind` rather than a boolean because an Aura's whole design
   * is its clause, and a slot that says only "print an Aura" prints the same
   * Aura in every color.
   */
  readonly auraModifications: readonly ModelAuraModificationKind[];
  /**
   * CR 603 conditions a trigger printed here may watch for. Empty means the
   * three the DSL has, which is what the batch's ability vocabulary already
   * says; a stated list narrows this one slot to what its mechanic asked for.
   *
   * Only `reserveAbilitySlots` fills it, because that is the pass that also
   * names the mechanic on the slot. The signpost pass reserves ability kinds
   * without naming a mechanic — a signpost prints its pair's payoff, not a
   * mechanic's line — and a condition with no mechanic attached to it is a
   * constraint the model is given no reason for.
   */
  readonly triggerConditions: readonly ModelTriggerCondition[];
  /** Brief mechanics this slot was allocated to support, by name. */
  readonly mechanics: readonly string[];
  /**
   * Color-pair archetypes this slot was *reserved* for, by pair key. Empty on
   * an ordinary slot: a white common is playable in all four white pairs, but
   * only a reserved slot exists because a pair needed it.
   */
  readonly archetypes: readonly string[];
  /** True when the slot is a pair's signpost uncommon. */
  readonly signpost: boolean;
  /**
   * The brief's required card this slot was reserved for, if any. The printed
   * card carries this name and no other; everything else about it is still the
   * model's design.
   */
  readonly requiredCard?: RequiredCard;
}

const RARITY_LETTER: Readonly<Record<SliceRarity, string>> = { common: 'C', uncommon: 'U', rare: 'R' };

/** `W`..`G` for colored pools, `A` for the colorless/artifact pool. */
export function poolLetter(color: Color | null): string {
  return color ?? 'A';
}

export function slotId(rarity: SliceRarity, color: Color | null, ordinal: number): string {
  return `${RARITY_LETTER[rarity]}${poolLetter(color)}${String(ordinal).padStart(2, '0')}`;
}

/** Stable group key for per-color-per-rarity set-level checks. */
export function groupKey(rarity: SliceRarity, color: Color | null): string {
  return `${rarity}:${poolLetter(color)}`;
}

export function slotGroupKey(slot: Slot): string {
  return groupKey(slot.rarity, slot.color);
}

export function isCreatureSlot(slot: Slot): boolean {
  return slot.cardKind === 'creature';
}

export function isSpellSlot(slot: Slot): boolean {
  return slot.cardKind === 'instant' || slot.cardKind === 'sorcery';
}

/**
 * Card kinds an ability may be printed on; `checkAbilityKinds` refuses the rest.
 *
 * Two passes reserve abilities — the allocator's `reserveAbilitySlots`, per
 * brief mechanic, and `assignSignposts`, when a pair's payoff is an effect — and
 * a second copy of this predicate would be a second answer to "may this slot
 * carry an ability" that drifts from the validator's.
 */
export function carriesAbilities(slot: Slot): boolean {
  return slot.cardKind === 'creature' || slot.cardKind === 'artifact';
}

/**
 * A slot whose card, as allocated, would carry no printed word: no keyword, no
 * effect, no ability.
 *
 * The one predicate, for the same reason `carriesAbilities` is one. Three passes
 * ask this question — `fillTextlessPermanents`, which hands such a slot a static
 * ability; `checkSlotFillability`, which refuses the ones a static never reaches;
 * and the tests that pin both — and a second copy of it would be a second answer
 * to "does this slot print anything" that drifts from the allocator's.
 *
 * It reads every list rather than the one the slot kind happens to use, because
 * that is the question. A creature slot is never allocated an effect and a
 * colorless permanent slot is never allocated a keyword, so on today's slots the
 * extra terms cost nothing; on a slot shape that carries both they answer
 * correctly instead of by accident. `auraModifications` is the term that proved
 * it: an Aura slot carries no keyword, no effect and no ability, and without
 * this term `checkSlotFillability` refused the one card the slot exists to
 * print.
 */
export function printsNoText(slot: Slot): boolean {
  return (
    slot.keywords.length === 0 &&
    slot.effectKinds.length === 0 &&
    slot.abilityKinds.length === 0 &&
    slot.auraModifications.length === 0
  );
}

/** One-line human summary used in prompts and reports. */
export function describeSlot(slot: Slot): string {
  const pool = slot.color ?? 'colourless';
  const mv =
    slot.manaValueMin === slot.manaValueMax
      ? `MV ${slot.manaValueMin}`
      : `MV ${slot.manaValueMin}-${slot.manaValueMax}`;
  const keywords = slot.keywords.length > 0 ? `, keywords: ${slot.keywords.join(', ')}` : '';
  const effects = slot.effectKinds.length > 0 ? `, effects: ${slot.effectKinds.join('|')}` : '';
  const abilities = slot.abilityKinds.length > 0 ? `, abilities: ${slot.abilityKinds.join('|')}` : '';
  const aura =
    slot.auraModifications.length > 0 ? `, aura modifies: ${slot.auraModifications.join('|')}` : '';
  const mechanics = slot.mechanics.length > 0 ? `, supports: ${slot.mechanics.join(', ')}` : '';
  const archetypes =
    slot.archetypes.length === 0
      ? ''
      : `, ${slot.signpost ? 'signpost for' : 'archetype support for'}: ${slot.archetypes.join(', ')}`;
  return `${slot.id}: ${slot.rarity} ${pool} ${slot.cardKind}, role ${slot.role}, ${mv}${keywords}${effects}${abilities}${aura}${mechanics}${archetypes}`;
}

export function slotById(slots: readonly Slot[]): ReadonlyMap<string, Slot> {
  return new Map(slots.map((slot) => [slot.id, slot]));
}
