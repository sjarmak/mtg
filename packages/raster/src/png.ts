/**
 * A minimal PNG codec: decode to RGBA8, encode from RGBA8.
 *
 * This exists so the deterministic repair pass (`./ops`) can run with no new
 * third-party dependency — the prior project reached for `pngjs`, and this repo's
 * rule is to report a needed dependency rather than install one. Everything
 * here is `node:zlib` plus the PNG spec.
 *
 * Deliberately narrow: 8-bit, non-interlaced, color types 0, 2, 4 and 6. A
 * 16-bit, palettized or interlaced file raises a named error rather than being
 * quietly approximated, because a silent approximation in a repair pass is a
 * repair that damages.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** An image in memory: straight RGBA, 8 bits per channel, row-major. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes, R,G,B,A per pixel. */
  readonly data: Uint8Array;
}

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function readChunks(bytes: Uint8Array): readonly Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) {
      throw new PngError(`chunk ${type} claims ${length} bytes but the file ends first`);
    }
    chunks.push({ type, data: bytes.subarray(start, end) });
    offset = end + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the per-scanline filters in place, returning the raw sample bytes. */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    if (filter === undefined) throw new PngError(`scanline ${y} is missing its filter byte`);
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos + x];
      if (value === undefined) throw new PngError(`scanline ${y} ends ${stride - x} bytes early`);
      const a = x >= channels ? (out[rowStart + x - channels] ?? 0) : 0;
      const b = y > 0 ? (out[prevStart + x] ?? 0) : 0;
      const c = y > 0 && x >= channels ? (out[prevStart + x - channels] ?? 0) : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + ((a + b) >> 1);
          break;
        case 4:
          restored = value + paeth(a, b, c);
          break;
        default:
          throw new PngError(`scanline ${y} uses unknown filter type ${filter}`);
      }
      out[rowStart + x] = restored & 0xff;
    }
    pos += stride;
  }
  return out;
}

function toRgba(samples: Uint8Array, width: number, height: number, colorType: number): Uint8Array {
  const pixels = width * height;
  const data = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    switch (colorType) {
      case 0: {
        const g = samples[i] ?? 0;
        data[o] = g;
        data[o + 1] = g;
        data[o + 2] = g;
        data[o + 3] = 255;
        break;
      }
      case 2: {
        const s = i * 3;
        data[o] = samples[s] ?? 0;
        data[o + 1] = samples[s + 1] ?? 0;
        data[o + 2] = samples[s + 2] ?? 0;
        data[o + 3] = 255;
        break;
      }
      case 4: {
        const s = i * 2;
        const g = samples[s] ?? 0;
        data[o] = g;
        data[o + 1] = g;
        data[o + 2] = g;
        data[o + 3] = samples[s + 1] ?? 0;
        break;
      }
      default: {
        const s = i * 4;
        data[o] = samples[s] ?? 0;
        data[o + 1] = samples[s + 1] ?? 0;
        data[o + 2] = samples[s + 2] ?? 0;
        data[o + 3] = samples[s + 3] ?? 0;
        break;
      }
    }
  }
  return data;
}

/** True when the bytes carry the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < SIGNATURE.length) return false;
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * The dimensions in a PNG's header, without decoding the pixels.
 *
 * The IHDR is fixed at bytes 16 to 24 of any PNG, so a caller that only wants
 * to know how big a file is can read its first 33 bytes and skip inflating
 * megabytes of image data. `null` for anything that is not a PNG or is cut off
 * before the header ends, so a caller decides what to do about it rather than
 * catching.
 */
export function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function decodePng(bytes: Uint8Array): RasterImage {
  if (!isPng(bytes)) throw new PngError('not a PNG: signature missing');
  const chunks = readChunks(bytes);
  const header = chunks.find((chunk) => chunk.type === 'IHDR');
  if (header === undefined) throw new PngError('no IHDR chunk');
  if (header.data.length < 13) throw new PngError('IHDR is shorter than 13 bytes');

  const view = new DataView(header.data.buffer, header.data.byteOffset, header.data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = header.data[8] ?? 0;
  const colorType = header.data[9] ?? 0;
  const interlace = header.data[12] ?? 0;

  if (width === 0 || height === 0) throw new PngError(`degenerate size ${width}x${height}`);
  if (bitDepth !== 8) {
    throw new PngError(`bit depth ${bitDepth} is unsupported; this codec handles 8-bit only`);
  }
  if (interlace !== 0) {
    throw new PngError('interlaced PNG is unsupported; re-save the source progressive-off');
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined) {
    throw new PngError(
      `color type ${colorType} is unsupported; this codec handles 0, 2, 4 and 6 (palettized PNG must be expanded first)`,
    );
  }

  const idat = chunks.filter((chunk) => chunk.type === 'IDAT');
  if (idat.length === 0) throw new PngError('no IDAT chunk');
  const compressed = Buffer.concat(idat.map((chunk) => Buffer.from(chunk.data)));
  let raw: Buffer;
  try {
    raw = inflateSync(compressed);
  } catch (error: unknown) {
    throw new PngError(`IDAT stream did not inflate: ${String(error)}`);
  }
  const expected = (width * channels + 1) * height;
  if (raw.length < expected) {
    throw new PngError(`IDAT holds ${raw.length} bytes, ${expected} needed for ${width}x${height}`);
  }

  const samples = unfilter(raw, width, height, channels);
  return { width, height, data: toRgba(samples, width, height, colorType) };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/**
 * The scanlines, each under the filter that leaves deflate the least to do.
 *
 * `mtg-n0bn`. Every row was written under filter 0, which is the raw sample
 * bytes: correct, and the worst input a photographic image can hand a
 * general-purpose compressor. Measured over eight of the flagship set's staged
 * 640px art crops, deflate at level 9 took 5.0 MB of pixels to 5.0 MB of file.
 * The same eight under the heuristic below come to 3.4 MB.
 *
 * The heuristic is the one the PNG specification recommends and every encoder
 * uses: try all five filters on the row, sum each result as signed bytes, keep
 * the smallest sum. It is five passes per row rather than one, which is the
 * whole of what this costs.
 */
function filterRows(data: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const chosen = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prior = y === 0 ? null : data.subarray((y - 1) * stride, y * stride);
    let bestType = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let type = 0; type <= 4; type += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const left = i >= channels ? (row[i - channels] ?? 0) : 0;
        const up = prior === null ? 0 : (prior[i] ?? 0);
        const upLeft = prior === null || i < channels ? 0 : (prior[i - channels] ?? 0);
        const sample = row[i] ?? 0;
        let value = sample;
        if (type === 1) value = (sample - left) & 0xff;
        else if (type === 2) value = (sample - up) & 0xff;
        else if (type === 3) value = (sample - ((left + up) >> 1)) & 0xff;
        else if (type === 4) value = (sample - paeth(left, up, upLeft)) & 0xff;
        candidate[i] = value;
        // As a signed byte, which is what the specification's heuristic sums:
        // a filtered row is a row of small differences either side of zero.
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        chosen.set(candidate);
      }
    }
    out[y * (stride + 1)] = bestType;
    out.set(chosen, y * (stride + 1) + 1);
  }
  return out;
}

/**
 * RGB samples where every pixel is opaque, and null where one is not.
 *
 * `mtg-n0bn`. A channel that is 255 in every pixel is a quarter of the file
 * saying nothing. Every raster this package writes today is a photographic art
 * crop and all of them are opaque, but the check is on the pixels rather than on
 * that expectation: an image with a transparent corner keeps its alpha and comes
 * back byte for byte, which is the property `../test/raster.test.ts` asserts.
 */
function opaqueRgb(rgba: Uint8Array): Uint8Array | null {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return null;
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source] ?? 0;
    rgb[target + 1] = rgba[source + 1] ?? 0;
    rgb[target + 2] = rgba[source + 2] ?? 0;
  }
  return rgb;
}

/**
 * Encodes RGBA8 as a non-interlaced PNG, adaptively filtered, without an alpha
 * channel wherever the image has no transparency to carry.
 *
 * Color type 2 rather than 6 for an opaque image, since `mtg-n0bn`. Both are
 * read back through `decodePng` as RGBA, so nothing downstream can tell which
 * was written except by its size: the eight staged crops measured above come to
 * 3.1 MB under both changes against the 5.0 MB flat color-type-6 wrote.
 */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new PngError(
      `image data is ${data.length} bytes, ${width * height * 4} needed for ${width}x${height}`,
    );
  }
  const rgb = opaqueRgb(data);
  const channels = rgb === null ? 4 : 3;
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = rgb === null ? 6 : 2;

  const raw = filterRows(rgb ?? data, width, height, channels);
  const idat = deflateSync(Buffer.from(raw), { level: 9 });

  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(idat)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
