/**
 * The deterministic half of the ZFC split: the set of cards the criteria allow.
 *
 * Everything decided here is a fact about a row — is it legal in the format, is
 * its color identity inside the deck's, does it cost too much mana, does it
 * cost too many dollars. No judgment about whether a card is *good*, or
 * whether it fits an archetype, happens in this file; that is the model's job
 * in `select.ts`. A keyword scan here would be exactly the heuristic
 * meaning-detection the project's ZFC rule forbids.
 *
 * ## Why this is a universe and not a shortlist
 *
 * The obvious design hands the model a candidate pool and asks it to pick. It
 * does not survive contact with the store: measured against the real database,
 * "modern, Boros, mana value ≤ 3" is 5,581 cards, pauper is 10,787, and modern
 * under a dollar is 19,022. Nothing that size fits in a prompt, and any cap
 * imposed to make it fit is a ranking — which is a quality judgment, made in
 * code, over exactly the cards the model was supposed to be judging. Ordering
 * by name and taking the first 400 is worse still: it silently returns a deck
 * built entirely from the letter A.
 *
 * So the flow is inverted. Code computes the legal universe and keeps it as a
 * *validation set*; the model proposes cards by name from what it knows; code
 * then checks each proposal against the universe and rejects anything illegal,
 * off-color, over budget, or simply not a real card. The model never sees the
 * universe, so pool size stops being a context problem, and a hallucinated card
 * cannot reach the deck because it is not in the store.
 */
import type { DataStore } from '@mtg/data';
import type { Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { DeckCriteria } from './criteria';
import { parseManaCost, type ParsedManaCost } from './mana-cost';

/**
 * Layouts that are not a card you can put in a deck. Filtering these is
 * structural: a token or an emblem has no legality of its own and would
 * otherwise survive the legality filter.
 */
export const EXCLUDED_LAYOUTS: readonly string[] = [
  'token',
  'double_faced_token',
  'emblem',
  'art_series',
  'scheme',
  'planar',
  'vanguard',
  'augment',
  'host',
];

export interface CandidateCard {
  readonly oracleId: string;
  readonly name: string;
  readonly manaCost: string | null;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly oracleText: string | null;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly colorIdentity: string;
  readonly keywords: readonly string[];
  /** Cheapest non-digital USD printing; `null` when the store has no price. */
  readonly priceUsd: number | null;
  readonly parsedCost: ParsedManaCost;
  /**
   * Colors this card can tap for, from Scryfall's `produced_mana`, restricted
   * to WUBRG. This is a structured field on the row, not something read out of
   * the oracle text, so using it is IO rather than the meaning-detection the
   * ZFC rule forbids. It is what lets a dual land count as two sources in the
   * mana base instead of as a blank.
   */
  readonly producedMana: readonly Color[];
}

export interface CandidateUniverse {
  readonly cards: readonly CandidateCard[];
  /** Lookup by normalized name, for validating a proposal. */
  readonly byName: ReadonlyMap<string, CandidateCard>;
  /** The structural filters actually applied, for the report. */
  readonly filters: readonly string[];
}

interface RawCandidate {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  oracle_text: string | null;
  power: string | null;
  toughness: string | null;
  color_identity: string;
  keywords: string;
  price_usd: number | null;
  produced_mana: string | null;
}

/**
 * Card names are matched case- and punctuation-insensitively, and only on the
 * front face. A model that proposes "Jace, Vryn's Prodigy" when the store holds
 * "Jace, Vryn's Prodigy // Jace, Telepath Unbound" is right about the card, and
 * failing it on the `//` would be a parser failure dressed up as a rules one.
 */
export function normalizeName(name: string): string {
  const front = name.split('//')[0] ?? name;
  return front
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * `['W','U']` → a GLOB matching any identity containing a color *outside* the
 * deck. Used negated, which is how "subset of" is expressed in SQLite without
 * a recursive character walk.
 *
 * Assembled only from the five validated WUBRG letters, then bound as a
 * parameter — no user text reaches SQL.
 */
export function outsideColorsGlob(colors: readonly Color[]): string | null {
  const outside = COLORS.filter((color) => !colors.includes(color));
  if (outside.length === 0) return null;
  return `*[${outside.join('')}]*`;
}

/**
 * Builds the legal universe for these criteria.
 *
 * Basic lands are excluded: the mana base is computed, not chosen, so a basic
 * in the universe would let the model spend a spell slot on a Mountain.
 */
export function selectUniverse(store: DataStore, criteria: DeckCriteria): CandidateUniverse {
  const filters: string[] = [`legal in ${criteria.format}`];
  const where: string[] = [
    "c.source = 'scryfall'",
    `c.layout NOT IN (${EXCLUDED_LAYOUTS.map(() => '?').join(',')})`,
    "c.type_line NOT LIKE 'Basic Land%'",
    "json_extract(c.legalities, '$.' || ?) = 'legal'",
  ];
  const params: unknown[] = [...EXCLUDED_LAYOUTS, criteria.format];

  const glob = outsideColorsGlob(criteria.colors);
  if (criteria.colors.length > 0 && glob !== null) {
    where.push('c.color_identity NOT GLOB ?');
    params.push(glob);
    filters.push(`color identity within {${criteria.colors.join('')}}`);
  }

  if (criteria.maxManaValue !== undefined) {
    where.push('c.mana_value <= ?');
    params.push(criteria.maxManaValue);
    filters.push(`mana value <= ${criteria.maxManaValue}`);
  }

  // A card's price is the cheapest non-digital printing it has, computed in SQL
  // so the budget filter and the reported price can never disagree.
  const priceExpr = `(
    SELECT MIN(CAST(json_extract(p.raw_json, '$.prices.usd') AS REAL))
    FROM printing p
    WHERE p.oracle_id = c.oracle_id
      AND p.digital = 0
      AND json_extract(p.raw_json, '$.prices.usd') IS NOT NULL
  )`;

  const budget = criteria.budget;
  const priceGuards: string[] = [];
  if (budget !== undefined) {
    if (budget.maxCardUsd !== undefined) {
      priceGuards.push('price_usd IS NOT NULL AND price_usd <= ?');
      params.push(budget.maxCardUsd);
      filters.push(`no card over $${budget.maxCardUsd}`);
    } else if (!budget.allowUnpriced) {
      priceGuards.push('price_usd IS NOT NULL');
      filters.push('priced cards only');
    }
  }

  const sql = `
    SELECT * FROM (
      SELECT c.oracle_id, c.name, c.mana_cost, c.mana_value, c.type_line, c.oracle_text,
             c.power, c.toughness, c.color_identity, c.keywords,
             json_extract(c.raw_json, '$.produced_mana') AS produced_mana,
             ${priceExpr} AS price_usd
      FROM oracle_card c
      WHERE ${where.join(' AND ')}
    )
    ${priceGuards.length > 0 ? `WHERE ${priceGuards.join(' AND ')}` : ''}
    ORDER BY name
  `;

  const rows = store.db.prepare(sql).all(...(params as never[])) as RawCandidate[];
  const cards = rows.map(toCandidate);

  const byName = new Map<string, CandidateCard>();
  for (const card of cards) {
    const key = normalizeName(card.name);
    // First printing wins; the list is name-ordered, so this is deterministic.
    if (!byName.has(key)) byName.set(key, card);
  }

  return { cards, byName, filters };
}

function toCandidate(row: RawCandidate): CandidateCard {
  return {
    oracleId: row.oracle_id,
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: row.mana_value,
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    power: row.power,
    toughness: row.toughness,
    colorIdentity: row.color_identity,
    keywords: parseKeywords(row.keywords),
    priceUsd: row.price_usd,
    parsedCost: parseManaCost(row.mana_cost),
    producedMana: parseProducedMana(row.produced_mana),
  };
}

function parseKeywords(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Scryfall's `produced_mana`, narrowed to WUBRG. Colorless `C` and snow `S`
 * are dropped because the mana base only apportions colored sources; a land
 * that taps for `C` alone is a real land with no color to report.
 */
function parseProducedMana(value: string | null): readonly Color[] {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return COLORS.filter((color) => parsed.includes(color));
}

/**
 * Every real card name in the store, normalized.
 *
 * This exists to tell two very different failures apart. A proposal missing
 * from the universe is either a card that does not exist — the model invented
 * it — or a real card the criteria exclude. The first means "stop making cards
 * up"; the second means "that one is illegal here, pick another". Feeding back
 * the wrong message trains the next round in the wrong direction.
 */
export function loadKnownNames(store: DataStore): ReadonlySet<string> {
  const rows = store.db.prepare('SELECT name FROM oracle_card').all() as { name: string }[];
  return new Set(rows.map((row) => normalizeName(row.name)));
}

export function isLandCard(card: CandidateCard): boolean {
  return card.typeLine.includes('Land');
}

export function isCreatureCard(card: CandidateCard): boolean {
  return card.typeLine.includes('Creature');
}
