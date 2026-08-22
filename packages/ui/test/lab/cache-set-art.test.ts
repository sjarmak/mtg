/**
 * Pulling a manifest's remote illustrations onto this page's own origin.
 *
 * The property the feature exists for: after this runs, a viewer who cannot
 * reach the host the manifest named still sees the art, because the page serves
 * it. The one that keeps it honest: a fetch that fails leaves that entry's URL
 * alone and is reported, so the outcome is the state that existed before this
 * ran rather than a broken image.
 *
 * Neither the network nor the shared cache is touched: `cache` and `publish`
 * are injected, and the only disk this writes is a temporary directory.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readArtManifest } from '../../src/lab/art-manifest';
import type { ArtManifest } from '../../src/lab/art-manifest';
import { cacheRemoteSetArt } from '../../tools/stage-set-art';
import type { CacheSetArtOptions } from '../../tools/stage-set-art';

function manifestOf(art: Readonly<Record<string, readonly string[]>>): ArtManifest {
  const variants = Object.fromEntries(
    Object.entries(art).map(([id, hrefs]) => [
      id,
      hrefs.map((href, index) => ({ href, alt: `${id} illustration ${String(index + 1)}` })),
    ]),
  );
  const parsed = readArtManifest({ formatVersion: 2, art: variants }, 'test');
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.manifest;
}

/** A cache that answers every URL, recording which ones it was asked for. */
function harness(
  overrides: Partial<CacheSetArtOptions> = {},
): CacheSetArtOptions & { readonly asked: string[]; readonly published: string[] } {
  const asked: string[] = [];
  const published: string[] = [];
  return {
    cacheDir: mkdtempSync(join(tmpdir(), 'mtg-cache-')),
    publicDir: mkdtempSync(join(tmpdir(), 'mtg-public-')),
    cache: (url) => {
      asked.push(url);
      const name = `${String(asked.length)}.jpg`;
      return Promise.resolve({ path: `/cache/${name}`, name, fetched: true, bytes: 1 });
    },
    publish: (from, to) => published.push(`${from} -> ${to}`),
    asked,
    published,
    ...overrides,
  };
}

describe('cacheRemoteSetArt', () => {
  it('rewrites every remote href to a path this page serves', async () => {
    const options = harness();
    const result = await cacheRemoteSetArt(
      manifestOf({ a: ['https://example.test/one.jpg'], b: ['https://example.test/two.jpg'] }),
      options,
    );

    expect(result.fetched).toBe(2);
    expect(result.reused).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.manifest.art['a']?.[0]?.href).toBe('art/1.jpg');
    expect(result.manifest.art['b']?.[0]?.href).toBe('art/2.jpg');
  });

  it('asks for each distinct URL once, however many cards name it', async () => {
    const options = harness();
    const shared = 'https://example.test/shared.jpg';
    const result = await cacheRemoteSetArt(manifestOf({ a: [shared], b: [shared] }), options);

    expect(options.asked).toEqual([shared]);
    expect(result.manifest.art['a']?.[0]?.href).toBe(result.manifest.art['b']?.[0]?.href);
  });

  it('leaves a path already on this disk alone, and a data URI with it', async () => {
    const options = harness();
    const inline = 'data:image/png;base64,AAAA';
    const result = await cacheRemoteSetArt(manifestOf({ a: ['art/local.png'], b: [inline] }), options);

    expect(options.asked).toEqual([]);
    expect(result.fetched).toBe(0);
    expect(result.manifest.art['a']?.[0]?.href).toBe('art/local.png');
    expect(result.manifest.art['b']?.[0]?.href).toBe(inline);
  });

  it('counts a cache hit apart from a download', async () => {
    const options = harness({
      cache: (url) => Promise.resolve({ path: `/cache/${url}`, name: 'kept.jpg', fetched: false, bytes: 1 }),
    });
    const result = await cacheRemoteSetArt(manifestOf({ a: ['https://example.test/one.jpg'] }), options);

    expect(result.fetched).toBe(0);
    expect(result.reused).toBe(1);
  });

  it('keeps the URL and names the card when a fetch fails', async () => {
    const options = harness({ cache: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    const href = 'https://example.test/one.jpg';
    const result = await cacheRemoteSetArt(manifestOf({ a: [href] }), options);

    expect(result.manifest.art['a']?.[0]?.href).toBe(href);
    expect(result.failures).toEqual(['a: getaddrinfo ENOTFOUND']);
  });

  it('keeps each illustration of a card that has several', async () => {
    const options = harness();
    const result = await cacheRemoteSetArt(
      manifestOf({ a: ['https://example.test/one.jpg', 'https://example.test/two.jpg'] }),
      options,
    );

    expect(result.manifest.art['a']?.map((entry) => entry.href)).toEqual(['art/1.jpg', 'art/2.jpg']);
    expect(result.manifest.art['a']?.map((entry) => entry.alt)).toEqual([
      'a illustration 1',
      'a illustration 2',
    ]);
  });
});
