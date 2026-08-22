/**
 * `npm run play` resolution.
 *
 * The launcher's real product is its failure modes: the acceptance for
 * `mtg-bc2.38.4` asks that it name what is missing rather than crash. So these
 * tests are mostly about what it says when there is nothing to play.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSetDocument, resolveSet } from '../../tools/resolve-set';
import { isFlagshipSet, SET_CANDIDATES } from '../../tools/set-candidates';
import type { SetCandidate } from '../../tools/resolve-set';
import { surfaceIdsOf } from '../../tools/set-surfaces';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const REAL_SET = join(REPO_ROOT, 'packages', 'setgen', 'fixtures', 'sets', 'tideglass-reach.set.json');

const CANDIDATES: readonly SetCandidate[] = [
  { path: '/nowhere/out/slice/set/set.json', what: 'the most recent slice run' },
  { path: REAL_SET, what: 'the committed generated set' },
];

function scratch(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-play-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('finding a set', () => {
  it('falls back to the committed set, so a clean checkout can play', () => {
    const result = resolveSet(CANDIDATES, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.cardCount).toBe(90);
    expect(result.what).toBe('the committed generated set');
  });

  it('prefers a slice run when one exists', () => {
    const result = resolveSet(CANDIDATES, undefined, {
      exists: () => true,
      read: (path, what) => ({ ok: true, path, what, cardCount: 1, json: '{}' }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.what).toBe('the most recent slice run');
  });

  it('names every place it looked when there is nothing', () => {
    const result = resolveSet(CANDIDATES, undefined, { exists: () => false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('no set to play');
    expect(result.message).toContain('the most recent slice run');
    expect(result.message).toContain('the committed generated set');
    expect(result.message).toContain('npm run slice');
  });

  it('says where it looked for a set the caller named', () => {
    const result = resolveSet(CANDIDATES, '/tmp/definitely-not-here.json', { cwd: '/tmp' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('no set at /tmp/definitely-not-here.json');
  });
});

describe('refusing a file that is not a set', () => {
  it('names the file when the JSON is broken', () => {
    const result = readSetDocument(scratch('broken.json', '{not json'), 'a test file');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('is not valid JSON');
  });

  it('rejects a document with no cards array', () => {
    const result = readSetDocument(scratch('empty.json', '{"set":{"code":"XYZ"}}'), 'a test file');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('has no "cards" array');
  });

  it('rejects an empty set and says how to make one', () => {
    const result = readSetDocument(scratch('none.json', '{"cards":[]}'), 'a test file');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('npm run slice');
  });

  it('rejects a card the DSL will not parse, rather than passing it to the browser', () => {
    const result = readSetDocument(scratch('bad.json', '{"cards":[{"name":"Not A Card"}]}'), 'a test file');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.message).toContain('holds a card the DSL rejects');
  });

  it('accepts the real set unchanged, byte for byte', () => {
    const result = readSetDocument(REAL_SET, 'the committed generated set');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    // The staged copy is what the browser fetches, so it must be the file
    // itself and not a re-serialization that could drift.
    expect(result.json).toBe(readFileSync(REAL_SET, 'utf8'));
  });
});

describe('the flagship is what the lab opens', () => {
  /**
   * Reported from play: "i want the default to be xmp though when running npm
   * run play, tideglass was just a prototype to get started before the seraphine
   * set".
   *
   * Ordering alone could not fix this. `out/slice/set/set.json` is whatever the
   * last `npm run slice` built, and on the machine that reported it that was the
   * prototype — so a Tideglass slice outranked every flagship set build on
   * disk and the lab kept opening the wrong set. Demoting the slice tier below
   * the committed set would have been worse in the other direction: a fresh
   * slice of the flagship is exactly what somebody wants to see.
   *
   * So the slice tier is kept, and qualified. A slice run counts when it is a
   * slice of the flagship; a slice of anything else is skipped and the flagship
   * is opened instead. `--` still plays any path, which is the escape hatch for
   * looking at the prototype on purpose.
   */
  it('keeps a slice run of the flagship', () => {
    expect(isFlagshipSet(JSON.stringify({ set: { code: 'TGR' }, cards: [] }))).toBe(true);
  });

  it('skips a slice run of a different set, which is how the prototype kept winning', () => {
    expect(isFlagshipSet(JSON.stringify({ set: { code: 'HRT' }, cards: [] }))).toBe(false);
  });

  it('skips a document it cannot read a set code out of, rather than guessing', () => {
    expect(isFlagshipSet('not json at all')).toBe(false);
    expect(isFlagshipSet(JSON.stringify({ cards: [] }))).toBe(false);
  });

  it('names the flagship, not the prototype, as the committed last resort', () => {
    const committed = SET_CANDIDATES[SET_CANDIDATES.length - 1];
    expect(committed?.path).toContain('tideglass-reach.set.json');
    const resolved = resolveSet([committed!], undefined);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.cardCount).toBe(90);
    expect(isFlagshipSet(resolved.json)).toBe(true);
  });
});

describe('the flagship surfaces the browser can paint', () => {
  it('includes all 90 cards, 1 derived token, and 5 synthesized basics', () => {
    const path = SET_CANDIDATES[SET_CANDIDATES.length - 1]?.path;
    if (path === undefined) throw new Error('the committed set candidate is absent');
    const result = readSetDocument(path, 'the authored flagship');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const ids = surfaceIdsOf(result);
    expect(ids).toHaveLength(90 + 1 + 5);
    expect(new Set(ids).size).toBe(90 + 1 + 5);
    expect(result.cardCount).toBe(90);
    expect(ids.slice(0, result.cardCount)).toHaveLength(90);
    expect(ids.filter((id) => id.startsWith('token-'))).toHaveLength(1);
    expect(ids.slice(-5)).toEqual(['tgr-plains', 'tgr-island', 'tgr-swamp', 'tgr-mountain', 'tgr-forest']);
  });
});

/**
 * A build of the flagship is the flagship only when it prints the cards the
 * brief authored.
 *
 * The set code alone said yes to `out/XMP/set.json`, the raw output of the paid
 * generation run, which predates the `authoredCards` mechanism and therefore
 * holds none of them. Ordering the committed fixture above it would encode that
 * one temporary staleness permanently; a future run of the same brief prints
 * all of them and should win again the moment it does.
 */
describe('the launchers that resolve a set', () => {
  const TOOLS = new URL('../../tools/', import.meta.url).pathname;
  /** `flagshipOnly(` anywhere, which is the whole of what the caller must do. */
  const APPLIES_FILTER = /\bflagshipOnly\s*\(/;
  const USES_CANDIDATES = /\bSET_CANDIDATES\b/;

  function toolSources(): readonly { readonly name: string; readonly text: string }[] {
    return readdirSync(TOOLS, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => ({ name: entry.name, text: readFileSync(join(TOOLS, entry.name), 'utf8') }));
  }

  it('are found, and there is more than one of them', () => {
    // Without this the offender list below is empty on a tree where the glob
    // broke, and an empty offender list reads as a clean tree.
    const users = toolSources().filter((file) => USES_CANDIDATES.test(file.text));
    expect(users.map((file) => file.name)).toContain('play.ts');
    expect(users.map((file) => file.name)).toContain('netplay.ts');
    expect(users.length).toBeGreaterThan(2);
  });

  it('all narrow the list to the flagship', () => {
    const offenders = toolSources().filter(
      (file) =>
        file.name !== 'set-candidates.ts' &&
        USES_CANDIDATES.test(file.text) &&
        !APPLIES_FILTER.test(file.text),
    );
    expect(
      offenders.map((file) => file.name),
      'resolving SET_CANDIDATES without flagshipOnly opens whichever set is newest on disk, which is how `npm run analyze` came to read a set the DSL rejects',
    ).toEqual([]);
  });

  it('leave a named path alone, so the escape hatch survives', () => {
    // The filter is applied to the search, never to a path the caller named:
    // `npm run play -- path/to/set.json` is how the prototype is opened at all.
    // A launcher that wrapped the named path too would pass the test above and
    // still be wrong, so the shape is checked and not just the call.
    const guarded = toolSources().filter(
      (file) => file.name !== 'set-candidates.ts' && APPLIES_FILTER.test(file.text),
    );
    expect(guarded.length).toBeGreaterThan(2);
    for (const file of guarded) {
      expect(
        /===?\s*undefined\s*\?\s*flagshipOnly\(/.test(file.text),
        `${file.name} applies flagshipOnly unconditionally, so a named set path would be filtered out of its own run`,
      ).toBe(true);
    }
  });

  it('recognizes the shapes it is looking for', () => {
    // Positive controls. A pattern that matches nothing would report every file
    // clean, and a pattern that matches everything would report every file fine.
    expect(USES_CANDIDATES.test('resolveSet(SET_CANDIDATES, args.setPath)')).toBe(true);
    expect(USES_CANDIDATES.test('resolveDeck(DECK_CANDIDATES, args.deckPath)')).toBe(false);
    expect(APPLIES_FILTER.test('const candidates = flagshipOnly(SET_CANDIDATES);')).toBe(true);
    expect(APPLIES_FILTER.test('// flagshipOnly is not called here')).toBe(false);
  });
});
