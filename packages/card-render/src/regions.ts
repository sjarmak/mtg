/**
 * The fitted text regions of a face: title bar, type bar, rules box, P/T badge,
 * collector line.
 *
 * Each function here owns one rectangle. It decides the size its text is set
 * at, emits the markup, and returns a `RegionFit` describing what it actually
 * drew — including, when the text did not fit even at the region's minimum
 * size, the shortfall. Nothing here clips: a region that cannot fit is drawn at
 * its floor and pinned to the box with `textLength`, and the caller is told.
 *
 * Every region also writes its box into the markup as `data-box-*`, which is
 * what lets `checkSvgOverflow` re-derive the whole question from the emitted
 * file rather than from this module's own bookkeeping.
 */
import type { Card } from '@mtg/dsl';
import { isCastable, isCreature, isPlaneswalker, printedPowerToughness, renderTypeLine } from '@mtg/dsl';
import {
  LOYALTY_BADGE_GUTTER,
  LOYALTY_BADGE_SHARE,
  LOYALTY_ROW_GAP_EM,
  LOYALTY_SHIELD_FLAT,
  lineRuns,
  nameFitScale,
  nameFitStep,
  rulesFitScale,
  rulesFitStep,
  textBoxBlocks,
} from '@mtg/card-geometry';
import type { TextBlock } from '@mtg/card-geometry';
import { LOYALTY_BADGE_POINTS, LOYALTY_SHIELD_POINTS, collectorLine, outlinePoints } from '@mtg/ui';
import type { SymbolSet } from '@mtg/ui';
import { raritySeal } from './frame';
import { BAR_PADDING, TITLE_MAX_SIZE } from './geometry';
import type { Box, CardGeometry } from './geometry';
import { renderCost, costPips, pipRunWidth } from './pips';
import { richLine } from './symbols';
import { el } from './svg';
import { textRun } from './text/emit';
import { fitLine, fitParagraphs } from './text/layout';
import type { BlockLayout, FitFailure, FitResult, LayoutLine } from './text/layout';
import { BOLD_WIDTH_FACTOR, CENTERED_BASELINE, GLYPH_DESCENT, measureText } from './text/metrics';

/** Regions that carry fitted text. */
export const TEXT_REGIONS = ['title', 'type', 'rules', 'powerToughness', 'loyalty', 'footer'] as const;
export type TextRegion = (typeof TEXT_REGIONS)[number];

/**
 * Size band per region, in user units (10 per millimeter).
 *
 * `loyalty` is the starting-loyalty shield and it is not `powerToughness` under
 * another name, even though both are one short numeral in a corner. The shield
 * is a bigger shape carrying a bigger number, because it is the first thing a
 * reader of a planeswalker looks for, and `@mtg/ui`'s sheet sets the two apart
 * the same way (`.mtg-card__pt` against `.mtg-card__shield`).
 */
const SIZE_BANDS: Readonly<Record<TextRegion, { readonly max: number; readonly min: number }>> = {
  title: { max: TITLE_MAX_SIZE, min: 12 },
  type: { max: 26, min: 10 },
  rules: { max: 29, min: 13 },
  powerToughness: { max: 34, min: 16 },
  loyalty: { max: 38, min: 16 },
  footer: { max: 16, min: 8 },
};

/**
 * The title wraps; the type line does not.
 *
 * A card name is free text up to eighty characters, and eighty characters do
 * not go on one line inside a 44 mm bar at any size a human can read, so the
 * title is fitted as a block and takes a second line when it needs one. A type
 * line is structured — supertypes, types, an em dash, subtypes — and reads
 * wrong broken across lines, so it shrinks instead and has a lower floor.
 */
const TITLE_LINE_HEIGHT = 1.08;

/**
 * A title only wraps once shrinking it would take it below this. One line is
 * the right look for a card name, so a name that merely needs a smaller size
 * gets one; a name that would need to be unreadably small gets a second line
 * instead. 20 units is 2 mm, roughly 5.7 pt — the floor where a name is still
 * comfortably readable across a table.
 */
const TITLE_SINGLE_LINE_FLOOR = 20;

/** What happened when a region was fitted. */
export interface RegionFit {
  readonly region: TextRegion;
  readonly box: Box;
  readonly fontSize: number;
  readonly lines: number;
  /** Widest laid-out line, in user units. */
  readonly width: number;
  /** Total block height, in user units. */
  readonly height: number;
  /** `null` when the region fitted; the shortfall otherwise. */
  readonly failure: FitFailure | null;
}

/** Markup for one region, paired with the fit record describing it. */
export interface RenderedRegion {
  readonly markup: string;
  readonly fit: RegionFit;
}

/**
 * The fit record for a region. `drawn` is what actually went on the card, which
 * for a failure is the minimum-size fallback rather than the layout that did
 * not fit — so the report describes the file, and `failure` describes why the
 * file is not what was asked for.
 */
function fitToRegion(region: TextRegion, box: Box, result: FitResult, drawn: BlockLayout): RegionFit {
  return {
    region,
    box,
    fontSize: drawn.fontSize,
    lines: drawn.lines.length,
    width: drawn.width,
    height: drawn.height,
    failure: result.ok ? null : result.failure,
  };
}

/**
 * Layout that is drawn when a fit failed. The text is set at the minimum size
 * and `textLength` holds it to the box, so the face stays readable and the
 * report — not the pixels — is what tells you the card is over budget.
 */
function fallbackLayout(text: string, minSize: number, boxWidth: number): BlockLayout {
  return {
    fontSize: minSize,
    lineHeight: minSize * 1.22,
    lines: [{ text, width: boxWidth, baseline: minSize * 0.95, paragraph: 0 }],
    width: boxWidth,
    height: minSize * 1.22,
  };
}

function regionGroup(region: TextRegion, box: Box, children: readonly string[]): string {
  return el(
    'g',
    {
      class: 'region',
      'data-region': region,
      'data-box-x': box.x,
      'data-box-y': box.y,
      'data-box-w': box.width,
      'data-box-h': box.height,
    },
    children,
  );
}

export interface RenderContext {
  readonly card: Card;
  readonly geometry: CardGeometry;
  readonly safety: { readonly widthSafety?: number };
  /**
   * Which glyph set the face paints its mana symbols with — the rules box's
   * brace tokens and the title bar's cost pips alike. Absent takes the
   * registry's printed default; `render.ts` threads the caller's choice through.
   */
  readonly symbols?: SymbolSet;
}

export function renderTitle(context: RenderContext): RenderedRegion {
  const { card, geometry, safety } = context;
  const bar = geometry.title;
  const cost = isCastable(card) ? card.manaCost : null;
  const pipCount = cost === null ? 0 : costPips(cost).length;
  const costWidth = pipRunWidth(pipCount, geometry.pipRadius, geometry.pipGap);
  const gap = costWidth > 0 ? BAR_PADDING : 0;
  const nameBox: Box = {
    x: bar.x + BAR_PADDING,
    y: bar.y,
    width: bar.width - BAR_PADDING * 2 - costWidth - gap,
    height: bar.height,
  };
  const band = SIZE_BANDS.title;
  const titleOptions = { ...safety, boldFactor: BOLD_WIDTH_FACTOR };
  // The ceiling the shared name ladder puts this card on, exactly as the rules
  // box takes `rulesFitStep` as a cap on its own scan: the DOM face cannot
  // measure, so both faces read one piece of arithmetic and print then does the
  // measuring underneath it. A cap only ever lowers where print starts, so
  // `fitLine`'s floor and `checkSvgOverflow` still own what actually goes on the
  // card. `NAME_FIT_STEPS`'s floor is 0.7 and the band's ceiling is 34, so the
  // capped ceiling is 23.8 and never reaches either floor below it.
  const maxSize = band.max * nameFitScale(nameFitStep(card));
  const singleLine = fitLine(
    card.name,
    { maxWidth: nameBox.width, maxSize, minSize: TITLE_SINGLE_LINE_FLOOR },
    titleOptions,
  );
  const result = singleLine.ok
    ? singleLine
    : fitParagraphs(
        [card.name],
        {
          maxWidth: nameBox.width,
          maxHeight: nameBox.height,
          maxSize,
          minSize: band.min,
          lineHeight: TITLE_LINE_HEIGHT,
        },
        titleOptions,
      );
  const layout = result.ok ? result.layout : fallbackLayout(card.name, band.min, nameBox.width);
  const centerY = bar.y + bar.height / 2;
  const top = bar.y + Math.max(0, (bar.height - layout.height) / 2);
  const children: string[] = [
    el('rect', {
      class: 'panel',
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
      rx: 5,
      'stroke-width': 1.2,
    }),
    ...layout.lines.map((line) =>
      textRun(line.text, {
        className: 'title-text ink',
        x: nameBox.x,
        y: top + line.baseline,
        fontSize: layout.fontSize,
        boldFactor: BOLD_WIDTH_FACTOR,
        width: Math.min(line.width, nameBox.width),
        extra: { 'data-region': 'title' },
        ...safety,
      }),
    ),
  ];
  if (cost !== null) {
    children.push(
      renderCost(cost, {
        radius: geometry.pipRadius,
        gap: geometry.pipGap,
        centerY,
        right: bar.x + bar.width - BAR_PADDING,
        ...safety,
        // The title bar's pips come from the set the rules box is painted with,
        // which is what keeps one card to one vocabulary.
        ...(context.symbols === undefined ? {} : { symbols: context.symbols }),
      }),
    );
  }
  return {
    markup: regionGroup('title', nameBox, children),
    fit: fitToRegion('title', nameBox, result, layout),
  };
}

/** Where the printed seal sits in the type bar. Its outline is the specification's. */
export interface SealPlacement {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export function typeBarSeal(bar: Box): SealPlacement {
  const radius = bar.height * 0.32;
  return { cx: bar.x + bar.width - BAR_PADDING - radius, cy: bar.y + bar.height / 2, radius };
}

export function renderTypeBar(context: RenderContext): RenderedRegion {
  const { card, geometry, safety } = context;
  const bar = geometry.type;
  const seal = typeBarSeal(bar);
  const textBox: Box = {
    x: bar.x + BAR_PADDING,
    y: bar.y,
    width: bar.width - BAR_PADDING * 2 - seal.radius * 2 - BAR_PADDING,
    height: bar.height,
  };
  const typeLine = renderTypeLine(card);
  const band = SIZE_BANDS.type;
  const result = fitLine(typeLine, { maxWidth: textBox.width, maxSize: band.max, minSize: band.min }, safety);
  const layout = result.ok ? result.layout : fallbackLayout(typeLine, band.min, textBox.width);
  const centerY = bar.y + bar.height / 2;
  const children = [
    el('rect', {
      class: 'panel',
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
      rx: 5,
      'stroke-width': 1.2,
    }),
    textRun(typeLine, {
      className: 'type-text ink',
      x: textBox.x,
      y: centerY + layout.fontSize * CENTERED_BASELINE,
      fontSize: layout.fontSize,
      width: layout.width,
      extra: { 'data-region': 'type' },
      ...safety,
    }),
    raritySeal(card.set.code, card.rarity, seal.cx, seal.cy, seal.radius),
  ];
  return {
    markup: regionGroup('type', textBox, children),
    fit: fitToRegion('type', textBox, result, layout),
  };
}

/**
 * The scale the shared ladder puts a card's printed rules text on.
 *
 * `rulesFitScale` rather than an index into `RULES_FIT_STEPS`, because there
 * are two ladders now: a planeswalker's box shrinks down two further rungs that
 * a creature's must not reach (`@mtg/card-geometry`, `LOYALTY_FIT_STEPS`), so a
 * walker on step 4 or 5 used to land on `undefined` here and throw. Asking the
 * shared function which scale *this card's* step means is the only spelling
 * that keeps working when a card type gets a ladder of its own.
 */
function fitScale(card: Card): number {
  return rulesFitScale(card, rulesFitStep(card));
}

/** The roman face the rules text is set in, and the italic face a gloss is. */
const RULES_FACE = 'rules-text ink';
const GLOSS_FACE = 'rules-text ink italic';

/**
 * The class a block of the text box is set in. `rules` is the roman face the box
 * has always been set in; a reminder and the flavor text are italic, which is
 * the whole of how a printed card tells the three apart.
 *
 * A line with a roman boundary is set in both: the run before it is rules text
 * and stays roman, and only the gloss after it is italic, the way a printing
 * sets `Trample (This creature …)` (`mtg-vsv`) and `Put a gloom counter on
 * target creature. (A creature with …)`. The line breaker is untouched by that,
 * and the reason is worth writing down because it is what made the change cheap.
 * The metrics table (`text/metrics.ts`) is one per-character upper bound over
 * two reference serif faces and carries no separate italic advances, so the
 * italic run is measured against the roman table *today* — laying the two runs
 * out side by side charges exactly what one whole-line run was charged, since
 * `measureText` sums per character and is therefore additive across a split.
 * What the split does need is `text-box.ts`'s `lineRuns`, because the wrapped
 * line is not the paragraph and the boundary has to be found in whichever line
 * it fell in.
 */
function blockClass(kind: TextBlock['kind']): string {
  return kind === 'rules' ? RULES_FACE : GLOSS_FACE;
}

/**
 * The face the run *after* a block's roman boundary is set in.
 *
 * A block that declares a boundary sets everything past it in italics whatever
 * its own kind is (`text-box.ts`, `TextBlock.roman`), which is why this reads
 * the block rather than the split: once the wrap has carried a line wholly past
 * the boundary that line has no roman run left to tell it apart from a line of
 * plain rules text, and a gloss that went roman on its second line would be the
 * one place the two faces disagreed.
 */
function glossClass(block: TextBlock): string {
  return block.roman === undefined ? blockClass(block.kind) : GLOSS_FACE;
}

/**
 * How many words of its own paragraph precede each wrapped line.
 *
 * `lineRuns` splits by whole words, and a paragraph reaches the emitter already
 * broken into lines, so the roman run of a paragraph may be entirely on its
 * first line, split across the first two, or — on a line the wrap pushed past
 * it — absent. This is the running count that tells them apart, computed over
 * the laid-out lines rather than guessed at from a line's contents.
 */
/**
 * What a laid-out line is set as when the blocks list has no paragraph at its
 * index — unreachable, since every line comes out of a paragraph, and stated
 * rather than left to a `?? 'rules'` so `lineRuns` has a block to be given.
 */
const UNBLOCKED: TextBlock = { kind: 'rules', text: '' };

function paragraphWordOffsets(lines: readonly LayoutLine[]): readonly number[] {
  const offsets: number[] = [];
  let paragraph = -1;
  let seen = 0;
  for (const line of lines) {
    if (line.paragraph !== paragraph) {
      paragraph = line.paragraph;
      seen = 0;
    }
    offsets.push(seen);
    const trimmed = line.text.trim();
    seen += trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  }
  return offsets;
}

/**
 * The two columns of a planeswalker's ability row, in user units of a given box.
 *
 * `column` is what the sentence gives up on the left and `badge` is the part of
 * that the shape is drawn in; the difference between them is the gutter, which
 * is the one measurement that keeps a long cost from touching the sentence it
 * pays for. Both are shares of the box (`@mtg/card-geometry`), so the printed
 * 538-unit box and whatever width a viewport gave the DOM one reserve the same
 * fraction rather than the same number of units.
 */
function loyaltyColumns(inner: Box): { readonly column: number; readonly badge: number } {
  return {
    column: inner.width * LOYALTY_BADGE_SHARE,
    badge: inner.width * (LOYALTY_BADGE_SHARE - LOYALTY_BADGE_GUTTER),
  };
}

/**
 * How much of the badge's width its numeral may occupy: the flat span across
 * the top of the hexagon, between the two points.
 *
 * Derived from the shared outline rather than stated, because the outline is
 * the thing that decides it: move a point and the room for `−20` moves with it.
 * A numeral committed to this width is tracked in rather than allowed to reach
 * the taper, where the shape has no height left to hold a glyph.
 */
function flatSpan(outline: readonly (readonly [number, number])[]): number {
  const flat = outline.filter(([, y]) => y === 0).map(([x]) => x);
  if (flat.length < 2) return 1;
  return Math.max(...flat) - Math.min(...flat);
}

const BADGE_FLAT_SPAN = flatSpan(LOYALTY_BADGE_POINTS);

/** A cost badge's height, as a multiple of the type size it sits on the line of. */
const BADGE_HEIGHT_EM = 1.16;

/**
 * The cost badge at the head of one loyalty row, and the divider above it.
 *
 * Both are drawn against the row's *first* line, which is where the cost is
 * stated and where the rule between two abilities belongs. A row that wraps
 * onto a second and third line gets neither again, because the second line of
 * an ability is the same ability.
 *
 * The divider is charged to the row below it, so the first row of a box is
 * never ruled off from the top of the box it already sits inside — the same
 * rule `@mtg/ui`'s sheet states as `:first-child { border-top: 0 }`.
 */
function loyaltyRow(
  cost: string,
  line: LayoutLine,
  layout: BlockLayout,
  inner: Box,
  top: number,
  options: {
    readonly first: boolean;
    readonly gap: number;
    readonly safety: { readonly widthSafety?: number };
  },
): readonly string[] {
  const { badge } = loyaltyColumns(inner);
  const { fontSize } = layout;
  const baseline = top + line.baseline;
  const center = baseline - fontSize * CENTERED_BASELINE;
  const height = fontSize * BADGE_HEIGHT_EM;
  const shape: Box = { x: inner.x, y: center - height / 2, width: badge, height };
  const lineTop = baseline - layout.lineHeight + fontSize * GLYPH_DESCENT;
  const pieces: string[] = [];
  if (!options.first) {
    pieces.push(
      el('line', {
        class: 'loyalty-rule',
        x1: inner.x,
        y1: lineTop - options.gap / 2,
        x2: inner.x + inner.width,
        y2: lineTop - options.gap / 2,
        'stroke-width': 1,
      }),
    );
  }
  pieces.push(
    el('polygon', { class: 'loyalty-badge', points: outlinePoints(LOYALTY_BADGE_POINTS, shape) }),
    textRun(cost, {
      className: 'loyalty-cost',
      x: shape.x + shape.width / 2,
      y: baseline,
      fontSize,
      anchor: 'middle',
      boldFactor: BOLD_WIDTH_FACTOR,
      width: Math.min(
        measureText(cost, { fontSize, boldFactor: BOLD_WIDTH_FACTOR, ...options.safety }),
        shape.width * BADGE_FLAT_SPAN,
      ),
      // Declared in the rules box rather than in a region of its own, because
      // that is where it is: `checkSvgOverflow` measures it against the same
      // rectangle the sentence beside it is measured against, which is the only
      // way a badge that grew past its column would be caught. It carries no
      // `data-line`, so the readers that put a line back together from its
      // pieces — the proof sheet, the cross-face word comparison — see the
      // words of the card and not the price of them.
      extra: { 'data-region': 'rules', 'data-loyalty': cost },
      ...options.safety,
    }),
  );
  return pieces;
}

export function renderRules(context: RenderContext): RenderedRegion {
  const { card, geometry, safety } = context;
  const outer = geometry.rules;
  const pad = geometry.textPadding;
  const inner: Box = {
    x: outer.x + pad,
    y: outer.y + pad,
    width: outer.width - pad * 2,
    height: outer.height - pad * 2,
  };
  // What the box holds is the shared specification's call, not this renderer's:
  // the rules text, the reminder text its keywords print, and the flavor text
  // when the card has room. `@mtg/ui`'s `text-box.ts` argues all three, and
  // `test/parity.test.ts` fails when the two faces stop agreeing about them.
  const blocks = textBoxBlocks(card);
  const paragraphs = blocks.map((block) => block.text);
  // A loyalty ability's cost is a badge at the head of its row rather than
  // three characters of its sentence, so the sentence is set in a column of its
  // own and the wrap is told about it here rather than shifted afterwards. An
  // uncosted row — a walker's flavor text, the second line of an ability that
  // prints on two — takes no inset and runs the full width of the box, which is
  // what the printed card does with one.
  const { column } = loyaltyColumns(inner);
  const insets = blocks.map((block) => (block.loyaltyCost === undefined ? 0 : column));
  const ruled = insets.some((indent) => indent > 0);
  const band = SIZE_BANDS.rules;
  // The shared fit ladder, applied as a ceiling on the measured scan below.
  // `@mtg/ui`'s `rulesFitStep` is the one rule both faces shrink by — the DOM
  // face has no measurement to make, because jsdom lays nothing out — and this
  // is where the printed face obeys it: it starts from the step's size rather
  // than from the band's, and then goes on scanning down against its own
  // metrics table. So print can end up smaller than the step says and never
  // larger, and `checkSvgOverflow`'s guarantee is untouched.
  const maxSize = band.max * fitScale(card);
  const noText: FitResult = {
    ok: true,
    layout: { fontSize: maxSize, lineHeight: maxSize * 1.22, lines: [], width: 0, height: 0 },
  };
  // A divided box pays more between its rows than a spaced one does: the rule
  // between two abilities plus the air on both sides of it. `LOYALTY_ROW_GAP_EM`
  // is the sheet's own 9px against its 13px type, so the two faces leave the
  // divider the same room relative to the text it separates.
  const bounds = {
    maxWidth: inner.width,
    maxHeight: inner.height,
    maxSize,
    minSize: band.min,
    insets,
    ...(ruled ? { paragraphGap: LOYALTY_ROW_GAP_EM } : {}),
  };
  const result = paragraphs.length === 0 ? noText : fitParagraphs(paragraphs, bounds, safety);

  const layout = result.ok ? result.layout : lastResortLayout(paragraphs, inner, band.min, insets, safety);
  const top = inner.y + Math.max(0, (inner.height - layout.height) / 2);
  // One line is several pieces now: the brace tokens the DSL prints are drawn
  // rather than set, so a line becomes runs of text with positioned symbol
  // groups between them, and a reminder's keyword is one more piece for the
  // same reason. Each piece declares its own rectangle, which is what keeps
  // `checkSvgOverflow` covering the whole line (`symbols.ts`).
  const offsets = paragraphWordOffsets(layout.lines);
  const gap = layout.fontSize * LOYALTY_ROW_GAP_EM;
  // Which laid-out line opens each paragraph. A row's badge and its divider are
  // drawn once, against that line, and a paragraph the wrap carried onto a
  // second and third line draws neither again — the second line of an ability
  // is the same ability. Read off the layout rather than guessed from a word
  // count, which reads zero twice on a paragraph whose first line is empty.
  const opens = new Set<number>();
  const started = new Set<number>();
  layout.lines.forEach((line, index) => {
    if (started.has(line.paragraph)) return;
    started.add(line.paragraph);
    opens.add(index);
  });
  const lines = layout.lines.flatMap((line, index) => {
    // `LayoutLine.paragraph` is the block this wrapped line came out of, so a
    // block's kind reaches every line of it without this file re-deriving
    // where a paragraph ended.
    const block = blocks[line.paragraph] ?? UNBLOCKED;
    const runs = lineRuns(block, line.text, offsets[index] ?? 0);
    // The column this row is set in, which is the box less whatever the badge
    // took. `fitParagraphs` wrapped it to exactly this width, so the origin
    // here and the width it was fitted to are the same statement.
    const indent = insets[line.paragraph] ?? 0;
    const originX = inner.x + indent;
    const cost = block.loyaltyCost;
    const badge =
      cost === undefined || !opens.has(index)
        ? []
        : // `line.paragraph === 0` is the printed face's spelling of the sheet's
          // `:first-child`: the first row of a box is never ruled off from the
          // top of the box it already sits inside.
          loyaltyRow(cost, line, layout, inner, top, { first: line.paragraph === 0, gap, safety });
    const shared = {
      y: top + line.baseline,
      fontSize: layout.fontSize,
      region: 'rules',
      line: index,
      right: inner.x + inner.width,
      ...(context.symbols === undefined ? {} : { symbols: context.symbols }),
      ...safety,
    };
    // The roman run is set first and the rest starts where it ended, measured
    // with the call `richLine` advances its own cursor by, so the two runs sit
    // on one baseline and meet at exactly the width the first was committed to.
    if (runs.roman.length === 0) {
      return [...badge, ...richLine(runs.rest, { ...shared, className: glossClass(block), x: originX })];
    }
    const width = measureText(runs.roman, { fontSize: layout.fontSize, ...safety });
    return [
      ...badge,
      ...richLine(runs.roman, { ...shared, className: RULES_FACE, x: originX }),
      ...richLine(runs.rest, { ...shared, className: glossClass(block), x: originX + width }),
    ];
  });
  const children = [
    el('rect', {
      class: 'panel',
      x: outer.x,
      y: outer.y,
      width: outer.width,
      height: outer.height,
      rx: 5,
      'stroke-width': 1.2,
    }),
    ...lines,
  ];
  return {
    markup: regionGroup('rules', inner, children),
    fit: fitToRegion('rules', inner, result, layout),
  };
}

/**
 * Layout for a rules box that could not be fitted: wrapped at the minimum size
 * and then truncated to the lines the box can hold, with the last kept line
 * marked. Truncation is visible and the render is reported as failed; the
 * alternative — drawing every line and letting the tail run over the P/T badge
 * and off the card — is the failure mode this package exists to prevent.
 */
function lastResortLayout(
  paragraphs: readonly string[],
  inner: Box,
  minSize: number,
  insets: readonly number[],
  safety: { readonly widthSafety?: number },
): BlockLayout {
  const attempt = fitParagraphs(
    paragraphs,
    { maxWidth: inner.width, maxHeight: Number.MAX_SAFE_INTEGER, maxSize: minSize, minSize, insets },
    safety,
  );
  if (!attempt.ok) return fallbackLayout(paragraphs.join(' '), minSize, inner.width);
  const { layout } = attempt;
  // How many lines fit is not `inner.height / lineHeight`: `fitParagraphs`
  // leaves a gap between paragraphs, so on any card with more than one
  // paragraph — which is every card carrying an ability — that count is one
  // line too many and the extra one is drawn below the box. Each line already
  // knows where its own ink ends, so ask it.
  const descent = layout.fontSize * GLYPH_DESCENT;
  const kept: LayoutLine[] = [];
  for (const line of layout.lines) {
    if (kept.length > 0 && line.baseline + descent > inner.height) break;
    kept.push(line);
  }
  if (kept.length === layout.lines.length) return layout;
  const last = kept[kept.length - 1];
  return { ...layout, lines: kept, height: last === undefined ? 0 : last.baseline + descent };
}

/**
 * The corner plate: a creature's power and toughness.
 *
 * **It used to draw a planeswalker's starting loyalty too, and that was the
 * wrong shape for it.** One rectangle for both said that the two numbers are
 * the same kind of fact in different words; they are not. A power and toughness
 * is a pair the game changes constantly, and a starting loyalty is a single
 * number printed once, which the reader of a planeswalker looks for before
 * anything else on the card. A printed walker gives it a shield hanging off the
 * corner of the frame, larger than everything else in the corner, and that is
 * `renderLoyalty` below. `@mtg/ui`'s `statBadge` split the same way and for the
 * same reason (`.mtg-card__pt` against `.mtg-card__shield`).
 */
export function renderPowerToughness(context: RenderContext): RenderedRegion | null {
  const { card, geometry, safety } = context;
  if (!isCreature(card)) return null;
  const badge = geometry.powerToughness;
  const inner: Box = {
    x: badge.x + BAR_PADDING,
    y: badge.y,
    width: badge.width - BAR_PADDING * 2,
    height: badge.height,
  };
  const text = printedPowerToughness(card);
  const band = SIZE_BANDS.powerToughness;
  const result = fitLine(
    text,
    { maxWidth: inner.width, maxSize: band.max, minSize: band.min },
    { ...safety, boldFactor: BOLD_WIDTH_FACTOR },
  );
  const layout = result.ok ? result.layout : fallbackLayout(text, band.min, inner.width);
  const children = [
    el('rect', {
      class: 'panel',
      x: badge.x,
      y: badge.y,
      width: badge.width,
      height: badge.height,
      rx: 6,
      'stroke-width': 1.4,
    }),
    textRun(text, {
      className: 'pt-text ink',
      x: badge.x + badge.width / 2,
      y: badge.y + badge.height / 2 + layout.fontSize * CENTERED_BASELINE,
      fontSize: layout.fontSize,
      anchor: 'middle',
      boldFactor: BOLD_WIDTH_FACTOR,
      width: layout.width,
      extra: { 'data-region': 'powerToughness' },
      ...safety,
    }),
  ];
  return {
    markup: regionGroup('powerToughness', inner, children),
    fit: fitToRegion('powerToughness', inner, result, layout),
  };
}

/**
 * The starting-loyalty shield, in the bottom-right corner of a planeswalker.
 *
 * A shield rather than a plate, and hanging off the frame rather than sitting
 * inside it, because those two facts are what tell a reader at a glance which
 * number on the card is the total and which are the prices. The silhouette is
 * `LOYALTY_SHIELD_POINTS` — the same unit outline `@mtg/ui` clips its badge to,
 * scaled onto this box instead of turned into percentages — so a moved corner
 * moves both faces or neither.
 *
 * The numeral is set in the *flat* upper part rather than centered on the whole
 * shape, and the region declares that part as its box. The lower `1 - FLAT` of
 * a shield is a taper narrowing to a point, which has no room to hold a glyph;
 * a number centered on the whole shape hangs over the point. `@mtg/ui`'s sheet
 * states the same exception as `padding-block-end`, off the same constant, so
 * the two numerals sit at the same height in their shields.
 */
export function renderLoyalty(context: RenderContext): RenderedRegion | null {
  const { card, geometry, safety } = context;
  if (!isPlaneswalker(card)) return null;
  const shield = geometry.loyalty;
  const inner: Box = {
    x: shield.x,
    y: shield.y,
    width: shield.width,
    height: shield.height * LOYALTY_SHIELD_FLAT,
  };
  const text = String(card.startingLoyalty);
  const band = SIZE_BANDS.loyalty;
  const result = fitLine(
    text,
    { maxWidth: inner.width - BAR_PADDING * 2, maxSize: band.max, minSize: band.min },
    { ...safety, boldFactor: BOLD_WIDTH_FACTOR },
  );
  const layout = result.ok ? result.layout : fallbackLayout(text, band.min, inner.width);
  const children = [
    el('polygon', {
      class: 'loyalty-shield',
      points: outlinePoints(LOYALTY_SHIELD_POINTS, shield),
      'stroke-width': 1.4,
    }),
    textRun(text, {
      className: 'loyalty-ink',
      x: inner.x + inner.width / 2,
      y: inner.y + inner.height / 2 + layout.fontSize * CENTERED_BASELINE,
      fontSize: layout.fontSize,
      anchor: 'middle',
      boldFactor: BOLD_WIDTH_FACTOR,
      width: layout.width,
      extra: { 'data-region': 'loyalty' },
      ...safety,
    }),
  ];
  return {
    markup: regionGroup('loyalty', inner, children),
    fit: fitToRegion('loyalty', inner, result, layout),
  };
}

/**
 * Collector line: the same identity the set file uses, printed on the card —
 * and the same line the web face carries, from `@mtg/ui`'s `collectorLine`.
 *
 * **This is a print-only region now**, and the asymmetry is deliberate rather
 * than a leftover. `mtg-ceq` took the bar off the DOM face and gave its
 * height to the rules box, and put the line in every face's `title` instead
 * (`@mtg/ui`'s `faceDetailText`); paper has no hover, and a proxy that cannot
 * be traced back to a printing is not a proxy, so the bar stays here. That is
 * the same shape ADR-0002 §2.2 already gives the multicolor border ramp and the
 * P/T badge: `FACE_REGIONS` is what both faces lay out, and each may draw more.
 *
 * Set in `ink-muted` on a panel bar of its own. It used to be the one run of
 * body text drawn straight onto the card's ground, which was survivable while
 * the ground was a near-white tint and is not now that the ground is the
 * identity band: muted ink sits at 1.3:1 on the green band and 1.5:1 on the
 * blue one. The bar is the same `panel` rect the title and type bars draw, so
 * the line is read off the one surface the palette holds to AA for all seven
 * identities in both themes.
 */
export const footerText = collectorLine;

export function renderFooter(context: RenderContext): RenderedRegion {
  const { card, geometry, safety } = context;
  const bar = geometry.footer;
  const text = footerText(card);
  const band = SIZE_BANDS.footer;
  const inner: Box = {
    x: bar.x + BAR_PADDING,
    y: bar.y,
    width: bar.width - BAR_PADDING * 2,
    height: bar.height,
  };
  const result = fitLine(text, { maxWidth: inner.width, maxSize: band.max, minSize: band.min }, safety);
  const layout = result.ok ? result.layout : fallbackLayout(text, band.min, inner.width);
  const markup = regionGroup('footer', inner, [
    el('rect', {
      class: 'panel',
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
      rx: 5,
      'stroke-width': 1.2,
    }),
    textRun(text, {
      className: 'meta-text ink-muted',
      x: inner.x,
      y: inner.y + inner.height / 2 + layout.fontSize * CENTERED_BASELINE,
      fontSize: layout.fontSize,
      width: layout.width,
      extra: { 'data-region': 'footer' },
      ...safety,
    }),
  ]);
  return { markup, fit: fitToRegion('footer', inner, result, layout) };
}
