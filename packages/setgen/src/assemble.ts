/**
 * Slot + model output -> a DSL card, or the violations explaining why not.
 *
 * Assembly is where generated design meets the engine's contract. Identity
 * (card id, set reference, collector number), rarity, color identity and the
 * allocated keywords are stamped from the slot rather than trusted from the
 * model; everything else is the model's design, parsed through `CardSchema` and
 * then run through the DSL's structural validators. Nothing reaches a set file
 * without passing both.
 */
import type { Card, CardInput, Effect, Violation } from '@mtg/dsl';
import {
  abilityFromModel,
  assertNever,
  canonicalJson,
  CardSchema,
  colorsFromCost,
  loyaltyAbilityFromModel,
  schemaIssuesToViolations,
  validateCardRecord,
  violation,
  withRenderedOracleText,
} from '@mtg/dsl';
import type { FilledCard } from './filled';
import { filledAbilities } from './filled';
import type { Slot } from './slot';

export interface AssemblyResult {
  /** Present only when the card parsed and passed every structural validator. */
  readonly card?: Card;
  readonly violations: readonly Violation[];
  /**
   * Exact repeats `normaliseEffects` dropped before parsing. Counted even
   * when the card was then rejected for something else: the number says how
   * often the model proposed a card the DSL would have refused, which is a fact
   * about the generator whether or not that particular card survived.
   */
  readonly duplicateEffectsDropped: number;
}

/** Lowercase slug used for card ids: `Solar Lancer` -> `solar-lancer`. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cardIdFor(setCode: string, name: string): string {
  const slug = slugify(name);
  return slug.length === 0 ? '' : `${setCode.toLowerCase()}-${slug}`;
}

export function assembleCard(slot: Slot, filled: FilledCard, setCode: string): AssemblyResult {
  const id = cardIdFor(setCode, filled.name);
  if (id.length === 0) {
    return {
      violations: [
        violation(
          'SCHEMA_INVALID',
          'name',
          `card name ${JSON.stringify(filled.name)} yields no usable card id`,
        ),
      ],
      duplicateEffectsDropped: 0,
    };
  }

  const normalised = normaliseEffects(filled);
  const dropped = normalised.dropped;
  const input = buildCardInput(slot, filled, setCode, id, normalised.kept);
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) {
    return { violations: schemaIssuesToViolations(parsed.error.issues), duplicateEffectsDropped: dropped };
  }

  const card = withRenderedOracleText(parsed.data);
  const violations = validateCardRecord(card);
  return violations.length > 0
    ? { violations, duplicateEffectsDropped: dropped }
    : { card, violations: [], duplicateEffectsDropped: dropped };
}

interface NormalisedEffects {
  readonly kept: readonly Effect[];
  readonly dropped: number;
}

/**
 * Drops a repeated effect before the card is parsed, and reports how many went,
 * so the correction is not silent.
 *
 * The DSL rejects a list carrying the same effect twice (`DUPLICATE_EFFECT`).
 * Normalizing here rather than letting that rejection reach the retry loop
 * survives mtg-bc2.56, which narrowed the half of the prompt that was asking for
 * the repeat: a slot whose vocabulary can express only one distinct effect now
 * reads "exactly 1 entry". That covers two of the seven repeats in the recorded
 * Tideglass Reach run. The other five came from slots that genuinely offered a
 * second, different entry, and every one of their design notes asks for the same
 * thing the vocabulary cannot give — a second *target*. "Two shards, two
 * targets", "bounce two creatures", "locks two ground bodies": DSL v0 resolves
 * an effects list index by index with no distinctness constraint, so those cards
 * do not exist, and no wording of the slot spec makes them exist. Rejecting
 * would spend a regeneration round asking the model to abandon a design the
 * schema cannot hold, which is a different fix (a targeting primitive) than a
 * prompt correction.
 *
 * So the transform stays, and the count reaches `GenerationReport` instead of
 * dying here. It is also the measurement that settles the question: a live
 * re-record under the narrowed prompt either reports zero and the transform can
 * become a rejection, or reports the multi-target designs again and names the
 * DSL gap they are asking for.
 */
function normaliseEffects(filled: FilledCard): NormalisedEffects {
  if (filled.kind !== 'instant' && filled.kind !== 'sorcery') return { kept: [], dropped: 0 };
  const seen = new Set<string>();
  const kept = filled.effects.filter((effect) => {
    const key = canonicalJson(effect);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { kept, dropped: filled.effects.length - kept.length };
}

function buildCardInput(
  slot: Slot,
  filled: FilledCard,
  setCode: string,
  id: string,
  effects: readonly Effect[],
): CardInput {
  const set = { code: setCode, collectorNumber: slot.collectorNumber };
  // The model-facing schema omits `hasX` (`filled.ts`), and `colorsFromCost`
  // never reads it, so a locally-resolved `false` is not a claim about the
  // card, only what this call needs to typecheck against `ManaCost`.
  const colors = colorsFromCost({ ...filled.manaCost, hasX: false });
  // `supertypes` was hardcoded empty here, which meant the generator could not
  // emit a legendary card at any point in its life: the DSL models the supertype,
  // `renderOracleText` prints it, and `sba.ts` enforces the legend rule over it,
  // but nothing upstream could ever set it. A set built out of named legends
  // printed none, so CR 704.5j was unreachable from generated play.
  //
  // Only a required card can claim it, because only a required card is named by
  // the brief; an invented card has no name anyone has decided is unique.
  const supertypes = slot.requiredCard?.legendary === true ? ['legendary' as const] : [];
  const base = { id, name: filled.name, rarity: slot.rarity, set, colors, supertypes };
  // `abilityFromModel` is the crossing into the engine's contract, and its
  // return type is the compile-time proof that what crosses is an `Ability`.
  // Two things it changes: the equip clause, whose model tier states a single
  // modification and whose engine tier holds a list (`@mtg/dsl`'s
  // `ModelAttachSchema` argues why the two are shaped differently), and an
  // activated ability's `cost.mana.hasX`, absent from every model-facing cost
  // schema and filled to `false` here for the same reason this file's own
  // `colorsFromCost` call does a few lines up. Everything else crosses
  // unchanged, which is `ModelAbilityIsAbility` doing the work.
  // Whether the slot was allowed to ask for the ability is
  // `checkSlotConformance`; whether the ability is legal on this card is
  // `checkAbilities`, reached below through `validateCardRecord`.
  const abilities = filledAbilities(filled).map(abilityFromModel);

  switch (filled.kind) {
    case 'creature':
      return {
        ...base,
        kind: 'creature',
        manaCost: filled.manaCost,
        artifact: slot.color === null,
        subtypes: filled.subtypes,
        keywords: [...slot.keywords],
        effects: [],
        abilities,
        power: filled.power,
        toughness: filled.toughness,
      };
    case 'instant':
      return {
        ...base,
        kind: 'instant',
        manaCost: filled.manaCost,
        subtypes: [],
        keywords: [],
        effects: [...effects],
      };
    case 'sorcery':
      return {
        ...base,
        kind: 'sorcery',
        manaCost: filled.manaCost,
        subtypes: [],
        keywords: [],
        effects: [...effects],
      };
    case 'artifact':
      return {
        ...base,
        kind: 'artifact',
        manaCost: filled.manaCost,
        subtypes: filled.subtypes,
        keywords: [],
        effects: [],
        abilities,
      };
    // The subtype is stamped rather than asked for, and `checkSubtypes` is why:
    // an Aura carries the Aura subtype and nothing else, and a blanket
    // enchantment carries none, so the model's answer already decides the one
    // legal value. Asking for it would offer a field whose only use is to
    // disagree with the clause beside it.
    case 'enchantment':
      return {
        ...base,
        kind: 'enchantment',
        manaCost: filled.manaCost,
        subtypes: filled.aura === undefined ? [] : ['Aura'],
        keywords: [],
        effects: [],
        abilities,
        ...(filled.aura === undefined ? {} : { aura: filled.aura }),
      };
    // `loyaltyAbilityFromModel` rather than `abilityFromModel`, because a
    // loyalty ability is not a member of the union the other four kinds answer
    // in: CR 606.2 makes the signed loyalty change the whole cost, so the model
    // states no cost field and the free one is filled at the crossing. The
    // annotated return type over there is the proof that what crosses is an
    // `Ability`, exactly as it is for the others.
    case 'planeswalker':
      return {
        ...base,
        kind: 'planeswalker',
        manaCost: filled.manaCost,
        subtypes: [filled.subtype],
        keywords: [],
        effects: [],
        abilities: filled.loyaltyAbilities.map(loyaltyAbilityFromModel),
        startingLoyalty: filled.startingLoyalty,
      };
    default:
      return assertNever(filled, 'buildCardInput');
  }
}
