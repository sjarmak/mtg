/**
 * The compile step: a DSL set becomes one Draftmancer custom-set file.
 *
 * The file is the format described in `docs/research/prior-art-tooling.md`
 * §1.1: a `[CustomCards]` JSON array, a `[Settings]` object carrying the pack
 * layouts, then one section per sheet listing its cards by name, one per line.
 * Sheet sections carry no collation token, which selects the format's
 * documented default of `random`.
 *
 * The sheets are the set's rarities, unless the caller hands over the sheets the
 * printing was really collated on: `printing.ts` compiles those instead, and
 * `mtg-rbw6` is why it has to be possible. A reduced reference set carries them,
 * the lab deals from them on both tabs, and a file that still cut nine commons
 * and a rare out of the same set was a file that differs from its own lab
 * without saying so.
 *
 * Two properties are load-bearing and both are tested. The output is a pure
 * function of the set and the recipe, sorted before anything is written, so the
 * same set compiles to the same bytes whatever order it arrives in — a draft is
 * reproducible only if the file it was drafted from is. And a card is emitted
 * exactly once, in `[CustomCards]` and in one sheet, because Draftmancer keys
 * custom cards by name and a second entry of the same name would silently
 * replace the first.
 */
import type { BoosterRecipe, CardScoreWeights, PackCollation } from '@mtg/deckbuild';
import { boosterPool, boosterRecipeFor } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import type { CollationReport, DraftmancerLayouts, DraftmancerSheet } from './collation';
import { buildLayouts, buildSheets, collationReport } from './collation';
import type { DraftmancerCustomCard } from './custom-cards';
import { toCustomCards } from './custom-cards';
import type { PrintedSheet } from './printing';
import { printedCards, printedLayouts, printedSheets, printingNotes } from './printing';
import { rateCards } from './rating';
import { DRAFTMANCER_SIMPLE_BOT_POLICY } from './native-draft-bot';

export class DraftExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftExportError';
  }
}

export interface DraftExportOptions {
  /** The pack this set is drafted from. Defaults to the recipe derived from the set. */
  readonly recipe?: BoosterRecipe;
  /**
   * The printing's own sheets, when the set carries them. They replace the
   * rarity sheets outright rather than joining them, because they are the same
   * answer to the same question and the printing's is the true one. Passing both
   * this and a recipe is refused.
   */
  readonly collation?: PackCollation;
  /** Scoring weights behind the ratings. Defaults to the deck builder's. */
  readonly weights?: CardScoreWeights;
}

export interface DraftmancerExport {
  /** Static policy Draftmancer applies to generated custom-card ratings. */
  readonly botPolicy: typeof DRAFTMANCER_SIMPLE_BOT_POLICY;
  readonly text: string;
  readonly customCards: readonly DraftmancerCustomCard[];
  readonly sheets: readonly DraftmancerSheet[];
  readonly layouts: DraftmancerLayouts;
  /** Ways this set and this recipe would not draft as written. */
  readonly report: CollationReport;
  /**
   * The printing's sheets when they are what was compiled, `null` when the file
   * was cut by DSL rarity. A caller comparing this file against the pool the lab
   * deals reads this rather than re-deriving which arm ran.
   */
  readonly printing: readonly PrintedSheet[] | null;
  /** What this file is not known to deal the way the lab deals it. Usually empty. */
  readonly notes: readonly string[];
}

/** Collector order across sets, so a multi-set pool is still deterministic. */
function inPrintOrder(cards: readonly Card[]): readonly Card[] {
  return [...cards].sort(
    (a, b) => a.set.code.localeCompare(b.set.code) || a.set.collectorNumber - b.set.collectorNumber,
  );
}

/**
 * The name check is the rarity arm's, because that arm emits one custom card per
 * card in the pool and two of a name would keep one. The printing arm has the
 * same rule and a different reading of it: a printing prints four Plains, they
 * are the same card, and `printing.ts` collapses them into one weighted line
 * while still refusing two different cards under one name.
 */
function assertDraftable(cards: readonly Card[]): void {
  assertNotEmpty(cards);
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.name)) {
      throw new DraftExportError(
        `two cards are named "${card.name}"; Draftmancer keys custom cards by name and would keep one`,
      );
    }
    seen.add(card.name);
  }
}

function assertNotEmpty(cards: readonly Card[]): void {
  if (cards.length === 0) throw new DraftExportError('cannot export an empty set');
}

function section(header: string, body: readonly string[]): readonly string[] {
  return [`[${header}]`, ...body];
}

/** `[Count] CardName`, and a bare name when the count is one, as the format reads it. */
function sheetLine(card: Card, count: number): string {
  return count === 1 ? card.name : `${String(count)} ${card.name}`;
}

function renderFile(
  customCards: readonly DraftmancerCustomCard[],
  layouts: DraftmancerLayouts,
  sheets: readonly (readonly [string, readonly string[]])[],
): string {
  const lines = [
    ...section('CustomCards', JSON.stringify(customCards, null, 2).split('\n')),
    ...section('Settings', JSON.stringify({ layouts }, null, 2).split('\n')),
    ...sheets.flatMap(([name, body]) => section(name, body)),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The file cut from the printing's own sheets.
 *
 * `[CustomCards]` is every card the sheets name rather than `boosterPool`: a
 * basic land is in no rarity sheet and is in M11's pack, so the pool's rule
 * would have emitted a layout with a `basic` slot and no basic to fill it.
 */
function exportPrinting(
  ordered: readonly Card[],
  collation: PackCollation,
  weights: CardScoreWeights | undefined,
): DraftmancerExport {
  const sheets = printedSheets(ordered, collation);
  const cards = printedCards(sheets);
  const customCards = toCustomCards(rateCards(cards, weights));
  const layouts = printedLayouts(collation);
  return {
    botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY,
    text: renderFile(
      customCards,
      layouts,
      sheets.map(
        (sheet) => [sheet.name, sheet.entries.map(([card, count]) => sheetLine(card, count))] as const,
      ),
    ),
    customCards,
    // The rarity sheets are not what this file describes, and an empty list is
    // the honest answer rather than a partition nothing was cut from.
    sheets: [],
    layouts,
    report: { unreachableSheets: [], shortSlots: [] },
    printing: sheets,
    notes: printingNotes(collation, sheets),
  };
}

/** Compiles a set into the Draftmancer file, its parts, and its collation report. */
export function exportDraftmancerSet(
  cards: readonly Card[],
  options: DraftExportOptions = {},
): DraftmancerExport {
  const ordered = inPrintOrder(cards);
  if (options.collation !== undefined) {
    assertNotEmpty(cards);
    if (options.recipe !== undefined) {
      throw new DraftExportError(
        "a file is cut from either the printing's collation or a booster recipe, not both",
      );
    }
    return exportPrinting(ordered, options.collation, options.weights);
  }
  assertDraftable(cards);
  const recipe = options.recipe ?? boosterRecipeFor(ordered);

  // The pool rather than the set: `buildSheets` puts a basic land in no sheet
  // (`mtg-h77m`), and a custom card no sheet names is a card Draftmancer reads
  // and can never deal.
  const pool = boosterPool(ordered);
  const customCards = toCustomCards(rateCards(pool, options.weights));
  const sheets = buildSheets(pool);
  const layouts = buildLayouts(recipe, sheets);

  return {
    botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY,
    text: renderFile(
      customCards,
      layouts,
      sheets.map((sheet) => [sheet.name, sheet.cards.map((card) => card.name)] as const),
    ),
    customCards,
    sheets,
    layouts,
    report: collationReport(sheets, layouts),
    printing: null,
    notes: [],
  };
}
