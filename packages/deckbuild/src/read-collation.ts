/**
 * The collation a staged set document carries, read as a sampler's input.
 *
 * `npm run reference:reduced` writes `reduction.collation` with the printing's
 * own sheets reweighted over the positions the translation kept, keyed by the
 * card ids the document prints, plus every booster configuration that still
 * fills. `@mtg/deckbuild`'s `openCollatedPool` deals from exactly that. This is
 * the seam between them.
 *
 * # Why this lives here rather than in `@mtg/ui`
 *
 * It was in `@mtg/ui`'s `lab/` until `mtg-rbw6`, when the Draftmancer exporter
 * needed the same read: a file cut from a printing has to be cut from the sheets
 * the lab deals, and `packages/draft-export` cannot import a browser package to
 * find out what they are. What this does is validate a document fragment against
 * a card list by opening a pack from it, and the pack opener is here. `@mtg/ui`
 * re-exports it under the names it always had.
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
 * `@mtg/deckbuild` does not depend on `@mtg/data` and must not start: that package's
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
 *
 * # What comes back is the pack that will be dealt, not the one that was printed
 *
 * `withoutBasicLands` runs first and the probe opens its result (`mtg-5of3`).
 * The basic-land slot is a fact about a 2010 booster and the document is right
 * to record it; a lab dealing a Swamp as one of fifteen picks is not. Every
 * caller of this reader is about to open a pack — the two play routes, the
 * Draftmancer exporter — so the transform belongs on this side of the seam
 * rather than repeated at each of them. What it cost comes back beside the
 * sheets, because a pack that holds fourteen where the document says fifteen
 * has to be said out loud rather than quietly dealt.
 */
import type { Card } from '@mtg/dsl';
import { openCollatedPool, withoutBasicLands } from './collation';
import type { BasicLandRemoval, CollationBooster, CollationSheet, PackCollation } from './collation';
import { SealedPoolError } from './sealed';

/**
 * What the staged document said about how its packs are collated.
 *
 * `none` is every ordinary generated set and is not a problem; `unusable` is a
 * document that meant to say something and could not be read, which is.
 */
export type StagedCollation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ready';
      /**
       * The sheets as they will be dealt, which is the printing's minus its
       * basic lands (`withoutBasicLands`, `mtg-5of3`). A caller opening a pack
       * wants what it holds, and every caller of this is opening one.
       */
      readonly collation: PackCollation;
      /** What taking the basics out cost, for the surface that says so. */
      readonly basicLands: BasicLandRemoval;
    }
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

/**
 * One sheet off a staged document.
 *
 * `foil` is passed through only when the document states a boolean, and a
 * document that states nothing yields a sheet with no key rather than one
 * claiming `false`. A pool dealt off unstated sheets reports its foil
 * provenance as unknown, which is the difference `provenance.ts` argues for: a
 * bundle staged before the flag was carried through never measured it.
 */
function readSheet(value: unknown): CollationSheet | null {
  const record = asObject(value);
  const name = record?.['name'];
  const weights = asWeights(record?.['weights']);
  if (typeof name !== 'string' || name.length === 0 || weights === null) return null;
  const foil = record?.['foil'];
  return { name, weights, ...(typeof foil === 'boolean' ? { foil } : {}) };
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
  const [dealable, basicLands] = withoutBasicLands(cards, collation);
  if (dealable.boosters.length === 0) {
    // Two ways to reach a collation that deals nothing, and the message has to
    // say which one happened. Taking the basics off can empty a sheet a slot
    // draws from and can leave a mixed sheet shallower than the slot drawing
    // off it; both are about the basics. A document whose sheets were already
    // too shallow for its own slots reaches the same dead end with no basic
    // involved at all, and `withoutBasicLands` names no sheet in that case,
    // which is what the two lists being empty says. Blaming the lands there
    // sends a reader looking for a land slot that was never on the document.
    const removedABasic = basicLands.droppedSheets.length > 0 || basicLands.thinnedSheets.length > 0;
    return {
      kind: 'unusable',
      message: removedABasic
        ? "None of this printing's booster configurations can still be dealt once its basic lands are " +
          'off, and packs here are not dealt with basic lands in them.'
        : "This printing's booster configurations each draw more cards off a sheet than the sheet " +
          `holds, so none of them can be dealt. ${REEMIT}.`,
    };
  }
  try {
    openCollatedPool(cards, dealable, { seed: 'collation/probe', boosters: 1 });
  } catch (cause: unknown) {
    if (cause instanceof SealedPoolError) return { kind: 'unusable', message: `${cause.message}.` };
    throw cause;
  }
  return { kind: 'ready', collation: dealable, basicLands };
}

/**
 * What the reduction did to the packs, as the producer wrote it down.
 *
 * A separate read from `readStagedCollation` above and deliberately so: that one
 * answers "can this document deal a pack", which is a yes-or-no a surface acts
 * on, and this one answers "what did the reduction cost the packs", which is
 * prose a person reads and cannot act on at all. Folding the second into the
 * first arm would make a document that still deals perfectly well carry a
 * message, and make a document that deals nothing carry two.
 *
 * Every field is the emitter's own (`@mtg/data`'s `PlayableCollationSchema`) and
 * nothing here recomputes one. `unfillableBoosters` is a count rather than the
 * configurations themselves, because a count is what the document holds: the
 * emitter keeps every configuration that still fills, whole, and records the
 * rest only as how many there were. So the page can say how many went and which
 * sheets emptied under them, and cannot name them one by one. That is a limit of
 * the document, not of this reader, and `mtg-ulf2` records it rather than
 * guessing the names back out of the sheets.
 */
export interface CollationReduction {
  /** Whether any configuration still fills. False is a set dealt by rarity instead. */
  readonly fillsAPack: boolean;
  /** Sheets the reduction emptied, by the printing's own name for them. */
  readonly emptiedSheets: readonly string[];
  /** How many booster configurations no longer fill. See the docblock. */
  readonly unfillableBoosters: number;
  /**
   * One sentence per slot that still fills and no longer deals what it dealt.
   *
   * The emitter's `detail`, not a sentence composed here: a finding is either a
   * repeat rate or a color the slot can no longer deal, both of them stated as
   * comparisons against the source printing, and a surface that rewrote them
   * would be a second opinion about numbers it never measured.
   */
  readonly slotFindings: readonly string[];
}

function asStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

/**
 * The reduction's effect on the packs, or `null` for a document that names none.
 *
 * `null` for every ordinary generated set, which carries no `reduction` block at
 * all, and for a reduced document whose collation says nothing went: a reduction
 * that emptied no sheet, dropped no configuration and changed no slot has
 * nothing to tell anybody, and a note saying so would be a note on every page.
 */
export function readCollationReduction(raw: unknown): CollationReduction | null {
  const record = asObject(asObject(asObject(raw)?.['reduction'])?.['collation']);
  if (record === null) return null;
  const findings = Array.isArray(record['slotFindings'])
    ? record['slotFindings'].flatMap((row: unknown) => {
        const detail = asObject(row)?.['detail'];
        return typeof detail === 'string' && detail.length > 0 ? [detail] : [];
      })
    : [];
  const emptiedSheets = asStrings(record['emptiedSheets']);
  const unfillable = record['unfillableBoosters'];
  const unfillableBoosters =
    typeof unfillable === 'number' && Number.isSafeInteger(unfillable) && unfillable > 0 ? unfillable : 0;
  const fillsAPack = record['fillsAPack'] === true;
  if (fillsAPack && emptiedSheets.length === 0 && unfillableBoosters === 0 && findings.length === 0)
    return null;
  return { fillsAPack, emptiedSheets, unfillableBoosters, slotFindings: findings };
}
