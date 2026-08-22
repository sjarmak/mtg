/**
 * The art slot, and the registry that fills it.
 *
 * The registry is the whole point of this file. `the prior-project reuse audit`
 * names the anti-pattern to avoid by name: a `CardArt.tsx` with about 120
 * hand-written static imports, one line per asset, which does not survive
 * contact with a 90-card set let alone a 250-card one. So art arrives as *data*
 * — a validated manifest keyed by card id — and the renderer takes a resolver
 * function. Nothing in this package imports an image, and adding art to a set
 * changes a JSON file rather than any TypeScript.
 *
 * A card with no entry is not an error and is not blank. It renders the
 * pending frame with `@mtg/ui`'s exact `ART_PENDING_LABEL` and the card's own
 * id, which is the governance rule ported from the prior project: an unfinished
 * surface announces itself, so a contact sheet of a set in progress is
 * self-describing and a missing render can never pass for a design choice.
 */
import { z } from 'zod';
import type { Card } from '@mtg/dsl';
import { ART_PENDING_LABEL } from '@mtg/ui';
import type { Box, CardGeometry } from './geometry';
import { el } from './svg';
import { fitLine } from './text/layout';
import { BOLD_WIDTH_FACTOR } from './text/metrics';
import { textRun } from './text/emit';
import type { FrameIds } from './frame';

export { ART_PENDING_LABEL };

export const ART_MANIFEST_VERSION = 2;

export const CardArtSchema = z.object({
  /** A URL or a `data:` URI. Data URIs keep a rendered file self-contained. */
  href: z.string().min(1),
  /** Describes the illustration, not the card; the card name is already text. */
  alt: z.string().min(1),
});

export type CardArtImage = z.infer<typeof CardArtSchema>;

export const ArtManifestSchema = z.object({
  formatVersion: z.literal(ART_MANIFEST_VERSION),
  /**
   * Card id to its illustrations, best-known first. Ids are DSL card ids, so the
   * join is exact; the list is non-empty because a card with no art has no entry.
   */
  art: z.record(z.string(), z.array(CardArtSchema).min(1)),
});

export type ArtManifest = z.infer<typeof ArtManifestSchema>;

/** Resolves art for a card, or `null` when none exists yet. */
export type ArtResolver = (card: Card) => CardArtImage | null;

/** Parses a manifest from disk or an API; throws with schema issues on bad input. */
export function parseArtManifest(input: unknown): ArtManifest {
  return ArtManifestSchema.parse(input);
}

/**
 * A resolver over a validated manifest. The data-driven registry.
 *
 * The first illustration, always. This package renders a card once — a contact
 * sheet, a printed proof — so there is no permanent to key a choice off and no
 * second copy to distinguish it from. Picking per object is the played table's
 * job and lives with the thing that has object ids (`@mtg/ui`'s `artResolver`).
 */
export function artRegistry(manifest: ArtManifest): ArtResolver {
  const byId = new Map(Object.entries(manifest.art));
  return (card) => byId.get(card.id)?.[0] ?? null;
}

/** The resolver used when a caller passes none: every card renders pending. */
export const NO_ART: ArtResolver = () => null;

/** Text of the pending note: the label plus the subject it is pending for. */
export function pendingLabel(subject: string): string {
  return `${ART_PENDING_LABEL} for ${subject}`;
}

export interface ArtSlotOptions {
  readonly geometry: CardGeometry;
  readonly ids: FrameIds;
  /** What the art is pending *for* — the card id. */
  readonly subject: string;
  readonly widthSafety?: number;
}

/** Renders the illustration clipped to the art window, or the pending frame. */
export function renderArtSlot(art: CardArtImage | null, options: ArtSlotOptions): string {
  const { geometry, ids } = options;
  const area = geometry.art;
  if (art !== null) {
    return el(
      'g',
      { class: 'art', 'data-region': 'art', 'data-art-state': 'ready', role: 'img', 'aria-label': art.alt },
      [
        el('image', {
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          href: art.href,
          preserveAspectRatio: 'xMidYMid slice',
          'clip-path': `url(#${ids.artClip})`,
        }),
        el('rect', {
          class: 'keyline',
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          rx: 6,
          'stroke-width': 1.2,
        }),
      ],
    );
  }
  return pendingFrame(area, options);
}

/** Extra tracking on the pending label, in user units per gap. */
const PENDING_TRACKING = 1.5;

/**
 * The window that says a card has no art yet.
 *
 * Its ground is the one surface on the face that did not take the card's
 * identity when the rest of the interior did: `palette.ts` pins
 * `.art[data-art-state='pending'] .well` back to `--mtg-surface-sunken`, because
 * what is printed here is a production notice in `--mtg-pending` amber rather
 * than the card's picture, and amber over a tinted well drops under 2.2:1. The
 * subject line beneath it is `ink-muted`, the same ink `@mtg/ui`'s
 * `.mtg-art__pending-note` uses, rather than the `ink-faint` it used to be.
 */
function pendingFrame(area: Box, options: ArtSlotOptions): string {
  const inner = area.width - options.geometry.textPadding * 2;
  const safety = options.widthSafety === undefined ? {} : { widthSafety: options.widthSafety };
  const trackingRoom = PENDING_TRACKING * Math.max(0, ART_PENDING_LABEL.length - 1);
  const labelFit = fitLine(
    ART_PENDING_LABEL,
    { maxWidth: inner - trackingRoom, maxSize: 34, minSize: 12 },
    { ...safety, boldFactor: BOLD_WIDTH_FACTOR },
  );
  const subjectFit = fitLine(options.subject, { maxWidth: inner, maxSize: 20, minSize: 7 }, safety);
  const labelSize = labelFit.ok ? labelFit.layout.fontSize : 12;
  const labelWidth = (labelFit.ok ? labelFit.layout.width : inner - trackingRoom) + trackingRoom;
  const subjectSize = subjectFit.ok ? subjectFit.layout.fontSize : 7;
  const centerX = area.x + area.width / 2;
  const centerY = area.y + area.height / 2;

  const inked: Box = {
    x: area.x + options.geometry.textPadding,
    y: area.y + options.geometry.textPadding,
    width: inner,
    height: area.height - options.geometry.textPadding * 2,
  };

  return el(
    'g',
    {
      class: 'art',
      'data-art-state': 'pending',
      role: 'img',
      'aria-label': pendingLabel(options.subject),
      'data-region': 'art',
      'data-box-x': inked.x,
      'data-box-y': inked.y,
      'data-box-w': inked.width,
      'data-box-h': inked.height,
    },
    [
      el('rect', {
        class: 'well',
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        rx: 6,
        'stroke-width': 1.2,
      }),
      el('rect', {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        rx: 6,
        fill: `url(#${options.ids.plateHatch})`,
        stroke: 'none',
        opacity: 0.9,
      }),
      textRun(ART_PENDING_LABEL, {
        className: 'meta-text pending-ink',
        x: centerX,
        y: centerY - 4,
        fontSize: labelSize,
        anchor: 'middle',
        boldFactor: BOLD_WIDTH_FACTOR,
        width: labelWidth,
        extra: { 'font-weight': 700, 'data-region': 'art' },
        ...safety,
      }),
      textRun(options.subject, {
        className: 'meta-text ink-muted',
        x: centerX,
        y: centerY + subjectSize * 1.6,
        fontSize: subjectSize,
        anchor: 'middle',
        extra: { 'data-region': 'art' },
        ...safety,
      }),
    ],
  );
}
