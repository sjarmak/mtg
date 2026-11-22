/**
 * Pixels in, pixels out, and nothing else on the module graph.
 *
 * `mtg-cax8`. This package exists so a browser bundle and an art pipeline can
 * share one PNG codec and one resampler: `@mtg/ui` stages a set's art into
 * `public/` and has to shrink it first, and it cannot reach the art pipeline for the
 * ops because that package carries `@mtg/data` and therefore `better-sqlite3`.
 * `./resample.ts` says the rest of it. Same extraction, same reason, as
 * `@mtg/image-cache`.
 *
 * It depends on nothing outside `node:zlib`, which is the property that makes
 * it takeable by both sides.
 */
export { PngError, decodePng, encodePng, isPng, pngSize } from './png';
export type { RasterImage } from './png';
export {
  DEFAULT_TRIM_COVERAGE,
  DEFAULT_TRIM_MAX_SHARE,
  DEFAULT_TRIM_TOLERANCE,
  ImageOpError,
  crop,
  downscale,
  imageAspect,
  insetCrop,
  trimUniformBorder,
} from './resample';
export type { CropRect, DownscaleOptions, InsetDepths, TrimOptions } from './resample';
