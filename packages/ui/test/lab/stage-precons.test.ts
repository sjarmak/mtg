/**
 * Which precon file the launcher stages, and what it says when none fits.
 *
 * The rule under test is the one that makes this safe: a candidate qualifies
 * only when the set prints **every** card it names. Set code is not enough and
 * a majority is not enough — two builds of one set share a code and share
 * almost no card ids, and a deck list missing one card is a different deck from
 * the one somebody wrote, not a slightly worse one.
 *
 * The reads are injected rather than written to a temporary directory, because
 * every decision here is about file *contents* and the directory walk is one
 * `readdirSync` that `preconCandidatesFor` owns.
 */
import { describe, expect, it } from 'vitest';
import { choosePreconFile, describePrecons, preconCandidatesFor } from '../../tools/stage-precons';
import type { PreconCandidate } from '../../tools/stage-precons';

const CANDIDATES: readonly PreconCandidate[] = [
  { path: '/set/dir/precons.json', what: 'a precon file beside the set' },
  { path: '/repo/fixtures/one.precons.json', what: 'the committed one.precons.json' },
  { path: '/repo/fixtures/two.precons.json', what: 'the committed two.precons.json' },
];

function file(id: string, ids: readonly string[]): string {
  return JSON.stringify({
    formatVersion: 1,
    setCode: 'STA',
    decks: [
      {
        id,
        name: `Deck ${id}`,
        plan: 'Attack.',
        payoff: ids[0],
        deckSize: 60,
        basics: { G: 24 },
        spells: ids.map((cardId) => ({ id: cardId, count: 36 / ids.length })),
      },
    ],
  });
}

function reader(files: Readonly<Record<string, string>>): (path: string) => string | null {
  return (path) => files[path] ?? null;
}

describe('choosing a precon file for a set', () => {
  it('takes the first candidate whose every id the set prints', () => {
    const search = choosePreconFile(CANDIDATES, ['a', 'b', 'c'], {
      read: reader({
        '/repo/fixtures/one.precons.json': file('one', ['a', 'b', 'c']),
        '/repo/fixtures/two.precons.json': file('two', ['a', 'b', 'c']),
      }),
    });
    expect(search.chosen?.candidate.path).toBe('/repo/fixtures/one.precons.json');
  });

  it('prefers a file beside the set over the committed fixtures', () => {
    const search = choosePreconFile(CANDIDATES, ['a', 'b', 'c'], {
      read: reader({
        '/set/dir/precons.json': file('beside', ['a', 'b', 'c']),
        '/repo/fixtures/one.precons.json': file('one', ['a', 'b', 'c']),
      }),
    });
    expect(search.chosen?.candidate.path).toBe('/set/dir/precons.json');
  });

  it('passes over a file the set does not print in full, and names the cards', () => {
    const search = choosePreconFile(CANDIDATES, ['a', 'b', 'c'], {
      read: reader({
        '/repo/fixtures/one.precons.json': file('one', ['a', 'b', 'gone']),
        '/repo/fixtures/two.precons.json': file('two', ['a', 'b', 'c']),
      }),
    });
    expect(search.chosen?.candidate.path).toBe('/repo/fixtures/two.precons.json');
    expect(search.rejected).toHaveLength(1);
    expect(search.rejected[0]?.why).toMatch(/gone/);
  });

  it('stages nothing rather than a partial match, and says so', () => {
    const search = choosePreconFile(CANDIDATES, ['a'], {
      read: reader({ '/repo/fixtures/one.precons.json': file('one', ['a', 'b', 'c']) }),
    });
    expect(search.chosen).toBeNull();
    expect(describePrecons(search)).toMatch(/No preconstructed decks match this set/);
    expect(describePrecons(search)).toMatch(/one\.precons\.json/);
  });

  it('reports a document that is not a precon file rather than throwing', () => {
    const search = choosePreconFile(CANDIDATES, ['a'], {
      read: reader({ '/repo/fixtures/one.precons.json': '{"formatVersion":9}' }),
    });
    expect(search.chosen).toBeNull();
    expect(search.rejected[0]?.why).toMatch(/formatVersion/);
  });

  it('names every deck it staged, so the line is worth reading', () => {
    const search = choosePreconFile(CANDIDATES, ['a', 'b', 'c'], {
      read: reader({ '/repo/fixtures/one.precons.json': file('one', ['a', 'b', 'c']) }),
    });
    expect(describePrecons(search)).toMatch(/Staged 1 preconstructed decks/);
    expect(describePrecons(search)).toMatch(/Deck one/);
  });

  it('stages all five decks in a matching file without a fixed roster', () => {
    const decks = Array.from({ length: 5 }, (_unused, index) => ({
      id: `deck-${String(index + 1)}`,
      name: `Deck ${String(index + 1)}`,
      plan: 'Attack.',
      payoff: 'a',
      deckSize: 60,
      basics: { G: 24 },
      spells: [{ id: 'a', count: 36 }],
    }));
    const document = JSON.stringify({ formatVersion: 1, setCode: 'STA', decks });
    const search = choosePreconFile(CANDIDATES, ['a'], {
      read: reader({ '/repo/fixtures/one.precons.json': document }),
    });
    expect(search.chosen?.file.decks.map((deck) => deck.id)).toEqual([
      'deck-1',
      'deck-2',
      'deck-3',
      'deck-4',
      'deck-5',
    ]);
    expect(describePrecons(search)).toMatch(/Staged 5 preconstructed decks/);
    expect(describePrecons(search)).toMatch(/Deck 5/);
  });
});

describe('where a precon file is looked for', () => {
  it('looks beside the set first, then in the committed fixtures', () => {
    const candidates = preconCandidatesFor('/anywhere/out/XMP/set.json', '/repo');
    expect(candidates[0]?.path).toContain('/anywhere/out/XMP');
    expect(candidates[0]?.path).toContain('precons.json');
    for (const candidate of candidates.slice(1)) {
      expect(candidate.path).toContain('packages/setgen/fixtures/decks');
    }
  });

  it('ships no committed private deck lists', () => {
    const candidates = preconCandidatesFor('/anywhere/set.json', repoRoot());
    expect(candidates.slice(1)).toEqual([]);
  });
});

/** This checkout's root, four levels up from `packages/ui/test/lab`. */
function repoRoot(): string {
  return new URL('../../../..', import.meta.url).pathname;
}
