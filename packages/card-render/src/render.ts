/**
 * One DSL card to one printed face.
 *
 * This module is the assembler: it resolves the geometry, the frame treatment
 * and the art, asks `regions.ts` to fit each rectangle of text, and stitches the
 * document together in paint order. The layout decisions all live next door.
 *
 * The contract is that a render never lies about a fit. Every region's result
 * comes back on the render — which region, at what size, in how many lines, and
 * when a region could not be fitted even at its minimum size, by how much it
 * missed. A caller that ignores the report still gets a readable card; a caller
 * that reads it gets to fail the build. Nothing is ever silently clipped.
 */
import type { Card } from '@mtg/dsl';
import {
  formatManaCost,
  isCastable,
  isCreature,
  isPlaneswalker,
  printedPowerToughness,
  renderTypeLine,
} from '@mtg/dsl';
import { faceAttributes, frameTreatment } from '@mtg/ui';
import type { SymbolSet } from '@mtg/ui';
import type { ArtResolver, CardArtImage } from './art';
import { NO_ART, renderArtSlot } from './art';
import { bleedGround, frameDefs, frameIds, frameLayers, trimMarks } from './frame';
import { bleedGeometry, cardGeometry } from './geometry';
import type { CardGeometry } from './geometry';
import { CARD_CLASS, cardStyleSheet } from './palette';
import type { CardTheme } from './palette';
import {
  renderFooter,
  renderLoyalty,
  renderPowerToughness,
  renderRules,
  renderTitle,
  renderTypeBar,
} from './regions';
import type { RegionFit, RenderContext } from './regions';
import { el, joinLines, num, styleEl, textEl } from './svg';

export interface RenderOptions {
  /** Where art comes from. Defaults to `NO_ART`: every card renders pending. */
  readonly art?: ArtResolver;
  /** Theme pinned into a standalone file. Defaults to `auto`. */
  readonly theme?: CardTheme;
  /**
   * Bleed in millimeters, for a file that will be printed and cut. Defaults to
   * 0, which is the screen document: exactly card-sized, no marks.
   */
  readonly bleedMm?: number;
  readonly geometry?: CardGeometry;
  /** Overrides the metrics allowance; see `text/metrics.ts`. */
  readonly widthSafety?: number;
  /** Embed the token + card stylesheet. Off when inlining into a styled page. */
  readonly embedStyles?: boolean;
  /** Prefix for `<defs>` ids. Defaults to the card id, which is already unique. */
  readonly scope?: string;
  /**
   * Which glyph set the rules box paints its brace tokens with. Defaults to
   * `@mtg/ui`'s registry default; `original` is the set with no third-party
   * artwork in it, which is what a file leaving this machine is published with.
   */
  readonly symbols?: SymbolSet;
}

export interface CardRender {
  readonly cardId: string;
  readonly svg: string;
  readonly fits: readonly RegionFit[];
  /** The subset of `fits` that could not be fitted. Empty means the card is fine. */
  readonly failures: readonly RegionFit[];
  readonly ok: boolean;
  /** Whether art was composited, for batch reporting. */
  readonly hasArt: boolean;
}

/** Renders one card to a standalone, self-describing SVG document. */
export function renderCardSvg(card: Card, options: RenderOptions = {}): CardRender {
  // `cardGeometry` rather than one constant: a planeswalker's frame is the same
  // stack with a shorter window and a taller rules box, because three or four
  // abilities do not go in a creature's box. An explicit `geometry` still wins,
  // which is what proof sheets and the bleed tests pass.
  const geometry = options.geometry ?? cardGeometry(card);
  const treatment = frameTreatment(card);
  const safety = options.widthSafety === undefined ? {} : { widthSafety: options.widthSafety };
  const context: RenderContext = {
    card,
    geometry,
    safety,
    ...(options.symbols === undefined ? {} : { symbols: options.symbols }),
  };
  const ids = frameIds(options.scope ?? card.id);
  const resolveArt: ArtResolver = options.art ?? NO_ART;
  const art: CardArtImage | null = resolveArt(card);

  const title = renderTitle(context);
  const typeBar = renderTypeBar(context);
  const rules = renderRules(context);
  const powerToughness = renderPowerToughness(context);
  const loyalty = renderLoyalty(context);
  const footer = renderFooter(context);

  const fits: RegionFit[] = [title.fit, typeBar.fit, rules.fit, footer.fit];
  if (powerToughness !== null) fits.push(powerToughness.fit);
  if (loyalty !== null) fits.push(loyalty.fit);

  const bleed = bleedGeometry(options.bleedMm ?? 0, geometry);

  const body: string[] = [
    frameDefs(treatment, geometry, ids),
    textEl('title', {}, `${card.name} — ${renderTypeLine(card)}`),
    options.embedStyles === false ? '' : styleEl(cardStyleSheet()),
    bleedGround(bleed),
    frameLayers(treatment, geometry, ids),
    title.markup,
    renderArtSlot(art, { geometry, ids, subject: card.id, ...safety }),
    typeBar.markup,
    rules.markup,
    footer.markup,
    powerToughness === null ? '' : powerToughness.markup,
    loyalty === null ? '' : loyalty.markup,
    trimMarks(bleed),
  ];

  const svg = el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      // The document is the card plus its bleed, and the viewBox origin goes
      // negative to pay for it. Every region keeps the coordinates it had at
      // zero bleed, which is why none of them had to be renumbered.
      width: `${num(bleed.widthMm)}mm`,
      height: `${num(bleed.heightMm)}mm`,
      viewBox: `${num(bleed.document.x)} ${num(bleed.document.y)} ${num(bleed.document.width)} ${num(bleed.document.height)}`,
      class: CARD_CLASS,
      role: 'img',
      'aria-label': ariaLabel(card),
      // The specification's own record, written verbatim. `Card.ts` writes the
      // same one, which is what lets the parity suite compare the two roots
      // instead of comparing each renderer against its own idea of the card.
      ...faceAttributes(card, treatment),
      ...(options.theme === undefined || options.theme === 'auto' ? {} : { 'data-theme': options.theme }),
    },
    [`\n${joinLines(body)}\n`],
  );

  const failures = fits.filter((fit) => fit.failure !== null);
  return {
    cardId: card.id,
    svg: `${svg}\n`,
    fits,
    failures,
    ok: failures.length === 0,
    hasArt: art !== null,
  };
}

/** What a screen reader hears: the whole card, once, in printed order. */
function ariaLabel(card: Card): string {
  const cost = isCastable(card) ? ` ${formatManaCost(card.manaCost)}` : '';
  const stats = isCreature(card)
    ? `, ${printedPowerToughness(card)}`
    : isPlaneswalker(card)
      ? `, Loyalty ${String(card.startingLoyalty)}`
      : '';
  return `${card.name}${cost}, ${renderTypeLine(card)}${stats}`;
}
