/**
 * Staging a generated set's art, without touching the disk.
 *
 * The property the feature exists for: after staging, every href the page loads
 * is one the dev server actually serves. The one that keeps it honest: an entry
 * whose raster is missing is dropped and named, so the card falls back to the
 * pending frame instead of a broken image, and the person who ran the command
 * learns which card it was.
 */
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readArtManifest } from '../../src/lab/art-manifest';
import type { ArtManifestResult } from '../../src/lab/art-manifest';
import type { ArtManifest } from '../../src/lab/art-manifest';
import {
  artCandidatesFor,
  chooseArtManifest,
  supersededRuns,
  findArtManifest,
  readArtDocument,
  requireCompleteStagedArt,
  resolveExplicitArtManifest,
  stageSetArt,
} from '../../tools/stage-set-art';
import type { StageSetArtOptions } from '../../tools/stage-set-art';
import { printedCardIdsOf } from '../../tools/set-surfaces';

const MANIFEST_DIR = '/repo/out/art';

function manifestOf(art: Readonly<Record<string, { href: string; alt: string }>>): ArtManifest {
  const variants = Object.fromEntries(Object.entries(art).map(([id, entry]) => [id, [entry]]));
  const parsed = readArtManifest({ formatVersion: 2, art: variants }, 'test');
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.manifest;
}

/** Staging against a disk that has everything and records what was copied. */
function harness(overrides: Partial<StageSetArtOptions> = {}): StageSetArtOptions {
  return {
    manifestDir: MANIFEST_DIR,
    publicDir: '/repo/packages/ui/public/art',
    exists: () => true,
    copy: () => undefined,
    ...overrides,
  };
}

describe('staging a set’s generated art', () => {
  it('leaves every href on a path the page serves', () => {
    const staged = stageSetArt(
      manifestOf({
        'tgr-one': { href: './tgr-one.png', alt: 'a pier' },
        'tgr-two': { href: './tgr-two.png', alt: 'a lantern' },
      }),
      harness(),
    );
    expect(staged.copied).toBe(2);
    expect(Object.values(staged.manifest.art).map((variants) => variants[0]?.href)).toEqual([
      'art/tgr-one.png',
      'art/tgr-two.png',
    ]);
  });

  it('copies out of the pipeline’s directory into the served one', () => {
    const copied: string[] = [];
    stageSetArt(
      manifestOf({ 'tgr-one': { href: './tgr-one.png', alt: 'a pier' } }),
      harness({ copy: (from, to) => copied.push(`${from} -> ${to}`) }),
    );
    expect(copied).toEqual(['/repo/out/art/tgr-one.png -> /repo/packages/ui/public/art/tgr-one.png']);
  });

  it('overwrites a stale raster rather than keeping yesterday’s art', () => {
    const copied: string[] = [];
    stageSetArt(
      manifestOf({ 'tgr-one': { href: './tgr-one.png', alt: 'a pier' } }),
      harness({ exists: () => true, copy: (from) => copied.push(from) }),
    );
    expect(copied).toHaveLength(1);
  });

  it('drops an entry whose raster is not on disk, and names the card', () => {
    const staged = stageSetArt(
      manifestOf({
        'tgr-one': { href: './tgr-one.png', alt: 'a pier' },
        'tgr-gone': { href: './tgr-gone.png', alt: 'a lantern' },
      }),
      harness({ exists: (path) => !path.endsWith('tgr-gone.png') }),
    );
    expect(staged.missing).toEqual(['tgr-gone (./tgr-gone.png)']);
    expect(staged.pending).toEqual(['tgr-gone']);
    expect(Object.keys(staged.manifest.art)).toEqual(['tgr-one']);
  });

  /**
   * A card carries several illustrations now, and they are staged one at a time.
   * Dropping the whole card because one raster of three is missing would take a
   * Swamp off the table over a file nobody asked for; keeping the card while
   * silently serving a path that is not there would draw a broken image, which
   * is the state the art slot exists to make impossible.
   */
  describe('a card with several illustrations', () => {
    function threeSwamps(exists: (path: string) => boolean) {
      const parsed = readArtManifest(
        {
          formatVersion: 2,
          art: {
            'tgr-swamp': [
              { href: './a.png', alt: 'a lit cavern' },
              { href: './b.png', alt: 'a drowned mire' },
              { href: './c.png', alt: 'a field of blooms' },
            ],
          },
        },
        'test',
      );
      if (!parsed.ok) throw new Error(parsed.message);
      return stageSetArt(parsed.manifest, harness({ exists }));
    }

    it('stages every one of them onto a served path', () => {
      const staged = threeSwamps(() => true);
      expect(staged.copied).toBe(3);
      expect(staged.manifest.art['tgr-swamp']?.map((entry) => entry.href)).toEqual([
        'art/a.png',
        'art/b.png',
        'art/c.png',
      ]);
    });

    it('keeps the card on the two it has and names the one it lost', () => {
      const staged = threeSwamps((path) => !path.endsWith('b.png'));
      expect(staged.manifest.art['tgr-swamp']?.map((entry) => entry.href)).toEqual([
        'art/a.png',
        'art/c.png',
      ]);
      expect(staged.missing).toEqual(['tgr-swamp (illustration 2 of 3, ./b.png)']);
      expect(staged.pending).toEqual([]);
    });

    it('drops the card entirely when every one of them is gone', () => {
      const staged = threeSwamps(() => false);
      expect(staged.manifest.art['tgr-swamp']).toBeUndefined();
      expect(staged.pending).toEqual(['tgr-swamp']);
      expect(readArtManifest(JSON.parse(JSON.stringify(staged.manifest)), 'staged').ok).toBe(true);
    });
  });

  it('leaves an entry that already points at a URL alone', () => {
    const staged = stageSetArt(
      manifestOf({ 'tgr-one': { href: 'https://example.test/one.png', alt: 'a pier' } }),
      harness({
        copy: () => {
          throw new Error('a URL needs no copy');
        },
      }),
    );
    expect(staged).toMatchObject({ copied: 0, remote: 1 });
    expect(staged.manifest.art['tgr-one']?.[0]?.href).toBe('https://example.test/one.png');
  });

  it('still parses as a manifest after the rewrite', () => {
    const staged = stageSetArt(
      manifestOf({ 'tgr-one': { href: './tgr-one.png', alt: 'a pier' } }),
      harness(),
    );
    expect(readArtManifest(JSON.parse(JSON.stringify(staged.manifest)), 'staged').ok).toBe(true);
  });
});

describe('finding a set’s manifest', () => {
  const candidates = artCandidatesFor('/repo/out/slice/set/set.json', '/repo');

  it('prefers the one beside the set over the pipeline’s default directory', () => {
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      '/repo/out/slice/set/art.json',
      '/repo/out/art/art.json',
    ]);
    expect(findArtManifest(candidates, () => true)?.path).toBe('/repo/out/slice/set/art.json');
  });

  it('falls through to the pipeline’s directory', () => {
    const found = findArtManifest(candidates, (path) => path === '/repo/out/art/art.json');
    expect(found?.path).toBe('/repo/out/art/art.json');
  });

  it('returns null when the set has no art, which is not an error', () => {
    expect(findArtManifest(candidates, () => false)).toBeNull();
  });
});

describe('reading an art document off disk', () => {
  /**
   * `out/art/xmp`, `xmp-v2` and `xmp-v3` are all format 1: the art pipeline wrote them
   * before format 2 replaced it, and the launcher refused every one of them —
   * `readArtManifest` only accepts `formatVersion: 2`, so a v1 file failed the
   * same way a genuinely broken one would, and the refusal told the operator to
   * rebuild it with a paid `art generate` run when `migrateArtManifest`
   * (the art pipeline) already converts it for free. `readArtDocument` now tries that
   * conversion before giving up, so a v1 manifest on disk stages exactly like a
   * v2 one — no refusal, no rebuild, no cost.
   */
  it('migrates a version 1 manifest for free instead of refusing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-v1-manifest-'));
    const path = join(directory, 'art.json');
    writeFileSync(
      path,
      JSON.stringify({
        formatVersion: 1,
        art: { 'xmp-one': { href: './xmp-one.png', alt: 'a hero' } },
      }),
    );
    const result = readArtDocument(path);
    expect(result).toEqual({
      ok: true,
      manifest: { formatVersion: 2, art: { 'xmp-one': [{ href: './xmp-one.png', alt: 'a hero' }] } },
    });
  });

  it('still reads a version 2 manifest unchanged', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-v2-manifest-'));
    const path = join(directory, 'art.json');
    const document = { formatVersion: 2, art: { 'xmp-one': [{ href: './xmp-one.png', alt: 'a hero' }] } };
    writeFileSync(path, JSON.stringify(document));
    expect(readArtDocument(path)).toEqual({ ok: true, manifest: document });
  });

  /**
   * A version 1 manifest whose own shape is broken (missing `alt`) fails the v1
   * schema too, so `migrateArtManifest` cannot save it — only a fresh
   * `art generate` run can. The refusal names that, but still says plainly that
   * the free migration path was tried first, so "rebuild it" reads as the
   * considered answer rather than the only answer this reader knows.
   */
  it('names the free migration path it already tried when a v1-shaped file is itself broken', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-broken-v1-manifest-'));
    const path = join(directory, 'art.json');
    writeFileSync(path, JSON.stringify({ formatVersion: 1, art: { 'xmp-one': { href: './xmp-one.png' } } }));
    const result = readArtDocument(path);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/migrat/i);
    expect((result as { message: string }).message).toContain(
      'npm run art -- generate --set <set.json> --out <dir>',
    );
  });

  it('keeps the plain rebuild message for a document that is not a manifest of any known version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-not-a-manifest-'));
    const path = join(directory, 'art.json');
    writeFileSync(path, JSON.stringify({ hello: 'world' }));
    const result = readArtDocument(path);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).not.toMatch(/migrat/i);
    expect((result as { message: string }).message).toContain(
      'npm run art -- generate --set <set.json> --out <dir>',
    );
  });
});

describe('choosing between manifests by what they actually cover', () => {
  /**
   * The regression, reported from play: "can we make the existing art path the
   * default when running npm run play so I don't have to keep using the flag".
   *
   * `out/art/art.json` is whatever the last art run left there, and the art for
   * the set being played usually sits in a directory of its own beside it. The
   * old rule took the first candidate that existed, so playing The Hidden
   * Kingdom found twelve Tideglass entries, matched none of its own card ids,
   * and drew eighty pending frames — while the eighty rasters it wanted sat one
   * directory away. The launcher's own docblock already named this exact
   * failure ("look up this set's card ids in another set's art") and only
   * guarded the stale-file half of it.
   *
   * So the choice is made on coverage rather than on existence, which is the
   * question that was always being asked.
   */
  const SET_IDS = ['xmp-sylvanok-seed', 'xmp-moonblade'];
  const documents: Readonly<Record<string, readonly string[]>> = {
    '/repo/out/art/art.json': ['tgr-becalmed-in-the-shallows', 'tgr-breakwater-vanguard'],
    '/repo/out/art/flagship-set/art.json': ['xmp-sylvanok-seed', 'xmp-moonblade'],
    '/repo/out/art/xmp-v2/art.json': ['xmp-sylvanok-seed'],
  };
  const read = (path: string): ArtManifestResult => {
    const ids = documents[path];
    if (ids === undefined) return { ok: false, message: `no document at ${path}` };
    return {
      ok: true,
      manifest: manifestOf(Object.fromEntries(ids.map((id) => [id, { href: `./${id}.png`, alt: id }]))),
    };
  };
  const candidates = [
    { path: '/repo/out/art/art.json', what: 'the pipeline default' },
    { path: '/repo/out/art/flagship-set/art.json', what: 'flagship-set' },
    { path: '/repo/out/art/xmp-v2/art.json', what: 'xmp-v2' },
  ];

  it('passes over a manifest that shares no card with the set', () => {
    const chosen = chooseArtManifest(candidates, SET_IDS, { read, exists: () => true });
    expect(chosen?.candidate.path).toBe('/repo/out/art/flagship-set/art.json');
  });

  it('takes the manifest covering the most of the set, not merely the first that matches', () => {
    // `xmp-v2` is a real manifest for this set and would satisfy a first-match
    // rule; it covers one card where the other covers both.
    const chosen = chooseArtManifest([candidates[2]!, candidates[1]!], SET_IDS, { read, exists: () => true });
    expect(chosen?.candidate.path).toBe('/repo/out/art/flagship-set/art.json');
  });

  it('keeps ordinary discovery ranked by printed cards when derived surfaces favor a competitor', () => {
    const set = {
      ok: true,
      path: '/repo/set.json',
      what: 'test set',
      cardCount: 2,
      json: JSON.stringify({ cards: [{ id: 'xmp-one' }, { id: 'xmp-two' }] }),
    } as const;
    const first = manifestOf({
      'xmp-one': { href: './one.png', alt: 'one' },
      'xmp-two': { href: './two.png', alt: 'two' },
    });
    const derivedHeavy = manifestOf({
      'xmp-one': { href: './one.png', alt: 'one' },
      'token-one': { href: './token-one.png', alt: 'token one' },
      'token-two': { href: './token-two.png', alt: 'token two' },
      'xmp-plains': { href: './plains.png', alt: 'Plains' },
    });
    const candidates = [
      { path: '/repo/printed/art.json', what: 'printed-complete' },
      { path: '/repo/derived/art.json', what: 'derived-heavy' },
    ];
    const options = {
      exists: () => true,
      read: (path: string): ArtManifestResult => ({
        ok: true,
        manifest: path.includes('printed') ? first : derivedHeavy,
      }),
    };
    const ranked = chooseArtManifest(candidates, printedCardIdsOf(set), options);
    const changedRanking = chooseArtManifest(
      candidates,
      ['xmp-one', 'xmp-two', 'token-one', 'token-two', 'xmp-plains'],
      options,
    );

    expect(ranked?.candidate.what).toBe('printed-complete');
    expect(changedRanking?.candidate.what).toBe('derived-heavy');
  });

  it('prefers the collation over the run it collated, when both cover the whole set', () => {
    // The failure this is here for: a canonical manifest built by adopting three
    // regenerated runs on top of the old one covered every card, so did the run
    // it superseded, and the tie fell to whichever directory was named first. The
    // set went on being played with the pictures that had already been replaced.
    const single = readArtManifest(
      {
        formatVersion: 2,
        art: {
          'xmp-sylvanok-seed': [{ href: './a.png', alt: 'a' }],
          'xmp-moonblade': [{ href: './b.png', alt: 'b' }],
        },
      },
      'single',
    );
    const collated = readArtManifest(
      {
        formatVersion: 2,
        art: {
          'xmp-sylvanok-seed': [{ href: './new-a.png', alt: 'a' }],
          'xmp-moonblade': [
            { href: './b.png', alt: 'b' },
            { href: './b2.png', alt: 'b again' },
          ],
        },
      },
      'collated',
    );
    if (!single.ok || !collated.ok) throw new Error('fixture manifests must parse');
    const documents: Record<string, ArtManifestResult> = {
      '/repo/out/art/older/art.json': single,
      '/repo/out/art/canon/art.json': collated,
    };
    const options = {
      read: (path: string) => documents[path] ?? { ok: false as const, message: `no manifest at ${path}` },
      exists: () => true,
    };
    const order = [
      { path: '/repo/out/art/older/art.json', what: 'older' },
      { path: '/repo/out/art/canon/art.json', what: 'canon' },
    ];

    expect(chooseArtManifest(order, SET_IDS, options)?.candidate.what).toBe('canon');
    expect(chooseArtManifest([...order].reverse(), SET_IDS, options)?.candidate.what).toBe('canon');
  });

  it('returns null when nothing covers the set, so the pending frame is still the honest answer', () => {
    const chosen = chooseArtManifest([candidates[0]!], SET_IDS, { read, exists: () => true });
    expect(chosen).toBeNull();
  });

  it('offers every art directory under out/art as a candidate, deepest name first', () => {
    const found = artCandidatesFor('/repo/out/slice/set/set.json', '/repo', () => ['flagship-set', 'xmp-v2']);
    expect(found.map((candidate) => candidate.path)).toEqual([
      '/repo/out/slice/set/art.json',
      '/repo/out/art/flagship-set/art.json',
      '/repo/out/art/xmp-v2/art.json',
      '/repo/out/art/art.json',
    ]);
  });
});

describe('an explicitly named manifest', () => {
  const SET_IDS = ['xmp-one', 'xmp-two'];
  const complete = manifestOf({
    'xmp-one': { href: 'https://images.example/xmp-one.png', alt: 'one' },
    'xmp-two': { href: 'data:image/png;base64,iVBORw0KGgo=', alt: 'two' },
  });

  it('resolves a relative path from the caller and reads only that file', () => {
    const read: string[] = [];
    const chosen = resolveExplicitArtManifest('paid/xmp/art.json', SET_IDS, '/repo/public/art.json', {
      cwd: '/operator',
      read: (path) => {
        read.push(path);
        return { ok: true, manifest: complete };
      },
      exists: () => false,
    });
    expect(chosen.candidate.path).toBe('/operator/paid/xmp/art.json');
    expect(read).toEqual(['/operator/paid/xmp/art.json']);
  });

  it('fails on a missing or malformed requested path instead of falling back to discovery', () => {
    expect(() =>
      resolveExplicitArtManifest('/private/missing/art.json', SET_IDS, '/repo/public/art.json', {
        read: (path) => ({ ok: false, message: `could not read ${path}` }),
        exists: () => false,
      }),
    ).toThrow('could not read /private/missing/art.json');
  });

  it('refuses a manifest from another or incomplete build of the set', () => {
    const incomplete = manifestOf({ 'xmp-one': { href: './one.png', alt: 'one' } });
    expect(() =>
      resolveExplicitArtManifest('/private/stale/art.json', SET_IDS, '/repo/public/art.json', {
        read: () => ({ ok: true, manifest: incomplete }),
        exists: () => false,
      }),
    ).toThrow('covers 1 of 2 renderable surfaces');
  });

  it('refuses foreign keys even when every selected surface is present', () => {
    const foreign = readArtManifest(
      {
        formatVersion: 2,
        art: {
          ...complete.art,
          'tgr-foreign': [{ href: 'https://images.example/foreign.png', alt: 'foreign' }],
        },
      },
      'foreign test',
    );
    if (!foreign.ok) throw new Error(foreign.message);
    expect(() =>
      resolveExplicitArtManifest('/private/foreign/art.json', SET_IDS, '/repo/public/art.json', {
        read: () => foreign,
        exists: () => false,
      }),
    ).toThrow('1 foreign surface');
  });

  it.each([
    ['absolute', '/etc/hosts'],
    ['escaping', '../outside.png'],
  ])('refuses a %s local raster path', (_kind, href) => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-explicit-path-'));
    const manifestPath = join(directory, 'art.json');
    const document = manifestOf({ 'xmp-one': { href, alt: 'one' }, 'xmp-two': { href, alt: 'two' } });
    writeFileSync(manifestPath, JSON.stringify(document));
    expect(() => resolveExplicitArtManifest(manifestPath, SET_IDS, join(directory, 'public.json'))).toThrow(
      /must stay inside|must be relative/,
    );
  });

  it('refuses symlink escapes, directories, and files that are not supported rasters', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-explicit-raster-'));
    const outside = join(directory, '..', `${directory.split('/').pop()}-outside.png`);
    const manifestPath = join(directory, 'art.json');
    writeFileSync(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const reject = (href: string): void => {
      const document = manifestOf({ 'xmp-one': { href, alt: 'one' }, 'xmp-two': { href, alt: 'two' } });
      writeFileSync(manifestPath, JSON.stringify(document));
      expect(() =>
        resolveExplicitArtManifest(manifestPath, SET_IDS, join(directory, 'public.json')),
      ).toThrow();
    };

    symlinkSync(outside, join(directory, 'escape.png'));
    reject('./escape.png');
    mkdirSync(join(directory, 'folder.png'));
    reject('./folder.png');
    writeFileSync(join(directory, 'words.png'), 'not an image');
    reject('./words.png');
  });

  it('accepts supported rasters that are contained beside the explicit manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-explicit-valid-raster-'));
    const manifestPath = join(directory, 'art.json');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(directory, 'one.png'), png);
    writeFileSync(join(directory, 'two.png'), png);
    writeFileSync(
      manifestPath,
      JSON.stringify(
        manifestOf({
          'xmp-one': { href: './one.png', alt: 'one' },
          'xmp-two': { href: './two.png', alt: 'two' },
        }),
      ),
    );

    const chosen = resolveExplicitArtManifest(manifestPath, SET_IDS, join(directory, 'public.json'));
    expect(chosen.covered).toBe(2);
  });

  it('requires every selected surface to survive raster staging', () => {
    const local = manifestOf({
      'xmp-one': { href: './one.png', alt: 'one' },
      'xmp-two': { href: './two.png', alt: 'two' },
    });
    const staged = stageSetArt(local, harness({ exists: (path) => path.endsWith('one.png') }));
    expect(() => requireCompleteStagedArt(staged, SET_IDS, '/private/art.json')).toThrow(
      '1 of 2 required surfaces survived staging',
    );
  });

  it('rejects different local sources that flatten onto one served filename before copying', () => {
    const copied: string[] = [];
    const colliding = manifestOf({
      'xmp-one': { href: './first/shared.png', alt: 'one' },
      'xmp-two': { href: './second/shared.png', alt: 'two' },
    });

    expect(() => stageSetArt(colliding, harness({ copy: (from) => copied.push(from) }))).toThrow(
      'both stage as art/shared.png',
    );
    expect(copied).toEqual([]);
  });

  it.each(['direct', 'symbolic', 'hard'] as const)('refuses a %s alias of the staged manifest', (kind) => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-explicit-art-'));
    const source = join(directory, 'source.json');
    const target = kind === 'direct' ? source : join(directory, 'target.json');
    writeFileSync(source, JSON.stringify(complete));
    if (kind === 'symbolic') symlinkSync(source, target);
    if (kind === 'hard') linkSync(source, target);

    expect(() => resolveExplicitArtManifest(source, SET_IDS, target)).toThrow(
      'must not alias the staged art manifest',
    );
  });
});

describe('a collated run retiring the run it replaced', () => {
  /**
   * The tie the counters cannot break. `xmp-canon-v11` replaced two
   * illustrations in `xmp-canon-v10` one for one, so both manifests cover the
   * same cards with the same total and the winner fell to whichever directory
   * sorted first — the older one. The launcher went on staging pictures that
   * had already been paid to replace, and nothing reported anything wrong.
   *
   * `adopt-variants` writes the answer beside the manifest it collates, so the
   * ledger decides and no count has to.
   */
  const SET_IDS = ['xmp-link', 'xmp-seraphine'];
  const ART = {
    'xmp-link': { href: './xmp-link.png', alt: 'a swordsman' },
    'xmp-seraphine': { href: './xmp-seraphine.png', alt: 'a princess' },
  } as const;
  const read = (): ArtManifestResult => ({ ok: true, manifest: manifestOf(ART) });
  const candidates = [
    { path: '/repo/out/art/xmp-canon-v10/art.json', what: 'xmp-canon-v10' },
    { path: '/repo/out/art/xmp-canon-v11/art.json', what: 'xmp-canon-v11' },
  ];
  const ledgers: Readonly<Record<string, unknown>> = {
    '/repo/out/art/xmp-canon-v11/art.json': {
      supersedes: [{ newer: 'xmp-pw-v1', older: 'xmp-canon-v10' }],
    },
  };
  const readLedger = (path: string): unknown => ledgers[path] ?? null;

  it('passes over the run a candidate collation declares it replaced', () => {
    const chosen = chooseArtManifest(candidates, SET_IDS, { read, exists: () => true, readLedger });
    expect(chosen?.candidate.path).toBe('/repo/out/art/xmp-canon-v11/art.json');
  });

  it('keeps the older run when nothing on disk claims to have replaced it', () => {
    const chosen = chooseArtManifest(candidates, SET_IDS, {
      read,
      exists: () => true,
      readLedger: () => null,
    });
    expect(chosen?.candidate.path).toBe('/repo/out/art/xmp-canon-v10/art.json');
  });

  it('lets a collation that covers none of this set retire nothing', () => {
    const foreign = (path: string): ArtManifestResult =>
      path === '/repo/out/art/xmp-canon-v11/art.json'
        ? { ok: true, manifest: manifestOf({ 'tgr-one': { href: './tgr-one.png', alt: 'a pier' } }) }
        : { ok: true, manifest: manifestOf(ART) };
    const chosen = chooseArtManifest(candidates, SET_IDS, {
      read: foreign,
      exists: () => true,
      readLedger,
    });
    expect(chosen?.candidate.path).toBe('/repo/out/art/xmp-canon-v10/art.json');
  });

  it('reads every superseded run named across the candidates that have a ledger', () => {
    const replaced = supersededRuns(candidates, (path) =>
      path === '/repo/out/art/xmp-canon-v11/art.json'
        ? {
            supersedes: [
              { newer: 'xmp-pw-v1', older: 'xmp-canon-v10' },
              { newer: 'xmp-pw-v2', older: 'xmp-pw-v1' },
              { newer: 'xmp-pw-v2' },
              'not an edge',
            ],
          }
        : null,
    );
    expect([...replaced].sort()).toEqual(['xmp-canon-v10', 'xmp-pw-v1']);
  });
});
