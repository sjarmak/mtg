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
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CachedImage } from '@mtg/image-cache';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { clearStagedFlatArt, describeClearedFlatArt, stageDeckArt } from '../../tools/stage-art';
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

  it('stages the sideboard too, and does not invent one for a deck that has none', async () => {
    const base = deckOf([entry('Lightning Bolt', BOLT)]);
    const withBoard: DeckArtifact = { ...base, sideboard: [entry('Goblin Guide', GUIDE)] };
    const staged = await stageDeckArt(withBoard, harness());
    expect(staged.fetched).toBe(2);
    expect(staged.deck.sideboard?.[0]?.art?.src.startsWith('art/')).toBe(true);
    // Absent stays absent: `../../src/routes/deck/OpenDeckScreen.ts` draws a
    // pane for a deck that carries an empty sideboard and none for a deck that
    // was never asked, so a rewrite that materialized the field would add a pane.
    const untouched = await stageDeckArt(base, harness());
    expect('sideboard' in untouched.deck).toBe(false);
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

/**
 * `mtg-cax8`, 2026-08-23. `npm run play` cleared the flat `art.json` and left
 * the directory it named, so every older run's rasters stayed on disk with
 * nothing reading them: 11 GB on this machine. The manifest and the pictures
 * leave together or the second one is garbage nobody can attribute.
 */
describe('clearing the art an older launcher staged flat', () => {
  function publicDirWith(files: readonly (readonly [string, number])[]): string {
    const root = mkdtempSync(join(tmpdir(), 'mtg-flat-art-'));
    mkdirSync(join(root, 'art'), { recursive: true });
    for (const [name, size] of files) writeFileSync(join(root, 'art', name), new Uint8Array(size));
    return root;
  }

  it('removes the directory and reports what it held', () => {
    const root = publicDirWith([
      ['a.png', 1_000_000],
      ['b.png', 3_000_000],
    ]);
    const cleared = clearStagedFlatArt(root);
    expect(cleared).toEqual({ files: 2, bytes: 4_000_000 });
    expect(existsSync(join(root, 'art'))).toBe(false);
    expect(describeClearedFlatArt(cleared)).toContain('2 illustration(s) (4 MB)');
  });

  it('says nothing, and does nothing, when no older run left one', () => {
    const root = mkdtempSync(join(tmpdir(), 'mtg-flat-art-none-'));
    const cleared = clearStagedFlatArt(root);
    expect(cleared).toEqual({ files: 0, bytes: 0 });
    expect(describeClearedFlatArt(cleared)).toBe('');
  });
});
