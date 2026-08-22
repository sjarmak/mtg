/**
 * Deterministic conformance measurement for any decklist, from either builder.
 *
 * This is the objective half of the comparison and the part that does not
 * require anyone's opinion. Whether a card exists, is legal in the format, sits
 * inside the stated colors, respects the copy limit, and clears the budget are
 * all facts, and they are checked here against the store the same way for the
 * baseline and for the informed build. A judge is only worth consulting once
 * both decks are known to be real.
 *
 * It queries the store directly rather than reusing the candidate universe,
 * because a decklist includes basic lands and the universe deliberately does
 * not. Auditing against the universe would score every baseline deck as playing
 * twenty-four illegal Mountains.
 */
import type { DataStore } from '@mtg/data';
import { EXCLUDED_LAYOUTS, normalizeName } from './candidates';
import type { DeckCriteria } from './criteria';

export interface DeckEntry {
  readonly name: string;
  readonly count: number;
}

export type ViolationKind =
  | 'unknown-card'
  | 'illegal-in-format'
  | 'off-colour'
  | 'over-card-budget'
  | 'over-mana-value'
  | 'too-many-copies';

export interface Violation {
  readonly name: string;
  readonly kind: ViolationKind;
  readonly detail: string;
}

export interface DeckAudit {
  readonly totalCards: number;
  readonly distinctCards: number;
  readonly deckPriceUsd: number;
  /** Cards the store has no USD price for; they make the total a lower bound. */
  readonly unpricedCards: number;
  readonly violations: readonly Violation[];
  /** Cards counted with multiplicity that broke at least one rule. */
  readonly offendingCards: number;
  readonly sizeDelta: number;
  readonly overDeckBudget: boolean;
  /** True when nothing at all is wrong: a deck you could legally register. */
  readonly clean: boolean;
}

interface AuditRow {
  name: string;
  color_identity: string;
  mana_value: number;
  type_line: string;
  oracle_text: string | null;
  legal: string | null;
  price_usd: number | null;
}

const SINGLETON_FORMATS: ReadonlySet<string> = new Set(['commander', 'brawl', 'oathbreaker', 'duel']);

/**
 * Audits a decklist against the store and the stated criteria.
 *
 * Basic lands are exempt from the copy limit and from the color check: a
 * mono-red deck's Mountains are not an off-colour violation, and you may play
 * more than four.
 */
export function auditDeck(
  store: DataStore,
  entries: readonly DeckEntry[],
  criteria: DeckCriteria,
): DeckAudit {
  // Non-deck layouts are excluded, and this is load-bearing rather than tidy.
  // The store holds a `token` row named exactly "Ornithopter" and an
  // `art_series` row named "Delver of Secrets // Delver of Secrets", both
  // marked not_legal in every format. Selecting either instead of the real card
  // scores a perfectly legal deck as illegal. That is not hypothetical: it
  // inflated the baseline's violation count in the first full run of this
  // comparison, which is the failure mode an evaluation harness can least
  // afford, since it flatters the thing being tested.
  const layoutFilter = EXCLUDED_LAYOUTS.map(() => '?').join(',');
  const columns = `c.name, c.color_identity, c.mana_value, c.type_line, c.oracle_text,
           json_extract(c.legalities, '$.' || ?) AS legal,
           (SELECT MIN(CAST(json_extract(p.raw_json, '$.prices.usd') AS REAL))
            FROM printing p
            WHERE p.oracle_id = c.oracle_id AND p.digital = 0
              AND json_extract(p.raw_json, '$.prices.usd') IS NOT NULL) AS price_usd`;

  const lookup = store.db.prepare(`
    SELECT ${columns}
    FROM oracle_card c
    WHERE c.source = 'scryfall' AND c.name = ? AND c.layout NOT IN (${layoutFilter})
    ORDER BY CASE WHEN json_extract(c.legalities, '$.' || ?) = 'legal' THEN 0 ELSE 1 END
    LIMIT 1
  `);

  // Names are matched exactly first, then by front face, so punctuation drift
  // and double-faced names are not scored as hallucinations.
  const byNormalized = store.db.prepare(`
    SELECT ${columns}
    FROM oracle_card c
    WHERE c.source = 'scryfall' AND c.name LIKE ? AND c.layout NOT IN (${layoutFilter})
    ORDER BY CASE WHEN json_extract(c.legalities, '$.' || ?) = 'legal' THEN 0 ELSE 1 END
    LIMIT 1
  `);

  const violations: Violation[] = [];
  let totalCards = 0;
  let deckPrice = 0;
  let unpriced = 0;
  let offending = 0;

  for (const entry of entries) {
    totalCards += entry.count;
    const row = resolveRow(entry.name, criteria.format, lookup, byNormalized);

    if (row === undefined) {
      violations.push({
        name: entry.name,
        kind: 'unknown-card',
        detail: `${entry.name} is not a card in the store`,
      });
      offending += entry.count;
      continue;
    }

    const basic = row.type_line.startsWith('Basic Land');
    const entryViolations: Violation[] = [];

    if (row.legal !== 'legal') {
      entryViolations.push({
        name: row.name,
        kind: 'illegal-in-format',
        detail: `${row.name} is ${row.legal ?? 'unlisted'} in ${criteria.format}`,
      });
    }

    if (!basic && criteria.colors.length > 0) {
      const outside = [...row.color_identity].filter(
        (letter) => !criteria.colors.includes(letter as (typeof criteria.colors)[number]),
      );
      if (outside.length > 0) {
        entryViolations.push({
          name: row.name,
          kind: 'off-colour',
          detail: `${row.name} has identity {${row.color_identity}}, outside {${criteria.colors.join('')}}`,
        });
      }
    }

    if (criteria.maxManaValue !== undefined && row.mana_value > criteria.maxManaValue) {
      entryViolations.push({
        name: row.name,
        kind: 'over-mana-value',
        detail: `${row.name} costs ${row.mana_value}, above the stated ${criteria.maxManaValue}`,
      });
    }

    const maxCardUsd = criteria.budget?.maxCardUsd;
    if (maxCardUsd !== undefined && row.price_usd !== null && row.price_usd > maxCardUsd) {
      entryViolations.push({
        name: row.name,
        kind: 'over-card-budget',
        detail: `${row.name} costs $${row.price_usd.toFixed(2)}, above the stated $${maxCardUsd}`,
      });
    }

    const limit = copyLimitFor(row, criteria);
    if (entry.count > limit) {
      entryViolations.push({
        name: row.name,
        kind: 'too-many-copies',
        detail: `${entry.count}x ${row.name} exceeds the limit of ${limit}`,
      });
    }

    if (row.price_usd === null) unpriced += entry.count;
    else deckPrice += row.price_usd * entry.count;

    if (entryViolations.length > 0) offending += entry.count;
    violations.push(...entryViolations);
  }

  const maxDeckUsd = criteria.budget?.maxDeckUsd;
  const overDeckBudget = maxDeckUsd !== undefined && deckPrice > maxDeckUsd;

  return {
    totalCards,
    distinctCards: entries.length,
    deckPriceUsd: deckPrice,
    unpricedCards: unpriced,
    violations,
    offendingCards: offending,
    sizeDelta: totalCards - criteria.size,
    overDeckBudget,
    clean: violations.length === 0 && totalCards === criteria.size && !overDeckBudget,
  };
}

function resolveRow(
  name: string,
  format: string,
  exact: { get: (...params: unknown[]) => unknown },
  fuzzy: { get: (...params: unknown[]) => unknown },
): AuditRow | undefined {
  const direct = exact.get(format, name, ...EXCLUDED_LAYOUTS, format) as AuditRow | undefined;
  if (direct !== undefined) return direct;

  // A front-face name matches the stored `A // B` via prefix.
  const normalized = normalizeName(name);
  if (normalized === '') return undefined;
  const prefixed = fuzzy.get(format, `${name}%`, ...EXCLUDED_LAYOUTS, format) as AuditRow | undefined;
  if (prefixed !== undefined && normalizeName(prefixed.name) === normalized) return prefixed;
  return undefined;
}

function copyLimitFor(row: AuditRow, criteria: DeckCriteria): number {
  if (row.type_line.startsWith('Basic Land')) return criteria.size;
  if ((row.oracle_text ?? '').includes('any number of cards named')) return criteria.size;
  if (SINGLETON_FORMATS.has(criteria.format)) return 1;
  return criteria.maxCopies;
}
