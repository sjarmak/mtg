/**
 * The strict door into the DSL: parse + full structural validation, or fail
 * with the violation list attached. Round-tripping is lossless — every field
 * the schema keeps is emitted by `serializeCard` and restored by `parseCard`.
 */
import type { Card } from './card';
import { CardSchema } from './card';
import { canonicalJson } from './canonical-json';
import type { Violation } from './violations';
import { formatViolations } from './violations';
import { validateCardRecord } from './validate/index';
import { schemaIssuesToViolations } from './validate/schema-issues';

export class CardValidationError extends Error {
  readonly violations: readonly Violation[];

  constructor(violations: readonly Violation[], context: string) {
    super(`${context}: ${formatViolations(violations)}`);
    this.name = 'CardValidationError';
    this.violations = violations;
  }
}

export type SafeParseResult =
  | { readonly ok: true; readonly card: Card }
  | { readonly ok: false; readonly violations: readonly Violation[] };

/** Never throws. Returns the parsed card or every violation found. */
export function safeParseCard(input: unknown): SafeParseResult {
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, violations: schemaIssuesToViolations(parsed.error.issues) };
  const violations = validateCardRecord(parsed.data);
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, card: parsed.data };
}

/** Throws `CardValidationError` when the input is not a legal DSL card. */
export function parseCard(input: unknown): Card {
  const result = safeParseCard(input);
  if (!result.ok) throw new CardValidationError(result.violations, 'invalid card');
  return result.card;
}

/** Parses a list, reporting the index of the first illegal card. */
export function parseCards(inputs: readonly unknown[]): Card[] {
  return inputs.map((input, index) => {
    const result = safeParseCard(input);
    if (!result.ok) throw new CardValidationError(result.violations, `invalid card at index ${index}`);
    return result.card;
  });
}

/** Canonical JSON for one card: key-sorted, so serialization is byte-stable. */
export function serializeCard(card: Card): string {
  return canonicalJson(card);
}

/** Canonical JSON for a card list. */
export function serializeCards(cards: readonly Card[]): string {
  return canonicalJson(cards);
}

/** Parses canonical JSON text back into a validated card. */
export function parseCardJson(text: string): Card {
  return parseCard(JSON.parse(text) as unknown);
}

/** Parses canonical JSON text back into a validated card list. */
export function parseCardsJson(text: string): Card[] {
  const decoded: unknown = JSON.parse(text);
  if (!Array.isArray(decoded)) {
    throw new CardValidationError(
      [{ code: 'SCHEMA_INVALID', message: 'expected a JSON array of cards', path: '' }],
      'invalid card list',
    );
  }
  return parseCards(decoded);
}

/**
 * Parses a card list *as a file on disk spells it*, which is two spellings, not
 * one: a bare JSON array — what `serializeCards` writes and `parseCardsJson`
 * above reads — or a set document, `{ formatVersion, set, cards }`, which is
 * what `@mtg/setgen` writes to every `set.json` and what the card renderer, the
 * art verifier and the `npm run play` launcher all read.
 *
 * The two spellings are why this exists. Twenty-seven files across the
 * workspace had each decided for itself whether a decoded document was an array
 * or something with a `cards` field in it, and the two export commands had
 * decided it was always an array, so `draft-export` and `forge-export` exited 1
 * on the 249-card flagship every other tool opened without comment. `@mtg/dsl`
 * is the one package all twenty-seven already depend on, so the decision lives
 * here once.
 *
 * Widening stops there. A document with no `cards` field, or a `cards` field
 * that is not an array, still fails — and says which of the two it was, because
 * "expected a JSON array of cards" in front of a file that plainly contains
 * cards is the message that cost the hour.
 */
export function parseCardsDocumentJson(text: string): Card[] {
  const decoded: unknown = JSON.parse(text);
  if (Array.isArray(decoded)) return parseCards(decoded);
  if (typeof decoded === 'object' && decoded !== null && 'cards' in decoded) {
    const { cards } = decoded as { cards: unknown };
    if (!Array.isArray(cards)) {
      throw new CardValidationError(
        [{ code: 'SCHEMA_INVALID', message: `"cards" is ${typeof cards}, not an array`, path: 'cards' }],
        'invalid set document',
      );
    }
    return parseCards(cards);
  }
  throw new CardValidationError(
    [
      {
        code: 'SCHEMA_INVALID',
        message: 'expected a JSON array of cards, or a set document with a "cards" array',
        path: '',
      },
    ],
    'invalid card list',
  );
}
