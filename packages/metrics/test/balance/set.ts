/**
 * Loading the set a balance run measures.
 *
 * The gate used to read one hard-coded path at module load, which made "the
 * balance gate" and "the Tideglass Reach fixture" the same sentence. They are
 * two things: the harness measures a card pool, and which pool it measures is
 * an input (`subjects.ts`). This module is the input side, and it is
 * deliberately the only place that turns a file into a pool, so a set named by
 * the subject list and a set named by `MTG_BALANCE_SET` are validated
 * identically.
 *
 * Validation is loud on purpose. A gate that measures an empty pool, or a file
 * that happens to be JSON but is not a set, reports bands over nothing. Every
 * rejection names the path.
 */
import { readFileSync } from 'node:fs';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';

export interface BalanceSet {
  /** Absolute path the pool was read from. */
  readonly path: string;
  /** The set's own code, e.g. `TGR`, or `unknown set` when the file omits one. */
  readonly code: string;
  readonly pool: readonly Card[];
  /** Provenance for the report header, e.g. `TGR Tideglass Reach (90 cards)`. */
  readonly label: string;
}

interface RawSet {
  readonly cards: unknown;
  readonly set?: { readonly code?: unknown; readonly name?: unknown };
}

/** Reads a DSL set file and parses every card in it, or throws naming the path. */
export function loadSet(path: string): BalanceSet {
  const raw = parseJson(path, readFile(path));
  if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
    throw new Error(`balance set ${path} has no "cards" array`);
  }
  const { cards, set } = raw as RawSet;
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`balance set ${path} has an empty "cards" array`);
  }
  const pool = cards.map((card, index) => {
    try {
      return parseCard(card);
    } catch (error: unknown) {
      throw new Error(`balance set ${path}: card ${index} is not a DSL card: ${messageOf(error)}`);
    }
  });
  const code = typeof set?.code === 'string' ? set.code : 'unknown set';
  const name = typeof set?.name === 'string' ? ` ${set.name}` : '';
  return { path, code, pool, label: `${code}${name} (${pool.length} cards)` };
}

function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new Error(`balance set ${path} could not be read: ${messageOf(error)}`);
  }
}

function parseJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(`balance set ${path} is not JSON: ${messageOf(error)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
