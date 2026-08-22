/**
 * The query surface the rest of the lab uses: by name, by oracle id, by set,
 * by color identity, plus printings, rulings and store statistics.
 *
 * Every statement is parameterized. The one place a value reaches SQL as text
 * is the color-identity GLOB pattern, and it is assembled exclusively from the
 * five validated WUBRG letters before being *bound* as a parameter.
 */
import type { Source } from '../config';
import { InvalidInputError } from '../errors';
import type { DataStore } from '../store/store';
import {
  toCardRow,
  toPrintingRow,
  toRulingRow,
  type CardRow,
  type PrintingRow,
  type RawCardRow,
  type RawPrintingRow,
  type RawRulingRow,
  type RulingRow,
} from './rows';

const COLOR_LETTERS = ['W', 'U', 'B', 'R', 'G'] as const;
type ColorLetter = (typeof COLOR_LETTERS)[number];
const COLOR_ORDER: Readonly<Record<ColorLetter, number>> = { W: 0, U: 1, B: 2, R: 3, G: 4 };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 5_000;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new InvalidInputError('limit', `expected a positive integer, got ${String(limit)}`);
  }
  return Math.min(limit, MAX_LIMIT);
}

/** `'wu'`, `'WU'`, `['U','W']` → `'WU'`. Throws on anything that is not WUBRG. */
export function normalizeColorIdentity(colors: string | readonly string[]): string {
  const letters = (typeof colors === 'string' ? [...colors] : [...colors]).flatMap((entry) => [...entry]);
  const seen = new Set<ColorLetter>();
  for (const letter of letters) {
    const upper = letter.toUpperCase();
    if (upper.trim().length === 0) continue;
    if (!isColorLetter(upper)) {
      throw new InvalidInputError('color identity', `"${letter}" is not one of W, U, B, R, G`);
    }
    seen.add(upper);
  }
  return [...seen].sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]).join('');
}

function isColorLetter(value: string): value is ColorLetter {
  return (COLOR_LETTERS as readonly string[]).includes(value);
}

export interface CardQueryOptions {
  readonly limit?: number;
  readonly source?: Source;
}

const CARD_COLUMN_NAMES: readonly string[] = [
  'oracle_id',
  'source',
  'name',
  'mana_cost',
  'mana_value',
  'type_line',
  'oracle_text',
  'power',
  'toughness',
  'loyalty',
  'colors',
  'color_identity',
  'layout',
  'keywords',
  'legalities',
  'reserved',
  'raw_json',
  'bulk_updated_at',
  'ingested_at',
];
const CARD_COLUMNS = CARD_COLUMN_NAMES.join(', ');
const CARD_COLUMNS_QUALIFIED = CARD_COLUMN_NAMES.map((column) => `c.${column}`).join(', ');

export function getCardByOracleId(store: DataStore, oracleId: string): CardRow | null {
  const row = store.db
    .prepare<[string], RawCardRow>(`SELECT ${CARD_COLUMNS} FROM oracle_card WHERE oracle_id = ?`)
    .get(oracleId);
  return row === undefined ? null : toCardRow(row);
}

export interface NameQueryOptions extends CardQueryOptions {
  /** Exact (case-insensitive) match instead of the default substring search. */
  readonly exact?: boolean;
}

export function findCardsByName(store: DataStore, name: string, options: NameQueryOptions = {}): CardRow[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new InvalidInputError('card name', 'must not be empty');
  const limit = clampLimit(options.limit);
  const sourceClause = options.source === undefined ? '' : ' AND source = ?';

  if (options.exact === true) {
    const sql = `SELECT ${CARD_COLUMNS} FROM oracle_card WHERE name = ? COLLATE NOCASE${sourceClause}
                 ORDER BY name LIMIT ?`;
    const params = options.source === undefined ? [trimmed, limit] : [trimmed, options.source, limit];
    return store.db
      .prepare<unknown[], RawCardRow>(sql)
      .all(...params)
      .map(toCardRow);
  }

  const pattern = `%${escapeLike(trimmed)}%`;
  const sql = `SELECT ${CARD_COLUMNS} FROM oracle_card
               WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE${sourceClause}
               ORDER BY LENGTH(name), name LIMIT ?`;
  const params = options.source === undefined ? [pattern, limit] : [pattern, options.source, limit];
  return store.db
    .prepare<unknown[], RawCardRow>(sql)
    .all(...params)
    .map(toCardRow);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Candidates handed back when a reference is ambiguous; the rest are counted, not listed. */
export const CARD_CANDIDATE_LIMIT = 10;

export type CardRefResolution =
  | { readonly kind: 'card'; readonly card: CardRow }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly CardRow[]; readonly truncated: boolean };

/**
 * Resolves whatever a human (or a script) typed — an oracle id or a card name —
 * to a single card, in that order: oracle id, then exact name, then substring.
 *
 * The oracle id is tried first rather than sniffed for a UUID shape because lab
 * cards carry slug ids (`slc-ember-lash`), which no UUID test would recognize.
 * Exact matches are a subset of substring matches, so falling through only on
 * an empty exact result can never hide a better answer.
 */
export function resolveCardRef(store: DataStore, ref: string): CardRefResolution {
  const trimmed = ref.trim();
  if (trimmed.length === 0) throw new InvalidInputError('card reference', 'must not be empty');

  const byOracleId = getCardByOracleId(store, trimmed);
  if (byOracleId !== null) return { kind: 'card', card: byOracleId };

  // One over the display limit, so `truncated` is exact rather than a guess.
  const limit = CARD_CANDIDATE_LIMIT + 1;
  const exact = findCardsByName(store, trimmed, { exact: true, limit });
  const matches = exact.length > 0 ? exact : findCardsByName(store, trimmed, { limit });

  const only = matches[0];
  if (only === undefined) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'card', card: only };
  return {
    kind: 'ambiguous',
    candidates: matches.slice(0, CARD_CANDIDATE_LIMIT),
    truncated: matches.length > CARD_CANDIDATE_LIMIT,
  };
}

/** Cards with at least one printing in `setCode`, ordered by collector number. */
export function findCardsBySet(store: DataStore, setCode: string, options: CardQueryOptions = {}): CardRow[] {
  const code = setCode.trim().toUpperCase();
  if (code.length === 0) throw new InvalidInputError('set code', 'must not be empty');
  const limit = clampLimit(options.limit);
  const sourceClause = options.source === undefined ? '' : ' AND c.source = ?';
  const sql = `SELECT DISTINCT ${CARD_COLUMNS_QUALIFIED}
               FROM oracle_card c
               JOIN printing p ON p.oracle_id = c.oracle_id
               WHERE p.set_code = ?${sourceClause}
               ORDER BY c.name LIMIT ?`;
  const params = options.source === undefined ? [code, limit] : [code, options.source, limit];
  return store.db
    .prepare<unknown[], RawCardRow>(sql)
    .all(...params)
    .map(toCardRow);
}

export type ColorMatchMode =
  /** Color identity is exactly the given set. */
  | 'exact'
  /** Color identity is a subset of the given set — the Commander sense. */
  | 'subset'
  /** Color identity contains every given color, and possibly more. */
  | 'includes';

export interface ColorQueryOptions extends CardQueryOptions {
  readonly mode?: ColorMatchMode;
}

export function findCardsByColorIdentity(
  store: DataStore,
  colors: string | readonly string[],
  options: ColorQueryOptions = {},
): CardRow[] {
  const identity = normalizeColorIdentity(colors);
  const mode: ColorMatchMode = options.mode ?? 'exact';
  const limit = clampLimit(options.limit);
  const sourceClause = options.source === undefined ? '' : ' AND source = ?';
  const params: unknown[] = [];
  let where: string;

  switch (mode) {
    case 'exact': {
      where = 'color_identity = ?';
      params.push(identity);
      break;
    }
    case 'subset': {
      const excluded = COLOR_LETTERS.filter((letter) => !identity.includes(letter));
      if (excluded.length === 0) {
        where = '1 = 1';
      } else {
        // GLOB character class built solely from validated WUBRG letters, bound
        // as a parameter rather than interpolated.
        where = 'color_identity NOT GLOB ?';
        params.push(`*[${excluded.join('')}]*`);
      }
      break;
    }
    case 'includes': {
      if (identity.length === 0) {
        where = '1 = 1';
      } else {
        where = [...identity].map(() => 'color_identity LIKE ?').join(' AND ');
        for (const letter of identity) params.push(`%${letter}%`);
      }
      break;
    }
  }

  if (options.source !== undefined) params.push(options.source);
  params.push(limit);

  const sql = `SELECT ${CARD_COLUMNS} FROM oracle_card
               WHERE ${where}${sourceClause}
               ORDER BY mana_value, name LIMIT ?`;
  return store.db
    .prepare<unknown[], RawCardRow>(sql)
    .all(...params)
    .map(toCardRow);
}

export function getPrintings(store: DataStore, oracleId: string): PrintingRow[] {
  return store.db
    .prepare<[string], RawPrintingRow>(
      `SELECT * FROM printing WHERE oracle_id = ? ORDER BY released_at, set_code, collector_number`,
    )
    .all(oracleId)
    .map(toPrintingRow);
}

export function getRulings(store: DataStore, oracleId: string): RulingRow[] {
  return store.db
    .prepare<[string], RawRulingRow>(
      `SELECT * FROM ruling WHERE oracle_id = ? ORDER BY published_at DESC, ruling_id`,
    )
    .all(oracleId)
    .map(toRulingRow);
}

export interface StoreStats {
  readonly oracleCards: number;
  readonly labCards: number;
  readonly printings: number;
  readonly rulings: number;
  readonly sets: number;
  readonly rejects: number;
}

export function storeStats(store: DataStore): StoreStats {
  const scalar = (sql: string): number => store.db.prepare<[], { n: number }>(sql).get()?.n ?? 0;
  return {
    oracleCards: scalar(`SELECT COUNT(*) AS n FROM oracle_card`),
    labCards: scalar(`SELECT COUNT(*) AS n FROM oracle_card WHERE source = 'lab'`),
    printings: scalar(`SELECT COUNT(*) AS n FROM printing`),
    rulings: scalar(`SELECT COUNT(*) AS n FROM ruling`),
    sets: scalar(`SELECT COUNT(DISTINCT set_code) AS n FROM printing`),
    rejects: scalar(`SELECT COUNT(*) AS n FROM ingest_reject`),
  };
}
