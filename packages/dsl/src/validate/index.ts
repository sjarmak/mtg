/**
 * The validation entry points.
 *
 * `validateCard` takes unknown input (LLM output, JSON on disk, a subprocess
 * response) and returns violations; it never throws for invalid data. Schema
 * failures short-circuit the structural pass because structural checks assume
 * a well-typed record.
 */
import type { Card } from '../card';
import { CardSchema } from '../card';
import { renderOracleText } from '../oracle';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { checkAbilities } from './abilities';
import { checkAura } from './aura';
import { checkColorIdentity, checkCostReduction, checkManaCost } from './cost';
import { checkEffects } from './effects';
import { checkFlavorText } from './flavor';
import { checkManaAbilities } from './mana-ability';
import { schemaIssuesToViolations } from './schema-issues';
import { checkCreatureStats, checkKeywords, checkSubtypes, checkSupertypes } from './typeline';

export { HAND_AUTHORED_TARGETS, LEGAL_TARGETS, legalScopesFor, legalTargetsFor } from './effects';
export { schemaIssuesToViolations } from './schema-issues';
export type { SchemaIssue } from './schema-issues';

/**
 * Structural checks over an already-parsed card. Every check is total and
 * side-effect free; the list is ordered so that the most actionable problems
 * (cost, color, type line) come first.
 */
export function validateCardRecord(card: Card): Violation[] {
  return [
    ...checkManaCost(card),
    ...checkColorIdentity(card),
    ...checkCostReduction(card),
    ...checkSupertypes(card),
    ...checkSubtypes(card),
    ...checkCreatureStats(card),
    ...checkKeywords(card),
    ...checkAura(card),
    ...checkEffects(card),
    ...checkAbilities(card),
    ...checkManaAbilities(card),
    ...checkOracleText(card),
    ...checkFlavorText(card),
  ];
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
