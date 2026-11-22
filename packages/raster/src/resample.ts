/**
 * Deterministic raster arithmetic: crop, trim, shrink.
 *
 * Split out of the art pipeline's `src/image/ops.ts` by `mtg-cax8`, and the reason is
 * a dependency arrow rather than tidiness. Staging a set's art for the web has
 * to shrink an 8 MB render before it is copied into `packages/ui/public`, and
 * `@mtg/ui` may not import the art pipeline: the art pipeline depends on `@mtg/data`, which
 * puts `better-sqlite3` on the browser's module graph, and the arrow in this
 * workspace runs the art pipeline -> `@mtg/ui` by design. So the pixel arithmetic
 * both of them need lives in a package that depends on nothing, the way
 * `@mtg/image-cache` was extracted for the same reason.
 *
 * What stayed behind is what needs an art *window* to decide: `cropToAspect`
 * and the repair pass read a style guide's `Aspect`, and a style guide is
 * the art pipeline's. What is here is arithmetic over a rectangle of pixels, which
 * needs nothing.
 *
 * Every operation is exact integer work except `downscale`, which averages, and
 * all of them are deterministic by construction: the same bytes in always
 * produce the same bytes out, which is what lets a repaired or staged raster be
 * committed and diffed.
 */
import type { RasterImage } from './png';

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class ImageOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageOpError';
  }
}

/** Copies a sub-rectangle. Bounds are checked; a bad rect is an error, not a clamp. */
export function crop(image: RasterImage, rect: CropRect): RasterImage {
  const { x, y, width, height } = rect;
  if (width <= 0 || height <= 0) {
    throw new ImageOpError(`crop size ${width}x${height} is degenerate`);
  }
  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) {
    throw new ImageOpError(
      `crop ${width}x${height}+${x}+${y} falls outside the ${image.width}x${image.height} image`,
    );
  }
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    out.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data: out };
}

/** Ratio of an image, width over height. */
export function imageAspect(image: RasterImage): number {
  return image.width / image.height;
}

function pixel(image: RasterImage, x: number, y: number): readonly [number, number, number] {
  const o = (y * image.width + x) * 4;
  return [image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0];
}

function within(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  tolerance: number,
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance
  );
}

export interface TrimOptions {
  /** Per-channel distance still counted as the same color. */
  readonly tolerance?: number;
  /** Largest share of a dimension a trim may remove before it is treated as a misread. */
  readonly maxShare?: number;
  /** Share of a border line that must match before the line counts as matte. */
  readonly coverage?: number;
}

export const DEFAULT_TRIM_TOLERANCE = 6;

/**
 * Largest share of a dimension a trim may remove before it is treated as a misread.
 *
 * A quarter refused the one shape this trim exists for. When a model paints a
 * *portrait* panel onto a landscape canvas it fills the rest with matte, and the
 * matte is then more than half the width by construction: one card of the
 * flagship set's 80 came back 2528 x 1685 carrying 671px of flat ground on the left and 666 on the right,
 * 53% of the width, so a quarter-share guard could never fire on it and the card
 * kept a painted pillarbox that reads exactly like a letterbox the renderer
 * added. Six tenths admits that shape and still refuses any reading that leaves
 * under 40% of a dimension standing. An over-trim is cheap here because
 * `cropToAspect` runs after: it costs a tight crop, not a misshapen raster.
 */
export const DEFAULT_TRIM_MAX_SHARE = 0.6;

/**
 * Share of a border line that has to match the matte before the line is matte.
 *
 * Not 1, and that is the whole difference between this trim firing and not. A
 * model that paints its own margin *paints* it, so the margin carries brush
 * texture and the occasional bristle reaching inward: across the flagship set's
 * 80 rasters not one border row was uniform to the pixel, and demanding that
 * took the worst of them down to a 15 x 10px trim of a margin that is really 35
 * to 49px deep. At nine tenths the same card trims 35/39/16/10 and the other 77
 * are untouched, which is the property that matters — the
 * corner-agreement gate below still decides *whether* to trim, and this only
 * decides how far.
 */
export const DEFAULT_TRIM_COVERAGE = 0.9;

/**
 * Removes a painted matte around the picture.
 *
 * The four corners have to agree on a color first — that is what distinguishes
 * "the model painted a border" from "the sky happens to be flat at the top".
 * That gate is deliberately tight and stays tight: widening it to 24 per channel
 * over the flagship set pulled in two cards with no matte at all, whose dark cave
 * walls happen to be flat at the frame, and cropped 21% and 6% of real illustration off them.
 *
 * A trim that would eat more than `maxShare` of a dimension is refused whole,
 * because at that point the reading is wrong and cropping on it would destroy
 * the illustration.
 */
export function trimUniformBorder(image: RasterImage, options: TrimOptions = {}): RasterImage {
  const tolerance = options.tolerance ?? DEFAULT_TRIM_TOLERANCE;
  const maxShare = options.maxShare ?? DEFAULT_TRIM_MAX_SHARE;
  const coverage = options.coverage ?? DEFAULT_TRIM_COVERAGE;
  if (coverage <= 0 || coverage > 1) {
    throw new ImageOpError(`trim coverage ${coverage} is not a share in (0, 1]`);
  }
  if (image.width < 3 || image.height < 3) return image;

  const corners = [
    pixel(image, 0, 0),
    pixel(image, image.width - 1, 0),
    pixel(image, 0, image.height - 1),
    pixel(image, image.width - 1, image.height - 1),
  ] as const;
  const reference = corners[0];
  if (!corners.every((corner) => within(corner, reference, tolerance))) return image;

  const rowIsMatte = (y: number): boolean => {
    let matching = 0;
    for (let x = 0; x < image.width; x += 1) {
      if (within(pixel(image, x, y), reference, tolerance)) matching += 1;
    }
    return matching >= image.width * coverage;
  };
  const colIsMatte = (x: number): boolean => {
    let matching = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (within(pixel(image, x, y), reference, tolerance)) matching += 1;
    }
    return matching >= image.height * coverage;
  };

  let top = 0;
  while (top < image.height && rowIsMatte(top)) top += 1;
  let bottom = image.height - 1;
  while (bottom > top && rowIsMatte(bottom)) bottom -= 1;
  let left = 0;
  while (left < image.width && colIsMatte(left)) left += 1;
  let right = image.width - 1;
  while (right > left && colIsMatte(right)) right -= 1;

  if (top >= image.height || left >= image.width) return image;
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width === image.width && height === image.height) return image;

  const removedX = (image.width - width) / image.width;
  const removedY = (image.height - height) / image.height;
  if (removedX > maxShare || removedY > maxShare) return image;

  return crop(image, { x: left, y: top, width, height });
}

export interface DownscaleOptions {
  /** Target size of the longer of the two dimensions, in pixels. */
  readonly longestEdge: number;
}

/**
 * Shrinks an image with a box filter: each destination pixel is the average of
 * the source pixels it covers. Shrink-only, and says so — a curation grid needs
 * a thumbnail, never a blurred-up enlargement standing in for a raster that was
 * never rendered at that size.
 *
 * Deterministic by construction: the source rectangle for each destination
 * pixel is fixed by its index (`Math.floor` on integer ratios, no accumulated
 * rounding across pixels), and each rectangle is summed in one fixed row-major
 * order, so the same bytes in always produce the same bytes out regardless of
 * engine or run.
 */
export function downscale(image: RasterImage, options: DownscaleOptions): RasterImage {
  const { longestEdge } = options;
  if (!Number.isFinite(longestEdge) || longestEdge <= 0) {
    throw new ImageOpError(`downscale target longest edge ${longestEdge} must be a positive number`);
  }
  if (image.width < 1 || image.height < 1) {
    throw new ImageOpError(`downscale source ${image.width}x${image.height} is degenerate`);
  }
  const sourceLongEdge = Math.max(image.width, image.height);
  if (longestEdge >= sourceLongEdge) {
    throw new ImageOpError(
      `downscale target longest edge ${longestEdge} is not smaller than the source's ${sourceLongEdge} ` +
        `(${image.width}x${image.height}); this op only shrinks`,
    );
  }

  const scale = longestEdge / sourceLongEdge;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8Array(width * height * 4);

  for (let dy = 0; dy < height; dy += 1) {
    const srcYStart = Math.floor((dy * image.height) / height);
    const srcYEnd = Math.max(srcYStart + 1, Math.floor(((dy + 1) * image.height) / height));
    for (let dx = 0; dx < width; dx += 1) {
      const srcXStart = Math.floor((dx * image.width) / width);
      const srcXEnd = Math.max(srcXStart + 1, Math.floor(((dx + 1) * image.width) / width));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = srcYStart; sy < srcYEnd; sy += 1) {
        for (let sx = srcXStart; sx < srcXEnd; sx += 1) {
          const o = (sy * image.width + sx) * 4;
          r += image.data[o] ?? 0;
          g += image.data[o + 1] ?? 0;
          b += image.data[o + 2] ?? 0;
          a += image.data[o + 3] ?? 0;
          count += 1;
        }
      }

      const outOffset = (dy * width + dx) * 4;
      out[outOffset] = Math.round(r / count);
      out[outOffset + 1] = Math.round(g / count);
      out[outOffset + 2] = Math.round(b / count);
      out[outOffset + 3] = Math.round(a / count);
    }
  }

  return { width, height, data: out };
}

/** Pixels to remove from each side. Every field is required; 0 means "keep this edge". */
export interface InsetDepths {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Cuts a stated number of pixels off each side.
 *
 * The third repair, and the one `trimUniformBorder` above cannot be: a painterly
 * vignette is consistent in color and *ragged in depth*, so there is no row that
 * is entirely matte and the trim's inward walk stops at zero. `detectVignette`
 * measures that raggedness as a quantile per edge and this cuts on the number it
 * hands over. The two functions are split for a reason worth stating: measuring
 * is arithmetic over pixels and cutting is arithmetic over a rectangle, and the
 * depth between them is **a parameter rather than a constant** because the
 * decision is the user's. Her instruction on this lane was verbatim, "Show me
 * before/after first: crop one card at a couple of depths, put the results in the
 * grid next to the original, and let me pick the depth. Nothing becomes canonical
 * until I have looked at it." A function that baked the measured depth in would
 * have no way to offer the shallower candidate she is choosing against.
 *
 * Exact integer crop, no resampling, like every other op in this module, so a
 * candidate raster staged twice is the same bytes twice and the curation grid's
 * content hashes stay stable.
 *
 * A depth that would leave nothing standing is an error rather than a clamp. A
 * clamp here would silently return a 1px sliver as though it were a repair, and
 * the caller that asked for it has a bug in its depth arithmetic that a thrown
 * `ImageOpError` names on the spot.
 */
export function insetCrop(image: RasterImage, depths: InsetDepths): RasterImage {
  const sides = [depths.top, depths.bottom, depths.left, depths.right];
  if (sides.some((side) => !Number.isInteger(side) || side < 0)) {
    throw new ImageOpError(
      `inset depths ${sides.join('/')} must be non-negative integers (top/bottom/left/right)`,
    );
  }
  const width = image.width - depths.left - depths.right;
  const height = image.height - depths.top - depths.bottom;
  if (width <= 0 || height <= 0) {
    throw new ImageOpError(
      `inset of ${sides.join('/')} leaves ${width}x${height} of a ${image.width}x${image.height} image`,
    );
  }
  if (width === image.width && height === image.height) return image;
  return crop(image, { x: depths.left, y: depths.top, width, height });
}
