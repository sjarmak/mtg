import { describe, expect, it } from 'vitest';
import {
  auditSkeletonCitations,
  citationForPath,
  colorPieCitations,
  COLOR_PIE_2021,
  COLOR_PIE_SUBJECTS,
  coversPath,
  numericPaths,
  PLAY_BOOSTER_2024,
  resolvePath,
  skeletonCitation,
  skeletonSource,
  uncitedNumericPaths,
} from '../src/index';

describe('citation path utilities', () => {
  it('collects every numeric leaf with a dotted path', () => {
    expect(numericPaths({ a: 1, b: { c: 2 }, d: 'x', e: [3, { f: 4 }] })).toEqual([
      'a',
      'b.c',
      'e[0]',
      'e[1].f',
    ]);
  });

  it('treats a citation on an ancestor as covering its descendants', () => {
    expect(coversPath('colors.W.common', 'colors.W.common.creatures')).toBe(true);
    expect(coversPath('colors.W.common.creatureCurve', 'colors.W.common.creatureCurve[2].count')).toBe(true);
    expect(coversPath('colors.W.common', 'colors.W.common')).toBe(true);
    expect(coversPath('colors.W.commonly', 'colors.W.common.creatures')).toBe(false);
    expect(coversPath('colors.U.common', 'colors.W.common.creatures')).toBe(false);
  });

  it('resolves and rejects dotted keys against the data', () => {
    expect(resolvePath({ a: { b: 7 } }, 'a.b')).toBe(7);
    expect(resolvePath({ a: { b: 7 } }, 'a.c')).toBeUndefined();
    expect(resolvePath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('reports uncited numbers', () => {
    const citations = {
      a: { source: 's', crossCheck: [], confidence: 'sourced' as const, quote: 'q' },
    };
    expect(uncitedNumericPaths({ a: 1, b: 2 }, citations)).toEqual(['b']);
  });

  it('prefers the most specific citation covering a path', () => {
    const citations = {
      x: { source: 's', crossCheck: [], confidence: 'sourced' as const, quote: 'broad' },
      'x.y': { source: 's', crossCheck: [], confidence: 'sourced' as const, quote: 'narrow' },
    };
    expect(citationForPath(citations, 'x.y.z')?.quote).toBe('narrow');
    expect(citationForPath(citations, 'x.w')?.quote).toBe('broad');
    expect(citationForPath(citations, 'nope')).toBeUndefined();
  });
});

describe('skeleton provenance', () => {
  it('cites every number in the profile, with no stale or unknown references', () => {
    const audit = auditSkeletonCitations();
    expect(audit.uncitedNumbers).toEqual([]);
    expect(audit.danglingCitations).toEqual([]);
    expect(audit.unknownSources).toEqual([]);
  });

  it('gives every source a resolvable URL', () => {
    for (const [id, source] of Object.entries(PLAY_BOOSTER_2024.sources)) {
      expect(source.url, id).toMatch(/^https:\/\//);
      expect(source.title.length, id).toBeGreaterThan(0);
    }
  });

  it('maps a number to the line it came from', () => {
    const citation = skeletonCitation('colors.W.common.avgPower.current');
    expect(citation?.source).toBe('nb16');
    expect(citation?.quote).toContain('2.95');
    expect(citation?.quote).toContain('3.28');
    expect(skeletonSource('nb16')?.url).toContain('nuts-and-bolts-16-play-boosters');
  });

  it('records the black/red/green creature-share discrepancy on the affected numbers', () => {
    for (const color of ['B', 'R', 'G'] as const) {
      const citation = skeletonCitation(`colors.${color}.common.creatureShare.stated`);
      expect(citation?.note, color).toContain('DISCREPANCY');
    }
    expect(skeletonCitation('colors.W.common.creatureShare')?.note).not.toContain('DISCREPANCY');
  });

  it('marks community-sourced numbers as such rather than as canon', () => {
    const nwo = skeletonCitation('complexity.nwoRedFlagBudget');
    expect(nwo?.confidence).toBe('community');
    expect(skeletonSource(nwo?.source ?? '')?.kind).toBe('community');
    expect(nwo?.note).toContain('NO numeric budget');
  });

  it('requires every inferred number to explain itself', () => {
    const inferred = Object.entries(PLAY_BOOSTER_2024.citations).filter(
      ([, citation]) => citation.confidence === 'inferred',
    );
    expect(inferred.length).toBeGreaterThan(0);
    for (const [path, citation] of inferred) {
      expect(citation.note, path).toBeDefined();
      expect((citation.note ?? '').length, path).toBeGreaterThan(20);
    }
  });

  it('names a real source for every cross-check', () => {
    for (const [path, citation] of Object.entries(PLAY_BOOSTER_2024.citations)) {
      for (const id of citation.crossCheck) {
        expect(PLAY_BOOSTER_2024.sources[id], `${path} -> ${id}`).toBeDefined();
      }
    }
  });
});

describe('color-pie provenance', () => {
  it('exposes a citation for every subject', () => {
    const citations = colorPieCitations();
    expect(Object.keys(citations).sort()).toEqual([...COLOR_PIE_SUBJECTS].sort());
    for (const [subject, citation] of Object.entries(citations)) {
      expect(citation.quote.length, subject).toBeGreaterThan(0);
      expect(COLOR_PIE_2021.sources[citation.source], subject).toBeDefined();
    }
  });

  it('is versioned and dated', () => {
    expect(COLOR_PIE_2021.version).toBe(1);
    expect(COLOR_PIE_2021.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(COLOR_PIE_2021.conventions.length).toBeGreaterThan(0);
  });
});
