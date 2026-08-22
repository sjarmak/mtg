/**
 * `@mtg/card-render` — a DSL card to a printed face, as SVG.
 *
 * SVG rather than a raster because the output has to be four things at once:
 * diffable (a re-render of an unchanged set is a zero-line diff), testable (the
 * emitted file answers "does this text fit" without a rasterizer), printable at
 * true 63 x 88 mm, and free of any native dependency, which matters for a
 * package that runs in CI on every set revision.
 *
 * Three things in here are load-bearing and easy to get wrong:
 *
 *  * **Text is measured, not guessed.** `text/metrics.ts` carries a generated
 *    upper-bound advance-width table and every run is emitted with a committed
 *    `textLength`. A fixed font size that suits a two-line common is the bug
 *    this package exists to prevent.
 *  * **Art is a registry, never an import.** See `art.ts`.
 *  * **No color is chosen here.** `@mtg/ui`'s token layer is the only palette;
 *    see `palette.ts`.
 */

export {
  BAR_PADDING,
  CARD_GEOMETRY,
  CARD_HEIGHT,
  CARD_HEIGHT_MM,
  CARD_WIDTH,
  CARD_WIDTH_MM,
  DEFAULT_BLEED_MM,
  PLANESWALKER_GEOMETRY,
  TITLE_MAX_SIZE,
  UNITS_PER_MM,
  bleedGeometry,
  box,
  cardGeometry,
  contains,
  inset,
  pipRunWidth as geometryPipRunWidth,
} from './geometry';
export type { BleedGeometry, Box, CardGeometry } from './geometry';

export {
  BOLD_WIDTH_FACTOR,
  CENTERED_BASELINE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_WIDTH_SAFETY,
  FALLBACK_ADVANCE,
  GLYPH_ASCENT,
  GLYPH_DESCENT,
  METRIC_CHARS,
  METRIC_EM,
  METRIC_SOURCES,
  advanceOf,
  charAdvance,
  fitFontSize,
  measureText,
} from './text/metrics';
export type { MeasureOptions } from './text/metrics';

export { candidateSizes, fitLine, fitParagraphs, wrapParagraph } from './text/layout';
export type { BlockLayout, FitBounds, FitFailure, FitResult, LayoutLine, WrapOptions } from './text/layout';
export { textRun } from './text/emit';
export type { TextRunAttrs } from './text/emit';

export { escapeAttr, escapeText, el, num, styleEl, textEl } from './svg';
export type { AttrValue, Attrs } from './svg';

export { CARD_CLASS, CARD_CSS, COLOR_IDENTITIES, TOKEN_CSS, cardStyleSheet } from './palette';
export type { CardTheme, ColorIdentity } from './palette';

export { costPips, pipRunWidth, renderCost } from './pips';
export type { PipRenderOptions, PipSpec } from './pips';

export { SYMBOL_GROUP_CLASS, richLine } from './symbols';
export type { RichLineOptions } from './symbols';
export {
  SYMBOL_ADVANCE_EM,
  SYMBOL_BOX_EM,
  SYMBOL_DROP_EM,
  SYMBOL_MARGIN_EM,
  breakPoints,
  measureRich,
  symbolAdvance,
} from './text/symbols';

// The treatment these paint from is `@mtg/ui`'s `frameTreatment`, and it is not
// re-exported here: one fact, one export path (ADR-0002 §6.1).
export { frameDefs, frameIds, frameLayers, raritySeal } from './frame';
export type { FrameIds } from './frame';

export {
  ART_MANIFEST_VERSION,
  ART_PENDING_LABEL,
  ArtManifestSchema,
  CardArtSchema,
  NO_ART,
  artRegistry,
  parseArtManifest,
  pendingLabel,
  renderArtSlot,
} from './art';
export type { ArtManifest, ArtResolver, ArtSlotOptions, CardArtImage } from './art';

export {
  TEXT_REGIONS,
  footerText,
  renderFooter,
  renderLoyalty,
  renderPowerToughness,
  renderRules,
  renderTitle,
  renderTypeBar,
  typeBarSeal,
} from './regions';
export type { RegionFit, RenderContext, RenderedRegion, SealPlacement, TextRegion } from './regions';

export { renderCardSvg } from './render';
export type { CardRender, RenderOptions } from './render';

export { formatFitReport, renderSet, renderSetOrThrow } from './batch';
export type { FitFailureRecord, SetCardRender, SetRenderReport, SetRenderResult } from './batch';

export { OVERFLOW_EPSILON, checkSvgOverflow, inkRects, regionBoxes, symbolRects } from './overflow';
export type { InkRect, OverflowFinding } from './overflow';
