/**
 * The package's own boundary: what a caller that only has `@mtg/raster` can do.
 *
 * The operations themselves are covered card by card in the art pipeline's
 * `test/image.test.ts`, which builds PNGs byte by byte against an independent
 * forward implementation of the scanline filters. That suite still passes
 * through the art pipeline's re-exports, so it measures this code without knowing it
 * moved. What it cannot measure is the reason the package exists — that a
 * consumer with no art pipeline on its module graph can decode, shrink and
 * re-encode a raster — and that is what is asserted here (`mtg-cax8`).
 */
import { describe, expect, it } from 'vitest';
import { decodePng, downscale, encodePng, isPng } from '@mtg/raster';
import type { RasterImage } from '@mtg/raster';

function gradient(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      data[o] = (x * 7) % 256;
      data[o + 1] = (y * 11) % 256;
      data[o + 2] = 128;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * The same gradient with a hole in it, so the alpha channel carries something.
 *
 * One transparent pixel is the whole condition: `encodePng` drops the channel
 * only when every pixel is opaque, and a rule stated that way has to be tested
 * at its edge rather than on an image that is half see-through.
 */
function pierced(width: number, height: number): RasterImage {
  const image = gradient(width, height);
  image.data[3] = 0;
  return image;
}

/**
 * Smooth with noise on top, which is what a photograph is to a compressor.
 *
 * The plain gradient above is not: its rows repeat, so deflate finds them
 * whatever filter wrote them, and it would report a saving that a real art crop
 * does not get. The noise term is deterministic so the assertion is too.
 */
function photographic(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 4);
  let seed = 0x2f6e2b1;
  const noise = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return (seed >> 16) & 0x1f;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      data[o] = ((x * 255) / width + noise()) & 0xff;
      data[o + 1] = ((y * 255) / height + noise()) & 0xff;
      data[o + 2] = (((x + y) % 256) | 0) + noise();
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The IHDR color type, which is the ninth byte of the first chunk's data. */
function colorType(bytes: Uint8Array): number {
  return bytes[8 + 8 + 9] ?? -1;
}

describe('the raster package at its own boundary', () => {
  it('decodes what it encodes, byte for byte', () => {
    const image = gradient(37, 23);
    const bytes = encodePng(image);
    expect(isPng(bytes), 'the encoder writes a PNG signature').toBe(true);
    const back = decodePng(bytes);
    expect(back.width).toBe(image.width);
    expect(back.height).toBe(image.height);
    expect([...back.data]).toEqual([...image.data]);
  });

  // `mtg-n0bn`. The staged art bundle was 294 MB of color-type-6 PNG written
  // under filter 0, a median 656 KB for a 640x427 crop, and the alpha channel in
  // every one of them was 255 from corner to corner.
  it('drops an alpha channel no pixel is using, and keeps one that is', () => {
    const opaque = encodePng(gradient(37, 23));
    expect(colorType(opaque), 'an opaque image still carries an alpha channel').toBe(2);
    expect([...decodePng(opaque).data]).toEqual([...gradient(37, 23).data]);

    const holed = pierced(37, 23);
    const encoded = encodePng(holed);
    expect(colorType(encoded), 'a transparent pixel lost its channel').toBe(6);
    expect([...decodePng(encoded).data]).toEqual([...holed.data]);
  });

  // The other half of the same bead, and the half that is worth a number: under
  // filter 0 a photographic image comes out of deflate the size it went in --
  // the eight crops measured for that bead went 5.0 MB to 5.0 MB.
  it('writes a photograph smaller than its own pixels', () => {
    const image = photographic(256, 192);
    const bytes = encodePng(image);
    const pixels = image.width * image.height * 3;
    expect(bytes.length / pixels, 'the encoder is not compressing a photograph').toBeLessThan(0.85);
    expect([...decodePng(bytes).data]).toEqual([...image.data]);
  });

  it('shrinks a render to a stated longest edge, and does it the same way twice', () => {
    const image = gradient(2528, 1685);
    const small = downscale(image, { longestEdge: 640 });
    expect(small.width).toBe(640);
    expect(small.height).toBe(Math.round(1685 * (640 / 2528)));
    // Determinism is the property the staging pass depends on: a set staged
    // twice has to produce the same files, or every restage is a diff.
    const again = downscale(image, { longestEdge: 640 });
    expect([...again.data]).toEqual([...small.data]);
  });

  it('refuses to enlarge, because a blurred-up raster is not a picture', () => {
    expect(() => downscale(gradient(64, 64), { longestEdge: 128 })).toThrow('only shrinks');
  });
});
