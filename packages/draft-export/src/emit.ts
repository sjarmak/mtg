/**
 * The compile step: a DSL set becomes one Draftmancer custom-set file.
 *
 * The file is the format described in `docs/research/prior-art-tooling.md`
 * §1.1: a `[CustomCards]` JSON array, a `[Settings]` object carrying the pack
 * layouts, then one section per sheet listing its cards by name, one per line.
 * Sheet sections carry no collation token, which selects the format's
 * documented default of `random`.
 *
 * Two properties are load-bearing and both are tested. The output is a pure
 * function of the set and the recipe, sorted before anything is written, so the
 * same set compiles to the same bytes whatever order it arrives in — a draft is
 * reproducible only if the file it was drafted from is. And a card is emitted
 * exactly once, in `[CustomCards]` and in one sheet, because Draftmancer keys
 * custom cards by name and a second entry of the same name would silently
 * replace the first.
 */
import type { BoosterRecipe, CardScoreWeights } from '@mtg/deckbuild';
import { boosterRecipeFor } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import type { CollationReport, DraftmancerLayouts, DraftmancerSheet } from './collation';
import { buildLayouts, buildSheets, collationReport } from './collation';
import type { DraftmancerCustomCard } from './custom-cards';
import { toCustomCards } from './custom-cards';
import { rateCards } from './rating';

export class DraftExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftExportError';
  }
}

export interface DraftExportOptions {
  /** The pack this set is drafted from. Defaults to the recipe derived from the set. */
  readonly recipe?: BoosterRecipe;
  /** Scoring weights behind the ratings. Defaults to the deck builder's. */
  readonly weights?: CardScoreWeights;
}

export interface DraftmancerExport {
  readonly text: string;
  readonly customCards: readonly DraftmancerCustomCard[];
  readonly sheets: readonly DraftmancerSheet[];
  readonly layouts: DraftmancerLayouts;
  /** Ways this set and this recipe would not draft as written. */
  readonly report: CollationReport;
}

/** Collector order across sets, so a multi-set pool is still deterministic. */
function inPrintOrder(cards: readonly Card[]): readonly Card[] {
  return [...cards].sort(
    (a, b) => a.set.code.localeCompare(b.set.code) || a.set.collectorNumber - b.set.collectorNumber,
  );
}

function assertDraftable(cards: readonly Card[]): void {
  if (cards.length === 0) throw new DraftExportError('cannot export an empty set');
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

function section(header: string, body: readonly string[]): readonly string[] {
  return [`[${header}]`, ...body];
}

function renderFile(
  customCards: readonly DraftmancerCustomCard[],
  layouts: DraftmancerLayouts,
  sheets: readonly DraftmancerSheet[],
): string {
  const lines = [
    ...section('CustomCards', JSON.stringify(customCards, null, 2).split('\n')),
    ...section('Settings', JSON.stringify({ layouts }, null, 2).split('\n')),
    ...sheets.flatMap((sheet) =>
      section(
        sheet.name,
        sheet.cards.map((card) => card.name),
      ),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** Compiles a set into the Draftmancer file, its parts, and its collation report. */
export function exportDraftmancerSet(
  cards: readonly Card[],
  options: DraftExportOptions = {},
): DraftmancerExport {
  assertDraftable(cards);
  const ordered = inPrintOrder(cards);
  const recipe = options.recipe ?? boosterRecipeFor(ordered);

  const customCards = toCustomCards(rateCards(ordered, options.weights));
  const sheets = buildSheets(ordered);
  const layouts = buildLayouts(recipe, sheets);

  return {
    text: renderFile(customCards, layouts, sheets),
    customCards,
    sheets,
    layouts,
    report: collationReport(sheets, layouts),
  };
}
