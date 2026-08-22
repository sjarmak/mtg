/**
 * Type-line legality: supertypes, subtypes, creature stats, keyword placement.
 *
 * Keyword legality is the co-design invariant in miniature — the kernel only
 * evaluates evergreen keywords on permanents that can attack or block, so the
 * DSL refuses to express `flying` anywhere else. `card.keywords` is that flat
 * layer-6 vocabulary and it stays creature-only for exactly that reason.
 *
 * `card.keywordAbilities` is a different list and used to be judged by the same
 * sentence, which was wrong for two of its five kinds (`mtg-rji`). The split is
 * now by keyword ability rather than by card type, and the three questions it
 * asks are in `keywordAbilityPlacement` below.
 */
import type { Card, KeywordAbility } from '../card';
import { isPermanentCard } from '../card';
import { canonicalJson } from '../canonical-json';
import { withArticle } from '../text-util';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { SUBTYPE_PATTERN } from '../vocabulary';

const MIN_POWER = 0;
const MAX_POWER = 20;
const MIN_TOUGHNESS = 1;
const MAX_TOUGHNESS = 20;

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

export function checkSupertypes(card: Card): Violation[] {
  const found: Violation[] = [];
  for (const dupe of duplicatesOf(card.supertypes)) {
    found.push(
      violation('DUPLICATE_SUPERTYPE', 'supertypes', `supertype "${dupe}" is listed more than once`),
    );
  }
  const hasBasic = card.supertypes.includes('basic');
  if (card.kind === 'land') {
    if (hasBasic !== (card.basicLandType !== undefined)) {
      found.push(
        violation(
          'LAND_BASIC_TYPE_MISMATCH',
          card.basicLandType === undefined ? 'basicLandType' : 'supertypes',
          'a Basic land must name its basic land type, and a nonbasic land must omit `basicLandType`',
        ),
      );
    }
    if (card.basicLandType !== undefined && card.subtypes.length > 0) {
      found.push(
        violation(
          'LAND_BASIC_TYPE_MISMATCH',
          'subtypes',
          'a Basic land derives its one land subtype from `basicLandType`; explicit subtypes are not allowed',
        ),
      );
    }
  }
  if (card.kind !== 'land' && hasBasic) {
    found.push(
      violation(
        'SUPERTYPE_ILLEGAL_ON_CARD_TYPE',
        'supertypes',
        'the "basic" supertype is legal only on lands',
      ),
    );
  }
  if (card.supertypes.includes('legendary') && (card.kind === 'instant' || card.kind === 'sorcery')) {
    found.push(
      violation(
        'SUPERTYPE_ILLEGAL_ON_CARD_TYPE',
        'supertypes',
        `"legendary" is legal only on permanents, not on ${card.kind}s`,
      ),
    );
  }
  return found;
}

export function checkSubtypes(card: Card): Violation[] {
  const found: Violation[] = [];
  if (
    card.subtypes.length > 0 &&
    card.kind !== 'creature' &&
    card.kind !== 'artifact' &&
    card.kind !== 'land' &&
    card.kind !== 'enchantment' &&
    card.kind !== 'planeswalker'
  ) {
    found.push(
      violation(
        'SUBTYPE_ILLEGAL_ON_CARD_TYPE',
        'subtypes',
        `DSL v0 allows subtypes only on creatures, artifacts, enchantments, lands, and planeswalkers, not on ${card.kind}s`,
      ),
    );
  }
  for (const [index, subtype] of card.subtypes.entries()) {
    if (!SUBTYPE_PATTERN.test(subtype)) {
      found.push(
        violation(
          'INVALID_SUBTYPE',
          `subtypes[${index}]`,
          `subtype "${subtype}" must be a capitalised word such as "Goblin"`,
        ),
      );
    }
  }
  for (const dupe of duplicatesOf(card.subtypes)) {
    found.push(violation('DUPLICATE_SUBTYPE', 'subtypes', `subtype "${dupe}" is listed more than once`));
  }
  if (card.kind === 'enchantment') {
    const hasAuraSubtype = card.subtypes.includes('Aura');
    if (hasAuraSubtype !== (card.aura !== undefined)) {
      found.push(
        violation(
          'AURA_INVALID',
          card.aura === undefined ? 'subtypes' : 'aura',
          'an Aura must carry both the Aura subtype and the structured aura clause, and a blanket enchantment carries neither',
        ),
      );
    }
    if (card.aura !== undefined && card.subtypes.length !== 1) {
      found.push(violation('AURA_INVALID', 'subtypes', 'this Aura subset permits only the Aura subtype'));
    }
  }
  return found;
}

export function checkCreatureStats(card: Card): Violation[] {
  if (card.kind === 'creature') {
    const found: Violation[] = [];
    if (card.characteristicPowerToughness !== undefined) {
      if (card.power !== 0 || card.toughness !== 0) {
        found.push(
          violation(
            'CHARACTERISTIC_POWER_TOUGHNESS_CONFLICT',
            'characteristicPowerToughness',
            'a characteristic-defining value is authoritative; use canonical 0/0 storage rather than fixed printed stats',
          ),
        );
      }
      return found;
    }
    if (card.power < MIN_POWER || card.power > MAX_POWER) {
      found.push(
        violation(
          'CREATURE_STATS_OUT_OF_RANGE',
          'power',
          `power must be between ${MIN_POWER} and ${MAX_POWER}, got ${card.power}`,
        ),
      );
    }
    if (card.toughness < MIN_TOUGHNESS || card.toughness > MAX_TOUGHNESS) {
      found.push(
        violation(
          'CREATURE_STATS_OUT_OF_RANGE',
          'toughness',
          `toughness must be between ${MIN_TOUGHNESS} and ${MAX_TOUGHNESS}, got ${card.toughness}`,
        ),
      );
    }
    return found;
  }
  const found: Violation[] = [];
  for (const field of ['power', 'toughness'] as const) {
    if (card[field] !== undefined) {
      found.push(
        violation(
          'CREATURE_STATS_ON_NONCREATURE',
          field,
          `${field} is legal only on creature cards; remove it from this ${card.kind}`,
        ),
      );
    }
  }
  if (card.characteristicPowerToughness !== undefined) {
    found.push(
      violation(
        'CREATURE_STATS_ON_NONCREATURE',
        'characteristicPowerToughness',
        `characteristic power and toughness are legal only on creature cards; remove them from this ${card.kind}`,
      ),
    );
  }
  return found;
}

export function checkKeywords(card: Card): Violation[] {
  const found: Violation[] = [];
  const keywordAbilities = card.keywordAbilities ?? [];
  if (card.kind !== 'creature' && card.keywords.length > 0) {
    found.push(
      violation(
        'KEYWORD_ILLEGAL_ON_CARD_TYPE',
        'keywords',
        `${withArticle(card.kind)} cannot carry ${card.keywords.join(', ')}`,
      ),
    );
  }
  for (const dupe of duplicatesOf(card.keywords)) {
    found.push(violation('DUPLICATE_KEYWORD', 'keywords', `keyword "${dupe}" is listed more than once`));
  }
  const seen = new Map<string, number>();
  for (const [index, ability] of keywordAbilities.entries()) {
    const identity = keywordAbilityIdentity(ability);
    const earlier = seen.get(identity);
    if (earlier === undefined) seen.set(identity, index);
    else {
      found.push(
        violation(
          'DUPLICATE_KEYWORD',
          `keywordAbilities[${index}]`,
          `this keyword ability repeats keywordAbilities[${earlier}]`,
        ),
      );
    }
    const misplaced = keywordAbilityPlacement(card, ability);
    if (misplaced !== null) {
      found.push(violation('KEYWORD_ILLEGAL_ON_CARD_TYPE', `keywordAbilities[${index}]`, misplaced));
    }
    if (ability.kind === 'protection' && ability.quality.kind === 'subtype') {
      if (!SUBTYPE_PATTERN.test(ability.quality.subtype)) {
        found.push(
          violation(
            'INVALID_SUBTYPE',
            `keywordAbilities[${index}].quality.subtype`,
            `protected subtype "${ability.quality.subtype}" must be a capitalized word such as "Dragon"`,
          ),
        );
      }
    }
  }
  return found;
}

/**
 * The keyword abilities whose rules text is about attacking and blocking, and
 * which therefore have nowhere to land on a permanent that does neither.
 *
 * Defender is a restriction on declaring the permanent as an attacker (CR
 * 702.3b) and landwalk is a restriction on declaring blockers against it (CR
 * 702.13b); a Bronze Monument does not attack and is never blocked, so both
 * words would be printed and unread. Double strike is the same shape one step
 * later: CR 702.4b puts its object in the first-strike combat damage step as
 * well as the regular one, and a permanent that is neither attacking nor
 * blocking deals damage in neither.
 *
 * Protection is the odd one out and is here as a scope decision rather than a
 * rules one. CR 702.16 puts protection on any object, and this kernel already
 * agrees with that rule everywhere it matters — `damage.ts` collects protection
 * replacements over `battlefieldObjects` with no type filter, and
 * `canBeTargetedBy` reads `isProtectedFrom` off any object's characteristics.
 * Widening it is therefore a validator-only change with no kernel work behind
 * it, but it is not `mtg-rji`, and a protection-from-black artifact is not a
 * card anybody has asked for. Narrower than the kernel is the safe direction:
 * containment (CLAUDE.md) is DSL ⊆ engine, and a clause the engine can enforce
 * and the DSL cannot express costs nothing but a card design.
 */
const CREATURE_ONLY_KEYWORD_ABILITY_KINDS: readonly KeywordAbility['kind'][] = [
  'defender',
  'landwalk',
  'protection',
  'doubleStrike',
];

/**
 * Why this keyword ability may not sit on this card, or `null` when it may.
 *
 * Two rules, in this order. **A card that is not a permanent carries none of
 * them**: CR 205.1a names the permanent card types — artifact, creature,
 * enchantment, land, planeswalker — and an instant or a sorcery is not among
 * them, so it never reaches the battlefield for an indestructible or a hexproof
 * to be about. Then **the combat-shaped kinds stay on creatures**, for the
 * reasons `CREATURE_ONLY_KEYWORD_ABILITY_KINDS` gives.
 *
 * What is left is the pair this function exists to let through. Indestructible
 * is a static ability of a permanent, not of a creature (CR 702.12a: "a
 * permanent with indestructible can't be destroyed"), and so is hexproof (CR
 * 702.11b: "a permanent with hexproof can't be the target of spells or
 * abilities your opponents control"). The kernel has always read them that way
 * — `destroyPermanent` short-circuits on `hasKeywordAbility(state, oid,
 * 'indestructible')` with no card-type check above it, the CR 704 sweep in
 * `sba.ts` asks the same question, and `canBeTargetedBy` asks its hexproof
 * question of whatever object is being aimed at — so the old blanket refusal
 * was the DSL declining to say a thing the engine already enforced, and The
 * Trisigil ({3}, Legendary Artifact, indestructible) could not be written down.
 *
 * The message names the ability and the card type, because a validator that
 * says "a keyword ability is wrong here" on a card carrying three of them has
 * told the author to go looking.
 */
function keywordAbilityPlacement(card: Card, ability: KeywordAbility): string | null {
  if (!isPermanentCard(card)) {
    return `"${ability.kind}" is a static ability of a permanent (CR 205.1a), and ${withArticle(card.kind)} never reaches the battlefield`;
  }
  if (card.kind !== 'creature' && CREATURE_ONLY_KEYWORD_ABILITY_KINDS.includes(ability.kind)) {
    return `"${ability.kind}" applies to creatures that attack and block; ${withArticle(card.kind)} cannot carry it`;
  }
  return null;
}

function keywordAbilityIdentity(ability: KeywordAbility): string {
  return ability.kind === 'protection' ? `protection:${canonicalJson(ability.quality)}` : ability.kind;
}
