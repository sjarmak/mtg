/**
 * Staging the art, without touching the network or the disk.
 *
 * The property that matters is the one the feature exists for: after staging,
 * nothing the page loads points at another host. The second is that a failure
 * to fetch degrades to the state that existed before — the absolute URL, and
 * therefore the pending frame — rather than to a broken relative path, which
 * would turn a viewer who *can* reach Scryfall into one who cannot.
 *
 * The cache itself is `@mtg/image-cache`'s and is tested there. What is tested
 * here is the wiring: one request per distinct illustration, a copy into the
 * served directory, and the rewrite.
 */
import { describe, expect, it } from 'vitest';
import type { CachedImage } from '@mtg/image-cache';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { stageDeckArt } from '../../tools/stage-art';
import type { StageArtOptions } from '../../tools/stage-art';

const BOLT = 'https://cards.scryfall.io/art_crop/front/a/b/bolt.jpg?1783920066';
const GUIDE = 'https://cards.scryfall.io/art_crop/front/c/d/guide.png';

function entry(name: string, src: string | null): DeckArtifactEntry {
  return {
    name,
    count: 4,
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Instant',
    colorIdentity: 'R',
    priceUsd: 1,
    criteria: ['format'],
    reason: 'test',
    art: src === null ? null : { src, alt: 'Illustration by Someone', artist: 'Someone', setCode: 'TST' },
  };
}

function deckOf(entries: readonly DeckArtifactEntry[]): DeckArtifact {
  const parsed = readDeckArtifact(
    {
      version: 1,
      prompt: 'red burn',
      format: 'modern',
      colors: ['R'],
      criteria: [{ id: 'format', kind: 'structural', statement: 'legal in modern' }],
      plan: '',
      totalCards: 60,
      priceUsd: 10,
      universeSize: 100,
      landPlan: { count: 20, source: 'model', reason: 'because' },
      spells: entries,
      lands: [],
      basics: [],
      manaBase: {
        totalLands: 20,
        nonBasicLands: 0,
        castabilityTarget: 0.9,
        heavyCastabilityTarget: 0.8,
        colors: [],
      },
      curve: { histogram: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, averageManaValue: 1 },
      shortfalls: [],
    },
    'test',
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

/** A staging run against a cache that always answers and a disk that records. */
function harness(overrides: Partial<StageArtOptions> = {}): StageArtOptions {
  return {
    cacheDir: '/tmp/cache',
    publicDir: '/tmp/public/art',
    cache: (url) =>
      Promise.resolve<CachedImage>({
        name: `${url.length.toString()}.jpg`,
        path: `/tmp/cache/x`,
        fetched: true,
      }),
    publish: () => undefined,
    ...overrides,
  };
}

describe('staging a deck’s art', () => {
  it('leaves nothing pointing at another host', async () => {
    const staged = await stageDeckArt(
      deckOf([entry('Lightning Bolt', BOLT), entry('Goblin Guide', GUIDE)]),
      harness(),
    );
    expect(staged.fetched).toBe(2);
    for (const spell of staged.deck.spells) {
      expect(spell.art?.src.startsWith('art/')).toBe(true);
    }
  });

  it('asks the cache once even when two cards share an illustration', async () => {
    const asked: string[] = [];
    await stageDeckArt(
      deckOf([entry('Lightning Bolt', BOLT), entry('Chain Lightning', BOLT)]),
      harness({
        cache: (url) => {
          asked.push(url);
          return Promise.resolve<CachedImage>({ name: 'a.jpg', path: '/tmp/cache/a.jpg', fetched: true });
        },
      }),
    );
    expect(asked).toEqual([BOLT]);
  });

  it('copies out of the shared cache into the directory the page serves', async () => {
    const copied: string[] = [];
    await stageDeckArt(
      deckOf([entry('Lightning Bolt', BOLT)]),
      harness({
        cache: () => Promise.resolve<CachedImage>({ name: 'a.jpg', path: '/tmp/cache/a.jpg', fetched: true }),
        publish: (from, to) => copied.push(`${from} -> ${to}`),
      }),
    );
    expect(copied).toEqual(['/tmp/cache/a.jpg -> /tmp/public/art/a.jpg']);
  });

  it('counts a cache hit as reused rather than fetched', async () => {
    const staged = await stageDeckArt(
      deckOf([entry('Lightning Bolt', BOLT)]),
      harness({
        cache: () =>
          Promise.resolve<CachedImage>({ name: 'a.jpg', path: '/tmp/cache/a.jpg', fetched: false }),
      }),
    );
    expect(staged).toMatchObject({ fetched: 0, reused: 1, failures: [] });
  });

  it('keeps the remote URL for an illustration it could not fetch, and names the card', async () => {
    const staged = await stageDeckArt(
      deckOf([entry('Lightning Bolt', BOLT)]),
      harness({ cache: () => Promise.reject(new Error('responded 404')) }),
    );
    expect(staged.failures).toEqual(['Lightning Bolt: responded 404']);
    expect(staged.deck.spells[0]?.art?.src).toBe(BOLT);
  });

  it('leaves a card that never had art alone', async () => {
    const staged = await stageDeckArt(deckOf([entry('Goblin Guide', null)]), harness());
    expect(staged.deck.spells[0]?.art).toBeNull();
    expect(staged.fetched).toBe(0);
  });

  it('still parses as a deck artifact after the rewrite', async () => {
    const staged = await stageDeckArt(deckOf([entry('Lightning Bolt', BOLT)]), harness());
    expect(readDeckArtifact(JSON.parse(JSON.stringify(staged.deck)), 'staged').ok).toBe(true);
  });
});
