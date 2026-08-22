/**
 * Staging the rules-text symbols, without touching the network or the disk.
 *
 * The property that matters is the one the feature exists for: after a staging
 * run the page draws every symbol, whether or not the machine could reach
 * anything. So there are exactly two outcomes and the test pins both — a
 * complete local set, or the drawn set and a sentence saying why.
 *
 * Partial is the outcome that must not exist. Twenty-eight files staged and one
 * missing would draw twenty-eight symbols and one empty box, which is the bug
 * this replaces rather than a degraded version of the fix.
 */
import { describe, expect, it } from 'vitest';
import type { CachedImage } from '@mtg/image-cache';
import { SCRYFALL_SYMBOL_BASE, SYMBOL_TOKENS } from '../../src/card/symbols';
import { stageSymbols } from '../../tools/stage-symbols';
import type { StageSymbolsOptions } from '../../tools/stage-symbols';

interface Recorder {
  readonly requested: string[];
  readonly published: string[];
}

function harness(recorder: Recorder, overrides: Partial<StageSymbolsOptions> = {}): StageSymbolsOptions {
  return {
    cacheDir: '/tmp/cache',
    publicDir: '/tmp/public/symbols',
    cache: (url) => {
      recorder.requested.push(url);
      return Promise.resolve<CachedImage>({
        name: 'cached.svg',
        path: '/tmp/cache/cached.svg',
        fetched: true,
      });
    },
    publish: (_from, to) => recorder.published.push(to),
    ...overrides,
  };
}

function recorder(): Recorder {
  return { requested: [], published: [] };
}

describe('staging every rules-text symbol', () => {
  it('asks for one file per token and serves it under the token name', async () => {
    const seen = recorder();
    const staged = await stageSymbols(harness(seen));

    expect(seen.requested).toEqual(SYMBOL_TOKENS.map((token) => `${SCRYFALL_SYMBOL_BASE}${token}.svg`));
    // Named for the token rather than for the URL digest: the registry's href
    // is a function of the token alone, so the page needs no manifest to find
    // the file the way it needs one for a card's illustration.
    expect(seen.published).toEqual(SYMBOL_TOKENS.map((token) => `/tmp/public/symbols/${token}.svg`));
    expect(staged.set).toBe('local');
    expect(staged.fetched).toBe(SYMBOL_TOKENS.length);
    expect(staged.failures).toEqual([]);
  });

  it('costs no request when the shared cache already has them', async () => {
    const seen = recorder();
    const staged = await stageSymbols(
      harness(seen, {
        cache: (url) => {
          seen.requested.push(url);
          return Promise.resolve<CachedImage>({
            name: 'cached.svg',
            path: '/tmp/cache/cached.svg',
            fetched: false,
          });
        },
      }),
    );
    expect(staged.reused).toBe(SYMBOL_TOKENS.length);
    expect(staged.fetched).toBe(0);
    expect(staged.set).toBe('local');
  });
});

describe('a machine that cannot reach the host', () => {
  it('falls back to the drawn set rather than to a page of empty boxes', async () => {
    const seen = recorder();
    const staged = await stageSymbols(
      harness(seen, { cache: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) }),
    );

    expect(staged.set).toBe('original');
    expect(staged.fetched).toBe(0);
    expect(staged.failures).toHaveLength(SYMBOL_TOKENS.length);
    expect(staged.failures[0]).toContain('getaddrinfo ENOTFOUND');
    expect(seen.published).toEqual([]);
  });

  it('falls back on a single missing symbol too, because one empty box is the bug', async () => {
    const seen = recorder();
    const staged = await stageSymbols(
      harness(seen, {
        cache: (url) => {
          seen.requested.push(url);
          if (url.endsWith('/T.svg')) return Promise.reject(new Error('responded 404'));
          return Promise.resolve<CachedImage>({
            name: 'cached.svg',
            path: '/tmp/cache/cached.svg',
            fetched: true,
          });
        },
      }),
    );

    expect(staged.set).toBe('original');
    expect(staged.failures).toEqual(['{T}: responded 404']);
  });
});
