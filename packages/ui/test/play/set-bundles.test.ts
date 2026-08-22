/**
 * Staging several sets at once, and the collision that makes it worth doing.
 *
 * The load-bearing test here is the raster one. Two sets staged into one shared
 * served directory is the arrangement the launcher had before this lane, and it
 * fails silently: every generative run in this repository names its rasters
 * after the card, so two sets that print a card with the same id copy two
 * different pictures over one path, both manifests go on resolving, and one set
 * draws the other's art. The bundle layout is the fix and this is where it is
 * held, on a real disk rather than an injected one, because the defect is
 * whether two `copy` calls land on the same inode.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSetIndex } from '../../src/lab/set-index';
import type { ResolvedSet, ResolveResult, SetCandidate } from '../../tools/resolve-set';
import { readSetLibrary, stageSetBundles, stagedSetStem } from '../../tools/stage-set-bundles';
import type { SetLibrary } from '../../tools/stage-set-bundles';

interface SetSpec {
  readonly code: string;
  readonly name: string;
  readonly cardIds: readonly string[];
  readonly reduced?: boolean;
  /** A reduced printing's `reduction` block, when the document carries one. */
  readonly reduction?: Readonly<Record<string, unknown>>;
}

function setJson(spec: SetSpec): string {
  return JSON.stringify({
    set: {
      code: spec.code,
      name: spec.name,
      ...(spec.reduced === true ? { reduced: true } : {}),
    },
    ...(spec.reduction === undefined ? {} : { reduction: spec.reduction }),
    cards: spec.cardIds.map((id) => ({ id, name: id })),
  });
}

/** A set on disk, optionally with its own art manifest and rasters beside it. */
function writeSet(
  root: string,
  dir: string,
  spec: SetSpec,
  art: Readonly<Record<string, { readonly file: string; readonly bytes: string }>> = {},
): ResolvedSet {
  const home = join(root, dir);
  mkdirSync(home, { recursive: true });
  const path = join(home, 'set.json');
  const json = setJson(spec);
  writeFileSync(path, json, 'utf8');
  const entries = Object.entries(art);
  if (entries.length > 0) {
    for (const [, { file, bytes }] of entries) writeFileSync(join(home, file), bytes, 'utf8');
    writeFileSync(
      join(home, 'art.json'),
      JSON.stringify({
        formatVersion: 2,
        art: Object.fromEntries(
          entries.map(([id, { file }]) => [id, [{ href: `./${file}`, alt: `${id} illustration` }]]),
        ),
      }),
      'utf8',
    );
  }
  return { ok: true, path, what: `the set in ${dir}`, cardCount: spec.cardIds.length, json };
}

function library(...sets: readonly ResolvedSet[]): SetLibrary {
  return { entries: sets.map((set, index) => ({ set, selected: index === 0 })), refused: [] };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'mtg-bundles-'));
}

describe('staging one bundle per set', () => {
  it('keys each set’s rasters under that set, so a shared basename cannot overwrite', async () => {
    const root = scratch();
    // The same card id in both sets, illustrated by the same filename with
    // different bytes: the exact shape a shared directory cannot represent.
    const first = writeSet(
      root,
      'first',
      { code: 'AAA', name: 'First Set', cardIds: ['pond'] },
      {
        pond: { file: 'pond.png', bytes: 'first-picture' },
      },
    );
    const second = writeSet(
      root,
      'second',
      { code: 'BBB', name: 'Second Set', cardIds: ['pond'] },
      {
        pond: { file: 'pond.png', bytes: 'second-picture' },
      },
    );

    const staging = await stageSetBundles(library(first, second), join(root, 'public'), root);

    const hrefs = staging.bundles.map((bundle) => {
      const manifest = JSON.parse(readFileSync(join(root, 'public', bundle.row.artUrl ?? ''), 'utf8')) as {
        art: Record<string, readonly { href: string }[]>;
      };
      const variants = manifest.art['pond'];
      if (variants === undefined || variants[0] === undefined) throw new Error('no art staged for pond');
      return variants[0].href;
    });
    expect(hrefs).toEqual(['sets/aaa/art/pond.png', 'sets/bbb/art/pond.png']);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    // Each href resolves to the picture its own set was given.
    expect(readFileSync(join(root, 'public', 'sets', 'aaa', 'art', 'pond.png'), 'utf8')).toBe(
      'first-picture',
    );
    expect(readFileSync(join(root, 'public', 'sets', 'bbb', 'art', 'pond.png'), 'utf8')).toBe(
      'second-picture',
    );
  });

  it('writes an index the page can read, with the launcher’s choice first and selected', async () => {
    const root = scratch();
    const flagship = writeSet(root, 'flagship', { code: 'AAA', name: 'First Set', cardIds: ['one', 'two'] });
    const reference = writeSet(root, 'reference', {
      code: 'BBB',
      name: 'Second Set (reduced)',
      cardIds: ['three'],
      reduced: true,
    });

    await stageSetBundles(library(flagship, reference), join(root, 'public'), root);

    const read = readSetIndex(
      JSON.parse(readFileSync(join(root, 'public', 'sets', 'index.json'), 'utf8')),
      'index.json',
    );
    if (!read.ok) throw new Error(read.message);
    expect(read.index.selected).toBe('aaa');
    expect(read.index.sets.map((row) => row.stem)).toEqual(['aaa', 'bbb']);
    expect(read.index.sets.map((row) => row.cardCount)).toEqual([2, 1]);
    expect(read.index.sets.map((row) => row.reduced)).toEqual([false, true]);
    expect(read.index.sets.map((row) => row.setUrl)).toEqual(['sets/aaa/set.json', 'sets/bbb/set.json']);
    // No art run beside either set, which is the ordinary state of a checkout
    // that has not paid for one: the row says so by carrying no art url at all
    // rather than one that would 404.
    expect(read.index.sets.map((row) => row.artUrl)).toEqual([undefined, undefined]);
    for (const row of read.index.sets) {
      expect(JSON.parse(readFileSync(join(root, 'public', row.setUrl), 'utf8')).set.code).toBe(row.code);
    }
  });

  /**
   * A reduced printing's collation reaches the page because the bundle is the
   * document, byte for byte.
   *
   * `npm run reference:reduced` writes the reweighted sheets, the booster
   * configurations and `fillsAPack` into `reduction.collation`, and the lab
   * deals from exactly that block; `../../src/lab/staged-collation.ts` is the
   * reader. Between them sits this staging step, and it is the one place the
   * block could be dropped without anything failing — a page handed a document
   * with no collation deals the rarity recipe a card list implies and says
   * nothing, so the pool would look like the printing's and be another set's
   * packs. Comparing the text rather than the parsed block is deliberate: the
   * claim is that staging carries the *whole* document, including whatever the
   * emitter adds to it next.
   */
  it('stages the document byte for byte, so a printing’s collation rides along', async () => {
    const root = scratch();
    const collation = {
      fillsAPack: true,
      sheets: [{ name: 'common', sourceCards: 4, cards: 2, weights: { one: 2, two: 1 } }],
      emptiedSheets: [],
      boosters: [{ contents: { common: 1 }, weight: 1, packSize: 1 }],
      unfillableBoosters: 0,
      slotFindings: [],
    };
    const printing = writeSet(root, 'reference', {
      code: 'M11',
      name: 'A Printing (reduced)',
      cardIds: ['one', 'two'],
      reduced: true,
      reduction: { kept: 2, dropped: 1, collation },
    });

    await stageSetBundles(library(printing), join(root, 'public'), root);

    const staged = readFileSync(join(root, 'public', 'sets', 'm11', 'set.json'), 'utf8');
    expect(staged).toBe(printing.json);
    expect((JSON.parse(staged) as { reduction: { collation: unknown } }).reduction.collation).toEqual(
      collation,
    );
  });

  it('clears the previous run’s bundles, so a set that is gone is gone', async () => {
    const root = scratch();
    const before = writeSet(
      root,
      'before',
      { code: 'AAA', name: 'First Set', cardIds: ['one'] },
      {
        one: { file: 'one.png', bytes: 'old-picture' },
      },
    );
    await stageSetBundles(library(before), join(root, 'public'), root);
    expect(existsSync(join(root, 'public', 'sets', 'aaa', 'art', 'one.png'))).toBe(true);

    const after = writeSet(root, 'after', { code: 'BBB', name: 'Second Set', cardIds: ['two'] });
    await stageSetBundles(library(after), join(root, 'public'), root);

    expect(existsSync(join(root, 'public', 'sets', 'aaa'))).toBe(false);
    expect(existsSync(join(root, 'public', 'sets', 'bbb', 'set.json'))).toBe(true);
  });
});

describe('the directory name a set is staged under', () => {
  const spec = (code: string | null): string =>
    JSON.stringify({ set: code === null ? { name: 'Nameless' } : { code, name: 'Named' }, cards: [] });

  it('is the set code, lowercased', () => {
    expect(stagedSetStem(spec('AAA'), '/out/whatever/set.json', new Set())).toBe('aaa');
  });

  it('suffixes rather than reuses, because two builds of one set is the case that matters', () => {
    const taken = new Set(['aaa']);
    expect(stagedSetStem(spec('AAA'), '/out/whatever/set.json', taken)).toBe('aaa-2');
    taken.add('aaa-2');
    expect(stagedSetStem(spec('AAA'), '/out/other/set.json', taken)).toBe('aaa-3');
  });

  it('falls back to the filename, then to the directory, when the document names no code', () => {
    expect(stagedSetStem(spec(null), '/fixtures/tideglass-reach.set.json', new Set())).toBe(
      'tideglass-reach',
    );
    // `out/reference/m11/set.json` and `out/reference/m13/set.json` are the same
    // filename, so the filename alone would collide where the directory does not.
    expect(stagedSetStem(spec(null), '/out/reference/alpha/set.json', new Set())).toBe('alpha');
  });

  it('falls back again rather than returning an empty path segment', () => {
    expect(stagedSetStem('not json at all', '/!!!/!!!.json', new Set())).toBe('set');
  });
});

describe('reading the library off the candidate list', () => {
  const candidates: readonly SetCandidate[] = [
    { path: '/a/set.json', what: 'candidate a' },
    { path: '/b/set.json', what: 'candidate b' },
    { path: '/broken/set.json', what: 'candidate broken' },
    { path: '/absent/set.json', what: 'candidate absent' },
  ];
  const chosen: ResolvedSet = {
    ok: true,
    path: '/b/set.json',
    what: 'candidate b',
    cardCount: 1,
    json: '{}',
  };
  const read = (path: string, what: string): ResolveResult => {
    if (path === '/broken/set.json')
      return { ok: false, message: `${path} is not a set this build can read` };
    if (path === '/absent/set.json') return { ok: false, message: `no set at ${path}` };
    return { ok: true, path, what, cardCount: 1, json: '{}' };
  };

  it('puts the launcher’s own choice first and keeps the candidate order behind it', () => {
    const result = readSetLibrary(candidates, chosen, { read });
    expect(result.entries.map((entry) => entry.set.path)).toEqual(['/b/set.json', '/a/set.json']);
    expect(result.entries.map((entry) => entry.selected)).toEqual([true, false]);
  });

  it('names a file that is there and is not a set, and says nothing about one that is not there', () => {
    const result = readSetLibrary(candidates, chosen, { read });
    expect(result.refused).toEqual(['/broken/set.json is not a set this build can read']);
  });
});
