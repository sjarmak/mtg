/**
 * Rendering a whole set, and saying plainly what did not fit.
 *
 * A per-card renderer that returns a fit report is only useful if something
 * reads every report, and at set scale nobody reads ninety of them by hand. So
 * the batch API is the primary interface: hand it a set, get back every SVG
 * plus one report that names the cards that failed, the region that failed, and
 * the shortfall in millimeters. `renderSetOrThrow` turns that report into a
 * build failure for callers that want the gate rather than the data.
 *
 * The batch also runs `checkSvgOverflow` over each emitted file, so the report
 * covers both "the layout engine said it did not fit" and "the layout engine
 * said it fit but the markup disagrees". Those are different bugs and a report
 * that conflated them would be worth less than either.
 */
import type { Card } from '@mtg/dsl';
import { renderOracleText } from '@mtg/dsl';
import type { CardRender, RenderOptions } from './render';
import { renderCardSvg } from './render';
import type { TextRegion } from './regions';
import { checkSvgOverflow } from './overflow';
import type { OverflowFinding } from './overflow';
import { UNITS_PER_MM } from './geometry';

/** One rendered card plus everything the report needs about it. */
export interface SetCardRender extends CardRender {
  readonly index: number;
  readonly name: string;
  /** Runs that left their box in the emitted markup. Should always be empty. */
  readonly overflows: readonly OverflowFinding[];
}

/** A card that did not fit, flattened for reporting. */
export interface FitFailureRecord {
  readonly cardId: string;
  readonly name: string;
  readonly region: TextRegion;
  readonly reason: 'width' | 'height';
  /** Shortfall in millimeters, which is the unit a designer can act on. */
  readonly overflowMm: number;
  readonly minFontSize: number;
  readonly line: string | null;
}

export interface SetRenderReport {
  readonly cards: number;
  readonly rendered: number;
  readonly withArt: number;
  readonly pendingArt: number;
  readonly failures: readonly FitFailureRecord[];
  readonly overflows: readonly (OverflowFinding & { readonly cardId: string })[];
  /** Longest oracle text in the set, in characters — what the fit was up against. */
  readonly longestOracle: { readonly cardId: string; readonly characters: number } | null;
  /** Smallest rules-box font size any card needed, in user units. */
  readonly smallestRulesSize: number | null;
  readonly ok: boolean;
}

export interface SetRenderResult {
  readonly renders: readonly SetCardRender[];
  readonly report: SetRenderReport;
}

/** Renders every card in a set and reports every card that failed to fit. */
export function renderSet(cards: readonly Card[], options: RenderOptions = {}): SetRenderResult {
  const renders: SetCardRender[] = [];
  const failures: FitFailureRecord[] = [];
  const overflows: (OverflowFinding & { cardId: string })[] = [];

  cards.forEach((card, index) => {
    const render = renderCardSvg(card, options);
    const found = checkSvgOverflow(render.svg);
    renders.push({ ...render, index, name: card.name, overflows: found });
    for (const finding of found) overflows.push({ ...finding, cardId: card.id });
    for (const fit of render.failures) {
      const failure = fit.failure;
      if (failure === null) continue;
      failures.push({
        cardId: card.id,
        name: card.name,
        region: fit.region,
        reason: failure.reason,
        overflowMm: failure.overflow / UNITS_PER_MM,
        minFontSize: failure.minSize,
        line: failure.line ?? null,
      });
    }
  });

  return { renders, report: buildReport(cards, renders, failures, overflows) };
}

function buildReport(
  cards: readonly Card[],
  renders: readonly SetCardRender[],
  failures: readonly FitFailureRecord[],
  overflows: readonly (OverflowFinding & { cardId: string })[],
): SetRenderReport {
  const withArt = renders.filter((render) => render.hasArt).length;
  let smallest: number | null = null;
  for (const render of renders) {
    for (const fit of render.fits) {
      if (fit.region !== 'rules' || fit.lines === 0) continue;
      if (smallest === null || fit.fontSize < smallest) smallest = fit.fontSize;
    }
  }
  return {
    cards: cards.length,
    rendered: renders.length,
    withArt,
    pendingArt: renders.length - withArt,
    failures,
    overflows,
    longestOracle: longestOracle(cards),
    smallestRulesSize: smallest,
    ok: failures.length === 0 && overflows.length === 0,
  };
}

function longestOracle(cards: readonly Card[]): SetRenderReport['longestOracle'] {
  let best: { cardId: string; characters: number } | null = null;
  for (const card of cards) {
    const characters = oracleLength(card);
    if (best === null || characters > best.characters) best = { cardId: card.id, characters };
  }
  return best;
}

/**
 * Measured from the renderer, not from `card.oracleText`: that field is an
 * optional cache and a set file is free to omit it, which would make the
 * report's headline number quietly zero on exactly the sets nobody has
 * post-processed yet.
 */
function oracleLength(card: Card): number {
  return renderOracleText(card).length;
}

/** Renders a set and throws when anything failed to fit. The CI-gate form. */
export function renderSetOrThrow(cards: readonly Card[], options: RenderOptions = {}): SetRenderResult {
  const result = renderSet(cards, options);
  if (!result.report.ok) throw new Error(formatFitReport(result.report));
  return result;
}

/** The report as a human-readable block, for a CLI or a failing assertion. */
export function formatFitReport(report: SetRenderReport): string {
  const lines: string[] = [
    `rendered ${report.rendered}/${report.cards} cards ` +
      `(${report.withArt} with art, ${report.pendingArt} pending)`,
  ];
  if (report.longestOracle !== null) {
    lines.push(
      `longest oracle text: ${report.longestOracle.characters} characters ` +
        `(${report.longestOracle.cardId})`,
    );
  }
  if (report.smallestRulesSize !== null) {
    lines.push(`smallest rules size used: ${report.smallestRulesSize} units`);
  }
  if (report.failures.length === 0 && report.overflows.length === 0) {
    lines.push('no card failed to fit');
    return lines.join('\n');
  }
  for (const failure of report.failures) {
    lines.push(
      `FIT ${failure.cardId} (${failure.name}): ${failure.region} overflows by ` +
        `${failure.overflowMm.toFixed(2)}mm on ${failure.reason} at minimum size ` +
        `${failure.minFontSize}${failure.line === null ? '' : ` — "${failure.line}"`}`,
    );
  }
  for (const overflow of report.overflows) {
    lines.push(
      `MARKUP ${overflow.cardId}: ${overflow.region} run "${overflow.text}" leaves the box ` +
        `${overflow.overflow.toFixed(2)} units past the ${overflow.edge} edge`,
    );
  }
  return lines.join('\n');
}
