/**
 * The collation a staged set document carries, read as a sampler's input.
 *
 * `npm run reference:reduced` writes `reduction.collation` with the printing's
 * own sheets reweighted over the positions the translation kept, keyed by the
 * card ids the document prints, plus every booster configuration that still
 * fills. `@mtg/deckbuild`'s `openCollatedPool` deals from exactly that. This is
 * the seam between them.
 *
 * # Why this is not in `reduced-notice.ts`
 *
 * That file answers "what is missing from this set", and its answer is prose a
 * person reads. This one answers "what does a pack of this set hold", and its
 * answer is dealt. The two want opposite things from a block they cannot make
 * sense of: a notice that cannot be composed says nothing, which costs a
 * sentence, while a collation that cannot be dealt must not fall through to
 * silence — the pool would still be dealt, by rarity, and look exactly like the
 * one the printing describes. So this returns three states and the middle one is
 * a message the route prints above the pool it dealt instead.
 *
 * # Read structurally, for `reduced-notice.ts`'s reason
 *
 * `@mtg/ui` does not depend on `@mtg/data` and must not start: that package's
 * barrel reaches `better-sqlite3`, and this repository keeps native modules out
 * of anything Vite can reach. `@mtg/data` stays the home of the reduction — it
 * builds the block, rekeys the sheets off the printing's uuids and validates the
 * whole document against its schema — and nothing here recomputes any of it.
 * What happens here is a read and a check that the block describes *this* card
 * list, which is the one thing the producer cannot know: the document and the
 * card list reach the page as one file, but a stale `public/set.json` beside a
 * fresh anything is the failure this repository keeps meeting.
 *
 * # The check is the opener itself
 *
 * Rather than restate `openCollatedPool`'s rules — every id printed, every slot
 * shallower than its sheet, at least one configuration left — a pack is opened
 * and the refusal is kept. One implementation of those rules, and the message
 * the person reads is the message the sampler would have thrown.
 */
import type { Card } from '@mtg/dsl';
import { openCollatedPool, SealedPoolError } from '@mtg/deckbuild';
import type { CollationBooster, CollationSheet, PackCollation } from '@mtg/deckbuild';

/**
 * What the staged document said about how its packs are collated.
 *
 * `none` is every ordinary generated set and is not a problem; `unusable` is a
 * document that meant to say something and could not be read, which is.
 */
export type StagedCollation =
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly collation: PackCollation }
  | { readonly kind: 'unusable'; readonly message: string };

/** What a reader is told to run when the block is there and cannot be dealt. */
const REEMIT = 'Re-run `npm run reference:reduced` to write it again';

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asPositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A record of positive whole numbers, or `null` the moment one entry is not. */
function asWeights(value: unknown): Record<string, number> | null {
  const record = asObject(value);
  if (record === null) return null;
  const weights: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const weight = asPositive(entry);
    if (key.length === 0 || weight === null) return null;
    weights[key] = weight;
  }
  return Object.keys(weights).length === 0 ? null : weights;
}

function readSheet(value: unknown): CollationSheet | null {
  const record = asObject(value);
  const name = record?.['name'];
  const weights = asWeights(record?.['weights']);
  if (typeof name !== 'string' || name.length === 0 || weights === null) return null;
  return { name, weights };
}

function readBooster(value: unknown): CollationBooster | null {
  const record = asObject(value);
  const contents = asWeights(record?.['contents']);
  const weight = asPositive(record?.['weight']);
  if (contents === null || weight === null) return null;
  return { contents, weight };
}

/**
 * The collation on a staged set document, checked against the cards beside it.
 *
 * @param raw The parsed set document, exactly as it was fetched.
 * @param cards The same document's card list, already through `parseCard`. The
 *   sheets are checked against these rather than against the raw array, because
 *   a sheet naming a card the DSL refused is a sheet that cannot be dealt.
 */
export function readStagedCollation(raw: unknown, cards: readonly Card[]): StagedCollation {
  const block = asObject(asObject(raw)?.['reduction'])?.['collation'];
  const record = asObject(block);
  if (record === null) return { kind: 'none' };
  const sheetRows = record['sheets'];
  const boosterRows = record['boosters'];
  if (!Array.isArray(sheetRows) || !Array.isArray(boosterRows)) {
    return {
      kind: 'unusable',
      message: `This set's collation names no sheets or no booster configurations. ${REEMIT}.`,
    };
  }
  const sheets = sheetRows.map(readSheet);
  const boosters = boosterRows.map(readBooster);
  if (sheets.some((sheet) => sheet === null) || boosters.some((booster) => booster === null)) {
    return {
      kind: 'unusable',
      message: `This set's collation has a sheet or a configuration this lab cannot read. ${REEMIT}.`,
    };
  }
  const collation: PackCollation = {
    sheets: sheets.filter((sheet): sheet is CollationSheet => sheet !== null),
    boosters: boosters.filter((booster): booster is CollationBooster => booster !== null),
  };
  try {
    openCollatedPool(cards, collation, { seed: 'collation/probe', boosters: 1 });
  } catch (cause: unknown) {
    if (cause instanceof SealedPoolError) return { kind: 'unusable', message: `${cause.message}.` };
    throw cause;
  }
  return { kind: 'ready', collation };
}
