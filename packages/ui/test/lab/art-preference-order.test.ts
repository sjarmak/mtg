/**
 * The staging step that makes position zero mean "preferred" rather than
 * "adopted first". The renderer paints position zero for every named card, so
 * everything in this file is about which entry lands there.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyArtPreferences,
  describePreferenceOrdering,
  orderByPreference,
  parsePreferences,
  preferencesPathFor,
} from '../../tools/art-preference-order';
import type { ArtManifest } from '../../src/lab/art-manifest';

function raster(dir: string, name: string, bytes: string): string {
  writeFileSync(join(dir, name), bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

function fixture(): {
  readonly dir: string;
  readonly manifest: ArtManifest;
  readonly digests: readonly string[];
} {
  const dir = mkdtempSync(join(tmpdir(), 'art-prefs-'));
  const digests = ['first-on-disk', 'the-one-she-picked', 'the-third'].map((bytes, index) =>
    raster(dir, `v${String(index)}.png`, bytes),
  );
  return {
    dir,
    digests,
    manifest: {
      formatVersion: 2,
      art: {
        'xmp-deathbringer': [
          { href: './v0.png', alt: 'adopted first' },
          { href: './v1.png', alt: 'the pick' },
          { href: './v2.png', alt: 'the third' },
        ],
      },
    },
  };
}

describe('a recorded pick for a card the manifest never heard of', () => {
  it('is reported rather than dropped, because a stale id looks like an obeyed one', () => {
    const { dir, manifest, digests } = fixture();
    const preferred = digests[1];
    if (preferred === undefined) throw new Error('fixture');

    const ordering = orderByPreference(
      manifest,
      dir,
      { 'xmp-deathbringer': [preferred], 'xmp-gloom-hand': [preferred] },
      '/repo/data/art-preferences/example-set.json',
    );

    expect(ordering.unknown).toStrictEqual(['xmp-gloom-hand']);
    expect(ordering.unavailable).toStrictEqual([]);
    expect(describePreferenceOrdering(ordering)).toContain(
      '1 recorded pick(s) name a card this manifest has no art for',
    );
    expect(describePreferenceOrdering(ordering)).toContain('  - xmp-gloom-hand');
  });

  it('says nothing when every recorded pick names a card the manifest carries', () => {
    const { dir, manifest, digests } = fixture();
    const preferred = digests[1];
    if (preferred === undefined) throw new Error('fixture');

    const ordering = orderByPreference(
      manifest,
      dir,
      { 'xmp-deathbringer': [preferred] },
      '/repo/prefs.json',
    );

    expect(ordering.unknown).toStrictEqual([]);
    expect(describePreferenceOrdering(ordering)).not.toContain('no art for');
  });
});

describe('orderByPreference', () => {
  it('moves the recorded pick to position zero and keeps the rest in order', () => {
    const { dir, manifest, digests } = fixture();
    const preferred = digests[1];
    const third = digests[2];
    if (preferred === undefined || third === undefined) throw new Error('fixture');

    const ordering = orderByPreference(manifest, dir, { 'xmp-deathbringer': [preferred, third] });

    expect(ordering.manifest.art['xmp-deathbringer']?.map((entry) => entry.href)).toEqual([
      './v1.png',
      './v2.png',
      './v0.png',
    ]);
    expect(ordering.reordered).toEqual(['xmp-deathbringer']);
    expect(ordering.unavailable).toEqual([]);
  });

  it('drops nothing: an entry the preference never names keeps its place behind the named ones', () => {
    const { dir, manifest, digests } = fixture();
    const preferred = digests[2];
    if (preferred === undefined) throw new Error('fixture');

    const ordering = orderByPreference(manifest, dir, { 'xmp-deathbringer': [preferred] });

    expect(ordering.manifest.art['xmp-deathbringer']).toHaveLength(3);
    expect(ordering.manifest.art['xmp-deathbringer']?.[0]?.href).toBe('./v2.png');
  });

  it('reports a pick whose raster this manifest does not carry rather than pretending it applied', () => {
    const { dir, manifest } = fixture();
    const elsewhere = createHash('sha256').update('a raster in another run').digest('hex');

    const ordering = orderByPreference(manifest, dir, { 'xmp-deathbringer': [elsewhere] }, '/prefs.json');

    expect(ordering.unavailable).toEqual(['xmp-deathbringer']);
    expect(ordering.reordered).toEqual([]);
    expect(ordering.manifest.art['xmp-deathbringer']?.[0]?.href).toBe('./v0.png');
    expect(describePreferenceOrdering(ordering)).toContain('xmp-deathbringer');
  });

  it('leaves a card with no preference exactly as the collation left it', () => {
    const { dir, manifest } = fixture();
    const ordering = orderByPreference(manifest, dir, {});
    expect(ordering.manifest).toEqual(manifest);
    expect(ordering.reordered).toEqual([]);
  });

  it('is a function of the two documents, so the same inputs order the same way twice', () => {
    const { dir, manifest, digests } = fixture();
    const preferred = digests[1];
    if (preferred === undefined) throw new Error('fixture');
    const once = orderByPreference(manifest, dir, { 'xmp-deathbringer': [preferred] });
    const twice = orderByPreference(manifest, dir, { 'xmp-deathbringer': [preferred] });
    expect(once.manifest).toEqual(twice.manifest);
  });
});

describe('preferencesPathFor', () => {
  it('finds the file of the set’s own stem and returns null when there is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'art-prefs-root-'));
    mkdirSync(join(root, 'data', 'art-preferences'), { recursive: true });
    writeFileSync(join(root, 'data', 'art-preferences', 'example-set.json'), '{}');

    expect(preferencesPathFor('/out/example-set.set.json', root)).toBe(
      join(root, 'data', 'art-preferences', 'example-set.json'),
    );
    expect(preferencesPathFor('/out/tideglass-reach.set.json', root)).toBeNull();
  });

  it('returns the manifest untouched when the set has no preferences file', () => {
    const { dir, manifest } = fixture();
    const root = mkdtempSync(join(tmpdir(), 'art-prefs-empty-'));
    const ordering = applyArtPreferences(manifest, dir, '/out/nobody.set.json', root);
    expect(ordering.path).toBeNull();
    expect(ordering.manifest).toBe(manifest);
    expect(describePreferenceOrdering(ordering)).toContain('No art preferences');
  });
});

/**
 * The schema here is a second declaration of the art pipeline's, kept narrow and kept
 * separate because the art pipeline reaches `@mtg/card-render` which reaches this
 * package. Same guard the manifest schema gets: one document, both readers.
 */
describe('the preferences schema does not drift from @mtg/art’s', () => {
  const document = {
    'xmp-deathbringer': [createHash('sha256').update('a').digest('hex')],
  };

  it('parses the same document the producer’s reader parses', () => {
    expect(parsePreferences(document)).toEqual(document);
  });

  it('refuses what the producer refuses', () => {
    expect(() => parsePreferences({ 'xmp-a': [] })).toThrow();
    expect(() => parsePreferences({ 'xmp-a': ['NOTAHASH'] })).toThrow();
  });
});
