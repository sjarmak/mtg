import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import {
  classifyLegacyCubeForgeScript,
  loadLegacyCubeSyntaxReview,
} from '../src/legacy-cube/decision-ledger';
import { readForgeScriptArchive } from '../src/printed-card/forge-install';
import {
  forgeSyntaxKey,
  loadForgeSyntaxReview,
  parseForgeSyntaxReview,
} from '../src/printed-card/forge-syntax-review';

const review = loadForgeSyntaxReview();

describe('Forge syntax review table', () => {
  it('keeps every pinned Legacy Cube entry, and only ever adds families to it', () => {
    const byKey = new Map(review.entries.map((entry) => [forgeSyntaxKey(entry), entry]));
    for (const pinned of loadLegacyCubeSyntaxReview()) {
      const shared = byKey.get(forgeSyntaxKey(pinned));
      expect(shared, forgeSyntaxKey(pinned)).toBeDefined();
      expect(shared?.families, forgeSyntaxKey(pinned)).toEqual(expect.arrayContaining([...pinned.families]));
    }
  });

  it('is sorted by kind then token so a review lands in one place', () => {
    const keys = review.entries.map((entry) => `${entry.kind} ${entry.token}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('refuses a duplicate token and a disposition that disagrees with its families', () => {
    const entry = review.entries[0]!;
    expect(() => parseForgeSyntaxReview({ ...review, entries: [entry, entry] })).toThrow(
      /duplicate reviewed token/u,
    );
    const mapped = review.entries.find((candidate) => candidate.disposition === 'mapped')!;
    expect(() => parseForgeSyntaxReview({ ...review, entries: [{ ...mapped, families: [] }] })).toThrow(
      /invalid affirmative syntax disposition/u,
    );
    expect(() => parseForgeSyntaxReview({ ...review, entries: [{ ...entry, kind: 'unknown' }] })).toThrow();
  });

  it('closes every AKH/HOU catalog script with no unknown decision syntax', () => {
    const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
      parsePrintedCardCatalog(
        JSON.parse(
          readFileSync(new URL(`../data/akh-hou/${code}-printed-catalog-v1.json`, import.meta.url), 'utf8'),
        ),
      ),
    );
    const scriptPaths = [
      ...new Set(catalogs.flatMap((catalog) => catalog.cards.map((card) => card.forgeScript))),
    ];
    expect(scriptPaths).toHaveLength(509);
    const archive = readForgeScriptArchive();
    const residual = scriptPaths.flatMap((path) => {
      const bytes = archive.get(path);
      if (bytes === undefined) return [`${path}:missing`];
      return classifyLegacyCubeForgeScript(bytes, review.entries).unknownDecisionSyntax.map(
        (syntax) => `${path}:${syntax}`,
      );
    });
    expect(residual).toEqual([]);
  });
});
