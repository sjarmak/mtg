/**
 * The frame: original geometry, driven entirely by card data.
 *
 * Three things vary, and all three are read off `@mtg/ui`'s `frameTreatment`
 * rather than worked out here. The derivation is the face specification's; only
 * the painting below is this file's, and the two are separated because they
 * drifted while they were not:
 *
 *  * **Color identity** picks the frame tokens, so a card can never be blue in
 *    the browser and gold in a print sheet.
 *  * **Multicolor** is not just the gold identity *here*: the border ring is
 *    painted with a gradient across the card's actual colors, so a UR card
 *    reads as blue-red at a glance in a draft pile instead of as one more gold
 *    card. That is a decision about a 63 mm card with no hover and no zoom, and
 *    the web face deliberately does not copy it (ADR-0002 §2.2).
 *  * **Artifact** overlays a plate hatch on the frame. Artifact creatures carry
 *    their color identity *and* the hatch, which is the honest rendering of a
 *    card that is both. The web face marks the same fact a different way, for
 *    the reason recorded beside its rule.
 *
 * No Wizards frame asset is copied, traced, or measured off a scan; the
 * arrangement is the generic one every trading card has used for ninety years
 * and the drawing is ours (ADR-0001 section 5.6).
 */
import type { Rarity } from '@mtg/dsl';
import { setSealPath } from '@mtg/ui';
import type { FrameTreatment } from '@mtg/ui';
import type { BleedGeometry, Box, CardGeometry } from './geometry';
import { el, num } from './svg';

/** Ids of the defs a face declares, namespaced per card so pages can inline many. */
export interface FrameIds {
  readonly artClip: string;
  readonly borderGradient: string;
  readonly plateHatch: string;
}

export function frameIds(scope: string): FrameIds {
  return {
    artClip: `${scope}-art-clip`,
    borderGradient: `${scope}-border`,
    plateHatch: `${scope}-plate`,
  };
}

/** `<defs>` content: the art clip, the multicolor ramp and the plate hatch. */
export function frameDefs(treatment: FrameTreatment, geometry: CardGeometry, ids: FrameIds): string {
  const defs: string[] = [
    el('clipPath', { id: ids.artClip }, [
      el('rect', {
        x: geometry.art.x,
        y: geometry.art.y,
        width: geometry.art.width,
        height: geometry.art.height,
        rx: 6,
      }),
    ]),
  ];

  if (treatment.colors.length > 1) {
    const stops = treatment.colors.map((color, index) =>
      el('stop', {
        offset: `${num((index / (treatment.colors.length - 1)) * 100)}%`,
        'stop-color': `var(--mtg-color-${color.toLowerCase()})`,
      }),
    );
    defs.push(
      el('linearGradient', { id: ids.borderGradient, x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, stops),
    );
  }

  // Always declared, not only for artifacts: the pending art frame uses the
  // same hatch, and a card can be pending and non-artifact at the same time.
  defs.push(
    el(
      'pattern',
      {
        id: ids.plateHatch,
        width: 16,
        height: 16,
        patternUnits: 'userSpaceOnUse',
        patternTransform: 'rotate(45)',
      },
      [el('path', { class: 'hatch-line', d: 'M 0 0 V 16', 'stroke-width': 3 })],
    ),
  );

  return el('defs', {}, defs);
}

function roundedRect(area: Box, radius: number, attrs: Record<string, string | number>): string {
  return el('rect', {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    rx: radius,
    ...attrs,
  });
}

/**
 * The ink that runs past the cut, drawn before anything else.
 *
 * A square of the card's own ground covering the whole document, bleed
 * included. It exists so the blade never meets unprinted paper: the rounded
 * ground above leaves the four corners of the sheet bare, and a cut that drifts
 * outward anywhere along an edge would otherwise show a white hairline. Square
 * rather than rounded on purpose — the rounded corner is something the knife
 * makes, not something the printer draws.
 *
 * Returns nothing at all when there is no bleed, so a screen-sized card carries
 * no extra element and the two documents differ only where they must.
 */
export function bleedGround(bleed: BleedGeometry): string {
  if (bleed.bleed <= 0) return '';
  return el('rect', {
    class: 'frame-bleed',
    x: bleed.document.x,
    y: bleed.document.y,
    width: bleed.document.width,
    height: bleed.document.height,
    fill: 'var(--frame)',
    stroke: 'none',
  });
}

/**
 * Corner marks showing where to cut, drawn only in the margin the cut removes.
 *
 * Each mark is two hairlines running outward from a trim corner into the bleed,
 * stopping short of the corner itself so nothing crosses the finished card. A
 * mark that touched the trim would survive on any cut that fell even slightly
 * outside it, which is the one thing a cut mark must never do.
 */
export function trimMarks(bleed: BleedGeometry): string {
  if (bleed.bleed <= 0) return '';
  const gap = Math.min(bleed.bleed / 3, 10);
  const reach = bleed.bleed - gap;
  if (reach <= 0) return '';
  const { x, y, width, height } = bleed.trim;
  const right = x + width;
  const bottom = y + height;
  const segments: string[] = [];
  for (const [cx, dx] of [
    [x, -1],
    [right, 1],
  ] as const) {
    for (const [cy, dy] of [
      [y, -1],
      [bottom, 1],
    ] as const) {
      segments.push(`M ${cx + dx * gap} ${cy} H ${cx + dx * (gap + reach)}`);
      segments.push(`M ${cx} ${cy + dy * gap} V ${cy + dy * (gap + reach)}`);
    }
  }
  return el('path', {
    class: 'trim-mark',
    d: segments.join(' '),
    fill: 'none',
    stroke: 'var(--mtg-ink)',
    'stroke-width': 1,
  });
}

/**
 * The frame body: card ground, the colored border ring, and the printed-area
 * well the panels sit in. Drawn back to front.
 */
export function frameLayers(treatment: FrameTreatment, geometry: CardGeometry, ids: FrameIds): string {
  const layers: string[] = [
    roundedRect(geometry.card, geometry.cornerRadius, { class: 'frame', 'stroke-width': 2 }),
  ];

  if (treatment.artifact) {
    layers.push(
      roundedRect(geometry.card, geometry.cornerRadius, {
        fill: `url(#${ids.plateHatch})`,
        stroke: 'none',
      }),
    );
  }

  const ringInset = geometry.ringInset;
  const ring: Box = {
    x: ringInset,
    y: ringInset,
    width: geometry.card.width - ringInset * 2,
    height: geometry.card.height - ringInset * 2,
  };
  layers.push(
    roundedRect(ring, geometry.cornerRadius - ringInset, {
      fill: 'none',
      stroke: treatment.colors.length > 1 ? `url(#${ids.borderGradient})` : 'var(--edge)',
      'stroke-width': geometry.ringWidth,
    }),
  );

  const wellPadding = 6;
  const well: Box = {
    x: geometry.title.x - wellPadding,
    y: geometry.title.y - wellPadding,
    width: geometry.title.width + wellPadding * 2,
    height: geometry.footer.y + geometry.footer.height + wellPadding - (geometry.title.y - wellPadding),
  };
  layers.push(roundedRect(well, 10, { class: 'keyline', 'stroke-width': 1.2 }));

  return el('g', { class: 'frame-layers' }, layers);
}

/**
 * The set symbol, in the rarity's ink.
 *
 * One shape for the whole set and the rarity carried by the color, which is the
 * convention a printed Magic card has used since Exodus and replaces a
 * shape-per-rarity map that also had to be looked up. The outline is
 * `@mtg/ui`'s and takes a set code rather than a rarity; `palette.ts` resolves
 * the ink from the specification's `RARITY_SEAL_INK` off the `data-rarity`
 * written here, so the printed seal and the on-screen seal are one drawing in
 * one color rather than two of each that happen to match. Both attributes are
 * published for the same reason the face publishes its identity: a proof sheet
 * and the parity suite read the mark back off the markup instead of trusting
 * that the right one was asked for.
 *
 * No `stroke-width`, and `palette.ts` no longer gives the seal a stroke either.
 * A keyline in `--edge` was a hairline against a trisigil and is a third of the
 * stroke weight of a wordmark drawn in the same box, so one absolute number
 * cannot serve both marks — and it never had to: `RARITY_SEAL_INK` clears 3:1
 * against every panel of every identity in both palettes
 * (`packages/ui/test/card-surfaces.test.ts`), so the mark is legible as its own
 * ink and the keyline was only ever adding weight the contrast gate does not
 * measure.
 */
export function raritySeal(code: string, rarity: Rarity, cx: number, cy: number, radius: number): string {
  return el('path', {
    class: 'seal',
    'data-set': code,
    'data-rarity': rarity,
    d: setSealPath(code, cx, cy, radius),
  });
}
