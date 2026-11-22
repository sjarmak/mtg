import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { decodePng, downscale, encodePng, isPng, pngSize } from '@mtg/raster';

/**
 * The longest edge a staged illustration may have, in pixels.
 *
 * Exported because the test asserts against this number rather than restating
 * it, and because a launcher that wants to say what it did needs the budget it
 * applied.
 */
export const WEB_ART_LONGEST_EDGE = 640;
export const DEFAULT_WEB_RASTER_CACHE_DIR = 'data/cache/web-art';

const WEBP_QUALITY = 80;
const WEBP_COMPRESSION = 6;

export interface PublishWebRasterOptions {
  readonly cacheDir?: string;
}

export interface PublishedRaster {
  /** Bytes written to the served copy. */
  readonly bytes: number;
  /** Bytes the source held, so a caller can report what the pass saved. */
  readonly sourceBytes: number;
  readonly resized: boolean;
  readonly encoded: boolean;
  readonly reused: boolean;
  readonly outputPath: string;
}

export function webRasterOutputPath(from: string, to: string): string {
  return isPng(headerOf(from)) ? webpOutputPath(to) : to;
}

export function publishWebRaster(
  from: string,
  to: string,
  options: PublishWebRasterOptions = {},
): PublishedRaster {
  mkdirSync(dirname(to), { recursive: true });
  const header = headerOf(from);
  if (!isPng(header)) {
    copyFileSync(from, to);
    const bytes = statSync(from).size;
    return { bytes, sourceBytes: bytes, resized: false, encoded: false, reused: false, outputPath: to };
  }
  const dimensions = pngSize(header);
  const resized = dimensions !== null && Math.max(dimensions.width, dimensions.height) > WEB_ART_LONGEST_EDGE;
  const outputPath = webpOutputPath(to);
  if (options.cacheDir === undefined) {
    const standing = upToDate(from, outputPath, resized);
    if (standing !== null) return standing;
  } else {
    const cachePath = cachedOutputPath(from, options.cacheDir);
    const cached = useCachedRaster(from, cachePath, outputPath, resized);
    if (cached !== null) {
      if (to !== outputPath) rmSync(to, { force: true });
      return cached;
    }
  }
  const bytes = readFileSync(from);
  const source = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const image = decodePng(source);
  const requiresResize = Math.max(image.width, image.height) > WEB_ART_LONGEST_EDGE;
  const encoded = requiresResize
    ? encodePng(downscale(image, { longestEdge: WEB_ART_LONGEST_EDGE }))
    : source;
  const encodedPath = options.cacheDir === undefined ? outputPath : cachedOutputPath(from, options.cacheDir);
  mkdirSync(dirname(encodedPath), { recursive: true });
  encodeWebp(encoded, encodedPath);
  if (encodedPath !== outputPath) copyFileSync(encodedPath, outputPath);
  if (to !== outputPath) rmSync(to, { force: true });
  return {
    bytes: statSync(outputPath).size,
    sourceBytes: bytes.byteLength,
    resized: requiresResize,
    encoded: true,
    reused: false,
    outputPath,
  };
}

function cachedOutputPath(from: string, cacheDir: string): string {
  const source = statSync(from, { bigint: true });
  const key = createHash('sha256')
    .update(realpathSync(from))
    .update('\0')
    .update(source.size.toString())
    .update('\0')
    .update(source.mtimeNs.toString())
    .update('\0')
    .update(String(WEB_ART_LONGEST_EDGE))
    .update('\0')
    .update(String(WEBP_QUALITY))
    .update('\0')
    .update(String(WEBP_COMPRESSION))
    .digest('hex');
  return join(cacheDir, `${key}.webp`);
}

function useCachedRaster(
  from: string,
  cachePath: string,
  outputPath: string,
  resized: boolean,
): PublishedRaster | null {
  try {
    if (!validWebp(cachePath)) return null;
    copyFileSync(cachePath, outputPath);
    return {
      bytes: statSync(cachePath).size,
      sourceBytes: statSync(from).size,
      resized,
      encoded: false,
      reused: true,
      outputPath,
    };
  } catch {
    return null;
  }
}

function webpOutputPath(path: string): string {
  const extension = extname(path);
  return `${extension.length === 0 ? path : path.slice(0, -extension.length)}.webp`;
}

function headerOf(path: string): Uint8Array {
  const header = new Uint8Array(33);
  const handle = openSync(path, 'r');
  try {
    return header.subarray(0, readSync(handle, header, 0, header.length, 0));
  } finally {
    closeSync(handle);
  }
}

function encodeWebp(bytes: Uint8Array, outputPath: string): void {
  const partial = `${outputPath}.${String(process.pid)}.partial.webp`;
  try {
    const command = process.env.MTG_FFMPEG ?? 'ffmpeg';
    const result = spawnSync(
      command,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        '-c:v',
        'libwebp',
        '-quality',
        String(WEBP_QUALITY),
        '-compression_level',
        String(WEBP_COMPRESSION),
        partial,
      ],
      { input: bytes, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.error !== undefined) throw new Error(`could not run ${command} (${result.error.message})`);
    if (result.status !== 0) {
      throw new Error(`${command} could not encode ${outputPath} (${result.stderr.trim()})`);
    }
    renameSync(partial, outputPath);
  } finally {
    rmSync(partial, { force: true });
  }
}

function upToDate(from: string, outputPath: string, resized: boolean): PublishedRaster | null {
  try {
    const source = statSync(from);
    const served = statSync(outputPath);
    if (served.mtimeMs < source.mtimeMs) return null;
    if (!validWebp(outputPath)) return null;
    return {
      bytes: served.size,
      sourceBytes: source.size,
      resized,
      encoded: false,
      reused: true,
      outputPath,
    };
  } catch {
    return null;
  }
}

function validWebp(outputPath: string): boolean {
  const bytes = readFileSync(outputPath);
  const size = webpSize(bytes);
  return size !== null && Math.max(size.width, size.height) <= WEB_ART_LONGEST_EDGE;
}

function webpSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  if (bytes.length < 25 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return null;
  const riffSize = uint32(bytes, 4);
  const chunkSize = uint32(bytes, 16);
  if (
    riffSize === null ||
    chunkSize === null ||
    riffSize + 8 > bytes.length ||
    chunkSize + 20 > bytes.length
  ) {
    return null;
  }
  const chunk = ascii(bytes, 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { width: uint24(bytes, 24) + 1, height: uint24(bytes, 27) + 1 };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const first = bytes[21];
    const second = bytes[22];
    const third = bytes[23];
    const fourth = bytes[24];
    if (first === undefined || second === undefined || third === undefined || fourth === undefined)
      return null;
    return {
      width: 1 + first + ((second & 0x3f) << 8),
      height: 1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10),
    };
  }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff,
      height: ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff,
    };
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function uint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32(bytes: Uint8Array, offset: number): number | null {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  const fourth = bytes[offset + 3];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) return null;
  return (first | (second << 8) | (third << 16) | (fourth << 24)) >>> 0;
}
