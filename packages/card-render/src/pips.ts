/**
 * Mana pips, set into the printed face.
 *
 * Which pips a cost runs is `@mtg/ui`'s `anatomy.ts` (`costPips`), and what each
 * one looks like is its symbol registry — the pip names its token (`pipToken`)
 * and the registry says what that token is drawn as, which is the same two
 * steps a brace token in the rules box goes through. So a cost cannot read one
 * way on screen and another on paper (ADR-0002), and it cannot read one way in
 * the title bar and another in the rules box either: this file drew
 * `anatomy.ts`'s outline whatever `--symbols` said until the lab started
 * staging its symbols, which left one card holding two vocabularies.
 *
 * What this file owns is emission: scaling a glyph authored in the -50..50
 * square into a 15.5-unit disc, and setting the generic pip's numeral.
 *
 * That numeral is the one part of a pip the two faces do not share, for the
 * reason the ADR gives for all measured text: here it is auto-fitted against the
 * advance-width table and committed to a `textLength`, so `{15}` shrinks to fit
 * the disc instead of spilling, while the DOM face hands the same digits to a
 * browser that will reflow them.
 */
import type { ManaCost } from '@mtg/dsl';
import { formatManaCost } from '@mtg/dsl';
import {
  PIP_GLYPH_SCALE,
  PIP_GLYPH_STROKE,
  PIP_GLYPH_UNITS,
  PRINTED_SYMBOL_SET,
  costPips,
  pipArt,
  pipToken,
  symbolArt,
} from '@mtg/ui';
import type { PipGlyph, PipSpec, SymbolSet } from '@mtg/ui';
import { el, num } from './svg';
import { fitLine } from './text/layout';
import { textRun } from './text/emit';
import { BOLD_WIDTH_FACTOR } from './text/metrics';

export { costPips };
export type { PipSpec };

export interface PipRenderOptions {
  readonly radius: number;
  readonly gap: number;
  /** Center y of the run. */
  readonly centerY: number;
  /** Right edge the run is aligned to. */
  readonly right: number;
  readonly widthSafety?: number;
  /** Which drawing each pip is painted with. Absent takes the printed default. */
  readonly symbols?: SymbolSet;
}

/** Total width of a run of `count` pips at a given radius and gap. */
export function pipRunWidth(count: number, radius: number, gap: number): number {
  if (count <= 0) return 0;
  return count * radius * 2 + (count - 1) * gap;
}

/**
 * A drawn symbol, scaled out of the authoring square into a disc of `radius`
 * and centered on the origin. Exported because a symbol set into a line of
 * rules text (`./symbols.ts`) is the same drawing at a smaller radius, and two
 * scalings of one square are two chances to disagree about it.
 */
export function glyphMarkup(glyph: PipGlyph, radius: number): readonly string[] {
  const scale = (radius * PIP_GLYPH_SCALE) / PIP_GLYPH_UNITS;
  const children = [el('path', { class: 'pip-glyph', d: glyph.fill })];
  for (const line of glyph.lines) {
    children.push(
      el('path', {
        class: 'pip-glyph-line',
        d: line,
        'stroke-width': PIP_GLYPH_STROKE,
        'stroke-linecap': 'round',
      }),
    );
  }
  return [el('g', { transform: `scale(${num(scale)})` }, children)];
}

/** The auto-fitted numeral (or letter) inside a disc of `radius`, centered on the origin. */
export function genericMarkup(text: string, radius: number, widthSafety: number | undefined): string {
  const safety = widthSafety === undefined ? {} : { widthSafety };
  // A generic pip is a disc, so the usable width shrinks as the digit run grows
  // taller; 1.45r is the chord at the digit's cap height, not the diameter.
  const fit = fitLine(
    text,
    { maxWidth: radius * 1.45, maxSize: radius * 1.35, minSize: radius * 0.4, step: radius / 40 },
    { ...safety, boldFactor: BOLD_WIDTH_FACTOR },
  );
  const fontSize = fit.ok ? fit.layout.fontSize : radius * 0.4;
  return textRun(text, {
    className: 'pip-digit',
    x: 0,
    y: fontSize * 0.36,
    fontSize,
    anchor: 'middle',
    boldFactor: BOLD_WIDTH_FACTOR,
    ...safety,
  });
}

/**
 * What goes inside one pip's disc, from the registry.
 *
 * A referenced symbol draws its own disc, so it replaces the plate rather than
 * sitting on it — the same shape `./symbols.ts` emits for a referenced brace
 * token in the rules box, at the cost line's radius. A token the registry does
 * not state falls back to `pipArt`, which is the floor under a generic amount
 * larger than the registry's ceiling.
 */
function pipInner(
  pip: PipSpec,
  radius: number,
  set: SymbolSet,
  widthSafety: number | undefined,
): readonly string[] {
  const plate = el('circle', { class: 'pip-disc', cx: 0, cy: 0, r: radius, 'stroke-width': 1.4 });
  const art = symbolArt(pipToken(pip), set);
  if (art === null) {
    const drawn = pipArt(pip);
    return [
      plate,
      ...(drawn.kind === 'glyph'
        ? glyphMarkup(drawn.glyph, radius)
        : [genericMarkup(drawn.text, radius, widthSafety)]),
    ];
  }
  switch (art.kind) {
    case 'image':
      return [
        el('image', {
          x: -radius,
          y: -radius,
          width: radius * 2,
          height: radius * 2,
          href: art.href,
          'xlink:href': art.href,
        }),
      ];
    case 'drawn':
      return [plate, ...glyphMarkup(art.glyph, radius)];
    case 'lettered':
      return [plate, genericMarkup(art.text, radius, widthSafety)];
    default: {
      const never: never = art;
      throw new Error(`pips: unknown art kind ${String(never)}`);
    }
  }
}

/**
 * A whole cost as one accessible group, right-aligned on `options.right`.
 *
 * The group carries the printed cost as its accessible name exactly once, the
 * way `@mtg/ui` does it, so assistive tech hears `{1}{R}` rather than a stream
 * of disconnected shapes.
 */
export function renderCost(cost: ManaCost, options: PipRenderOptions): string {
  const pips = costPips(cost);
  const { radius, gap } = options;
  const width = pipRunWidth(pips.length, radius, gap);
  const startX = options.right - width + radius;
  const set = options.symbols ?? PRINTED_SYMBOL_SET;
  const children = pips.map((pip, index) => {
    const cx = startX + index * (radius * 2 + gap);
    const identity = pip.kind === 'color' ? pip.identity : 'generic';
    return el(
      'g',
      { class: 'pip', 'data-pip': identity, transform: `translate(${num(cx)} ${num(options.centerY)})` },
      pipInner(pip, radius, set, options.widthSafety),
    );
  });
  return el(
    'g',
    {
      class: 'mtg-cost',
      role: 'img',
      'aria-label': `Mana cost ${formatManaCost(cost)}`,
      'data-cost': formatManaCost(cost),
    },
    children,
  );
}
