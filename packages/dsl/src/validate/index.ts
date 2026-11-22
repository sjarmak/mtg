/**
 * The validation entry points.
 *
 * `validateCard` takes unknown input (LLM output, JSON on disk, a subprocess
 * response) and returns violations; it never throws for invalid data. Schema
 * failures short-circuit the structural pass because structural checks assume
 * a well-typed record.
 */
import type { Card, EntryCharacteristicMode } from '../card';
import { CardSchema, transformedBackFaceOf } from '../card';
import { canonicalJson } from '../canonical-json';
import { renderOracleText } from '../oracle';
import { hybridManaReminderText } from '../reminder';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { checkAbilities } from './abilities';
import { checkAura } from './aura';
import { checkColorIdentity, checkCostReduction, checkManaCost } from './cost';
import { checkEffects } from './effects';
import { checkFlavorText } from './flavor';
import { checkManaAbilities } from './mana-ability';
import { checkOverload } from './overload';
import { schemaIssuesToViolations } from './schema-issues';
import { checkCreatureStats, checkKeywords, checkSubtypes, checkSupertypes } from './typeline';

export { HAND_AUTHORED_TARGETS, LEGAL_TARGETS, legalScopesFor, legalTargetsFor } from './effects';
export { staticModificationIdentity } from './abilities';
export { schemaIssuesToViolations } from './schema-issues';
export type { SchemaIssue } from './schema-issues';

/**
 * Structural checks over an already-parsed card. Every check is total and
 * side-effect free; the list is ordered so that the most actionable problems
 * (cost, color, type line) come first.
 */
interface CardValidationContext {
  /** A transformed face's `colors` are a color indicator, not mana-cost-derived. */
  readonly transformedFace?: true;
}

export function validateCardRecord(card: Card, context: CardValidationContext = {}): Violation[] {
  return [
    ...checkManaCost(card),
    ...checkAlternativeCost(card),
    ...checkOverload(card),
    ...(context.transformedFace === true ? [] : checkColorIdentity(card)),
    ...checkCostReduction(card),
    ...checkEntryReplacement(card),
    ...checkPalisadeDamageRedirection(card),
    ...checkSupertypes(card),
    ...checkSubtypes(card),
    ...checkCreatureStats(card),
    ...checkKeywords(card),
    ...checkKeywordLineGroups(card),
    ...checkHybridManaReminder(card),
    ...checkAura(card),
    ...checkEffects(card),
    ...checkAbilities(card),
    ...checkManaAbilities(card),
    ...checkBattle(card),
    ...checkOracleText(card),
    ...checkFlavorText(card),
  ];
}

/** The card-bound flag and its layer-aware static marker are one atomic rule. */
function checkPalisadeDamageRedirection(card: Card): Violation[] {
  if (card.kind !== 'creature' || card.redirectControllerAndOtherPermanentsDamageToSelf !== true) {
    return [];
  }
  const marker = card.abilities.filter(
    (ability) =>
      ability.kind === 'static' &&
      ability.scope === 'self' &&
      ability.subtype === null &&
      ability.filter === undefined &&
      ability.activeDuring === undefined &&
      ability.enabledWhile === undefined &&
      ability.modification.kind === 'preventCombatDamage',
  );
  if (marker.length === 1 && card.abilities.length === 1) return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'redirectControllerAndOtherPermanentsDamageToSelf',
      'the Palisade damage-redirection flag requires exactly one unconditional self-scoped preventCombatDamage marker and no independent abilities',
    ),
  ];
}

/** A printed payment gloss is derived only for one source-attested hybrid pip. */
function checkHybridManaReminder(card: Card): Violation[] {
  if (
    card.kind === 'land' ||
    card.kind === 'battle' ||
    card.printedHybridManaReminder !== true ||
    hybridManaReminderText(card.manaCost) !== null
  ) {
    return [];
  }
  return [
    violation(
      'HYBRID_MANA_REMINDER_INVALID',
      'printedHybridManaReminder',
      'a printed hybrid mana reminder requires exactly one hybrid mana symbol',
    ),
  ];
}

function keywordLineItemIdentity(item: NonNullable<Card['keywordLineGroups']>[number][number]): string {
  return typeof item === 'string' ? `keyword:${item}` : `ability:${canonicalJson(item)}`;
}

/** The optional print layout must be an exact permutation of the structured rules vocabulary. */
function checkKeywordLineGroups(card: Card): Violation[] {
  const groups = card.keywordLineGroups;
  if (groups === undefined) return [];
  const expected = [
    ...card.keywords.map((keyword) => `keyword:${keyword}`),
    ...(card.keywordAbilities ?? []).map((ability) => `ability:${canonicalJson(ability)}`),
  ].sort();
  const actual = groups.flat().map(keywordLineItemIdentity).sort();
  if (canonicalJson(actual) === canonicalJson(expected)) return [];
  return [
    violation(
      'KEYWORD_LINE_GROUPS_MISMATCH',
      'keywordLineGroups',
      'keyword line groups must contain every printed keyword and keyword ability exactly once',
    ),
  ];
}

/** Siege is the transforming Battle subtype; its two pieces are one contract. */
function checkBattle(card: Card): Violation[] {
  if (card.kind !== 'battle') return [];
  const siege = card.subtypes.includes('Siege');
  if (siege && card.backFace === undefined) {
    return [
      violation('BATTLE_INVALID', 'backFace', 'a Siege must carry the transforming back face it may cast'),
    ];
  }
  if (!siege && card.backFace !== undefined) {
    return [
      violation(
        'BATTLE_INVALID',
        'subtypes',
        'a Battle with a transforming back face must have subtype Siege',
      ),
    ];
  }
  const back = transformedBackFaceOf(card);
  if (back === null) return [];
  return validateCardRecord(back, { transformedFace: true }).map((found) => ({
    ...found,
    path: found.path.length === 0 ? 'backFace' : `backFace.${found.path}`,
  }));
}

/** A chosen entry count can only read an X announced by this permanent spell. */
function checkEntryReplacement(card: Card): Violation[] {
  const found: Violation[] = [];
  if (card.kind === 'creature' && card.entryReplacement?.kind === 'entersAsCharacteristicChoice') {
    const identities = new Set<string>();
    for (const [index, mode] of card.entryReplacement.modes.entries()) {
      const identity = entryCharacteristicIdentity(card, mode);
      if (identities.has(identity)) {
        found.push(
          violation(
            'DUPLICATE_ENTRY_MODE',
            `entryReplacement.modes[${String(index)}]`,
            'each entry choice must produce different copiable characteristics on this creature',
          ),
        );
      }
      identities.add(identity);
    }
  }
  if (
    (card.kind === 'creature' || card.kind === 'artifact') &&
    card.entryReplacement?.kind === 'entersWithCounters' &&
    typeof card.entryReplacement.count !== 'number' &&
    card.entryReplacement.count.kind === 'chosenX' &&
    !card.manaCost.hasX
  ) {
    found.push(
      violation(
        'CHOSEN_X_WITHOUT_X_COST',
        'entryReplacement.count',
        'a chosen-X entry count is legal only on a permanent whose mana cost contains X',
      ),
    );
  }
  return found;
}

/** Canonical layer-1 result of applying one characteristic package to its printed creature. */
function entryCharacteristicIdentity(
  card: Extract<Card, { kind: 'creature' }>,
  mode: EntryCharacteristicMode,
): string {
  return canonicalJson({
    power: mode.power,
    toughness: mode.toughness,
    subtypes: [...new Set([...card.subtypes, ...(mode.addSubtypes ?? [])])].sort(),
    keywords: [...new Set([...card.keywords, ...(mode.addKeywords ?? [])])].sort(),
    keywordAbilities: [
      ...new Set(
        [...(card.keywordAbilities ?? []), ...(mode.addKeywordAbilities ?? [])].map((ability) =>
          canonicalJson(ability),
        ),
      ),
    ].sort(),
  });
}

/** Keeps the one supported CR 118.9 price from composing into untyped costs. */
function checkAlternativeCost(card: Card): Violation[] {
  if (card.kind === 'land' || card.alternativeCost === undefined) return [];
  const violations: Violation[] = [];
  if (card.manaCost.hasX) {
    violations.push(
      violation(
        'CASTING_RULE_ILLEGAL_ON_CARD_TYPE',
        'alternativeCost',
        'this alternative cost contains no X term and cannot be combined with a variable printed cost',
      ),
    );
  }
  if ((card.kind === 'instant' || card.kind === 'sorcery') && card.additionalCost !== undefined) {
    violations.push(
      violation(
        'CASTING_RULE_ILLEGAL_ON_CARD_TYPE',
        'alternativeCost',
        'the supported alternative and a separate additional cost cannot share one spell payment',
      ),
    );
  }
  return violations;
}

/** `oracleText`, when cached on the record, must equal the rendered text. */
function checkOracleText(card: Card): Violation[] {
  if (card.oracleText === undefined) return [];
  const rendered = renderOracleText(card);
  if (card.oracleText === rendered) return [];
  return [
    violation(
      'ORACLE_TEXT_MISMATCH',
      'oracleText',
      `oracle text is rendered from the structured card, not authored; expected ${JSON.stringify(rendered)}`,
    ),
  ];
}

/** Validates unknown input: schema first, then structural checks. */
export function validateCard(input: unknown): Violation[] {
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return schemaIssuesToViolations(parsed.error.issues);
  return validateCardRecord(parsed.data);
}

/** True when `input` is a legal DSL card. */
export function isValidCard(input: unknown): input is Card {
  return validateCard(input).length === 0;
}
