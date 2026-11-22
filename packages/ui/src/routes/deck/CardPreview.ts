/**
 * A whole card face, floating beside whatever the reader is pointing at.
 *
 * `mtg-nyeo`. The builder draws its collection at a size that fits a lot of
 * cards on the screen at once, which is the point of it, and a compact face has
 * no rules box. So there has to be a way to read one card in full without the
 * grid drawing every card at reading size. the playtester: "Selecting or hovering a
 * card should make the full card readable without forcing the browser grid to
 * use enormous card sizes. A floating preview, dedicated preview region, or
 * contextual enlargement is fine."
 *
 * Floating, not a region, and the precedent is on this surface already. The
 * draft route gives a card panel a permanent 280px of a 1440x900 window, 19% of
 * it, and the playtester's complaint about that panel is quoted in
 * `../draft/DraftPack.ts`: it "consumes space without consistently providing
 * value". The whole subject of this bead's parent is that this screen has no
 * space to spare, so the preview costs none: it is `position: fixed`, it is
 * drawn only while something is being pointed at or focused, and it is
 * `pointer-events: none`, so it can never be the thing the next click lands on.
 *
 * # Where it goes
 *
 * Beside the pointer, on whichever side has room, clamped so no edge of it
 * leaves the window. `previewPlacement` is that arithmetic and is a pure
 * function of four rectangles, which is what lets it be checked without a
 * browser. It never covers the thing it describes: the horizontal flip is
 * decided by the room on the right, so the preview sits away from the pointer
 * rather than under it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { CARD_TRIM_MM, READING_FACE_WIDTH_REM } from '@mtg/card-geometry';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../../card/Card';
import type { CardArt } from '../../card/ArtSlot';

/** The preview's own width, in rem: a readable face, which is what it is for. */
export const PREVIEW_WIDTH_REM = READING_FACE_WIDTH_REM;

/** How far the preview keeps from the pointer, and from the window's edges. */
export const PREVIEW_GAP_PX = 16;

/** What the reader is pointing at, and where. Window coordinates. */
export interface PreviewAnchor {
  readonly card: DslCard;
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the preview is drawn for a pointer at `at` in a window of `viewport`.
 *
 * To the right of the pointer when the window has room for the whole face
 * there, and to the left otherwise. Vertically it is centered on the pointer and
 * then clamped, so a card pointed at near the bottom of a tall pane draws its
 * whole face rather than the top two thirds of it.
 *
 * A viewport too small to hold the preview at all clamps to the top-left corner
 * rather than going negative, which is the honest answer: the face is cut by the
 * window, and it is cut at the edge a reader can scroll rather than at one they
 * cannot reach.
 */
export function previewPlacement(at: Placement, viewport: Box, size: Box): Placement {
  const rightOf = at.left + PREVIEW_GAP_PX;
  const leftOf = at.left - PREVIEW_GAP_PX - size.width;
  const fitsRight = rightOf + size.width + PREVIEW_GAP_PX <= viewport.width;
  const left = fitsRight ? rightOf : Math.max(PREVIEW_GAP_PX, leftOf);
  const wanted = at.top - size.height / 2;
  const lowest = viewport.height - size.height - PREVIEW_GAP_PX;
  const top = Math.max(PREVIEW_GAP_PX, Math.min(wanted, lowest));
  return { left: Math.max(PREVIEW_GAP_PX, left), top };
}

/** The preview's drawn size at a given root font size, from the card's own trim. */
export function previewSize(rootPx: number): Box {
  const width = PREVIEW_WIDTH_REM * rootPx;
  return { width, height: (width * CARD_TRIM_MM.height) / CARD_TRIM_MM.width };
}

/**
 * The window's size, or `null` where there is no window.
 *
 * Runtime-checked for `./local-store.ts`'s first reason: the workspace tsconfig
 * has no `lib: dom`, so `window` is not a name this file may assume. `null` is
 * an ordinary answer -- a server render and the Node test rigs both give it --
 * and the caller's response is to draw no preview, which is what a page with no
 * pointer wants anyway.
 */
export function readViewport(): Box | null {
  const host = globalThis as { readonly innerWidth?: unknown; readonly innerHeight?: unknown };
  const { innerWidth, innerHeight } = host;
  if (typeof innerWidth !== 'number' || typeof innerHeight !== 'number') return null;
  return { width: innerWidth, height: innerHeight };
}

/** The default root font size, used where the document cannot be measured. */
export const ROOT_FONT_PX = 16;

/**
 * The root font size, so a reader who has scaled their type gets a preview that
 * scales with it. `ROOT_FONT_PX` where the document cannot be read.
 */
export function readRootPx(): number {
  const host = globalThis as {
    readonly getComputedStyle?: (element: unknown) => { readonly fontSize?: string };
    readonly document?: { readonly documentElement?: unknown };
  };
  const root = host.document?.documentElement;
  if (typeof host.getComputedStyle !== 'function' || root === undefined) return ROOT_FONT_PX;
  const size = Number.parseFloat(host.getComputedStyle(root).fontSize ?? '');
  return Number.isFinite(size) && size > 0 ? size : ROOT_FONT_PX;
}

export interface CardPreviewProps {
  readonly anchor: PreviewAnchor;
  readonly art: CardArt | null;
  /** The window, so the placement can be computed without reading globals here. */
  readonly viewport: Box;
  readonly rootPx: number;
}

export interface FloatingCardPreviewProps {
  readonly at: Placement;
  readonly viewport: Box;
  readonly rootPx: number;
  readonly children?: ReactElement;
  /**
   * Whether the preview holds a control a reader may reach. The shell is
   * `aria-hidden` for the reason `CardPreview` gives, and a hidden button is
   * a button a screen reader cannot press, so a preview with a face-flip in
   * it says so and is announced.
   */
  readonly interactive?: boolean;
}

/**
 * The shared inert preview shell for card representations other than DSL cards.
 *
 * Printed cards use the same card face in the Limited builder, but their source
 * record is deliberately not coerced into a generated DSL card. Keeping the
 * placement shell representation-neutral lets both builders share the one
 * overlay without weakening that boundary.
 */
export function FloatingCardPreview(props: FloatingCardPreviewProps): ReactElement {
  const size = previewSize(props.rootPx);
  const at = previewPlacement(props.at, props.viewport, size);
  return createElement(
    'div',
    {
      className: 'mtg-cardpeek',
      ...(props.interactive === true ? {} : { 'aria-hidden': true }),
      style: { left: `${String(Math.round(at.left))}px`, top: `${String(Math.round(at.top))}px` },
    },
    props.children,
  );
}

/**
 * The floating face.
 *
 * `aria-hidden`, and deliberately: the card it is showing is the card the
 * reader's own focus or pointer is already on, and that element states its whole
 * name (`../../card/Card.ts`'s `faceAccessibleName`). Announcing the face twice
 * would make every move through the collection read two cards.
 */
export function CardPreview(props: CardPreviewProps): ReactElement {
  return createElement(
    FloatingCardPreview,
    {
      at: { left: props.anchor.x, top: props.anchor.y },
      viewport: props.viewport,
      rootPx: props.rootPx,
    },
    createElement(Card, { card: props.anchor.card, size: 'full', art: props.art }),
  );
}
