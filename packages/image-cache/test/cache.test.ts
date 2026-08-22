/**
 * The cache, without a network.
 *
 * The properties worth pinning are the ones a caller depends on and cannot see:
 * that a name is stable for a URL (or the cache never hits), that a hit costs no
 * request, and that a rescanned image — a new `?<timestamp>` on the same file —
 * is a miss rather than a stale hit. That last one is the whole reason the key
 * is the URL and not the card.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheImage, imageFileName, DEFAULT_IMAGE_CACHE_DIR } from '../src/index';

const BOLT = 'https://cards.scryfall.io/art_crop/front/a/b/bolt.jpg?1783920066';
const RESCANNED = 'https://cards.scryfall.io/art_crop/front/a/b/bolt.jpg?1799000000';

describe('naming a cached image', () => {
  it('is stable for a URL, so a second run is a hit', () => {
    expect(imageFileName(BOLT)).toBe(imageFileName(BOLT));
  });

  it('treats a rescanned image as a different file', () => {
    expect(imageFileName(BOLT)).not.toBe(imageFileName(RESCANNED));
  });

  it('keeps the extension, so a server infers the right content type', () => {
    expect(imageFileName(BOLT).endsWith('.jpg')).toBe(true);
    expect(imageFileName('https://x/y/z.png').endsWith('.png')).toBe(true);
    expect(imageFileName('https://x/y/z.webp').endsWith('.webp')).toBe(true);
  });

  it('falls back to .jpg for a URL with no extension it recognizes', () => {
    expect(imageFileName('https://x/y/z').endsWith('.jpg')).toBe(true);
  });

  it('keeps .svg, so a symbol served from the cache is not labeled a photograph', () => {
    // A dev server types the response from the extension it finds on disk. An
    // SVG saved as `.jpg` is served as `image/jpeg`, and a browser refuses to
    // paint it — the empty box this cache is being asked to prevent.
    expect(imageFileName('https://svgs.scryfall.io/card-symbols/T.svg').endsWith('.svg')).toBe(true);
    expect(imageFileName('https://x/y/z.svg?1783920066').endsWith('.svg')).toBe(true);
  });
});

describe('caching an image', () => {
  it('downloads and writes on a miss', async () => {
    const written: string[] = [];
    const result = await cacheImage(BOLT, {
      dir: '/tmp/mtg-image-cache-test',
      exists: () => false,
      write: (path) => written.push(path),
      download: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    });
    expect(result.fetched).toBe(true);
    expect(written).toEqual([result.path]);
    expect(result.path.endsWith(result.name)).toBe(true);
  });

  it('costs no request on a hit', async () => {
    const result = await cacheImage(BOLT, {
      dir: '/tmp/mtg-image-cache-test',
      exists: () => true,
      write: () => {
        throw new Error('should not write on a hit');
      },
      download: () => Promise.reject(new Error('should not download on a hit')),
    });
    expect(result.fetched).toBe(false);
  });

  it('throws on a failed download rather than writing a truncated file', async () => {
    const written: string[] = [];
    await expect(
      cacheImage(BOLT, {
        dir: '/tmp/mtg-image-cache-test',
        exists: () => false,
        write: (path) => written.push(path),
        download: () => Promise.reject(new Error('responded 404')),
      }),
    ).rejects.toThrow('responded 404');
    expect(written).toEqual([]);
  });

  /**
   * The key is the URL and the URL does not change when the network lies, so
   * anything written under it is believed forever. An empty 200 — a captive
   * portal, a filtering resolver, a proxy answering for a host it will not reach
   * — would otherwise be cached as that card's art and never refetched.
   */
  it('refuses to cache an empty body that answered 200', async () => {
    const written: string[] = [];
    await expect(
      cacheImage(BOLT, {
        dir: '/tmp/mtg-image-cache-test',
        exists: () => false,
        write: (path) => written.push(path),
        download: () => Promise.resolve(new Uint8Array(0)),
      }),
    ).rejects.toThrow('empty body');
    expect(written).toEqual([]);
  });

  it('leaves the cache holding the whole file under its name and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtg-image-cache-'));
    const bytes = new Uint8Array(4096).fill(7);
    await expect(
      cacheImage(BOLT, { dir, exists: () => false, download: () => Promise.resolve(bytes) }),
    ).resolves.toMatchObject({ fetched: true });
    expect(readdirSync(dir)).toEqual([imageFileName(BOLT)]);
    expect(readFileSync(join(dir, imageFileName(BOLT))).length).toBe(bytes.length);
  });

  it('caches beside the card store rather than under a package', () => {
    expect(DEFAULT_IMAGE_CACHE_DIR).toBe('data/images');
  });
});
