/**
 * The vocabulary gate, and the asymmetry that is the whole of it.
 *
 * The freshness test at the bottom is the gate itself: it runs in the `unit`
 * project, which is what CI runs, so narrowing a DSL enum reddens this file on
 * the same commit that narrows it. Everything above it holds the two verdicts to
 * the messages a developer actually reads, because a gate whose failure text
 * does not say what to do next is a gate people learn to skip.
 *
 * The diff is exercised against stated vocabularies rather than against the real
 * one. A test that narrowed the live tuples to watch the failure would have to
 * edit the source the gate reads, and would then be asserting that the edit
 * happened rather than that the gate caught it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTER_KINDS, CounterKindSchema, RETIRED_VOCABULARY, retiredNames } from '../src/index';
import type { RetiredNames } from '../src/index';
import {
  currentVocabulary,
  diffVocabulary,
  parseVocabularySnapshotArgs,
  refreshVocabularySnapshot,
  serializeVocabularySnapshot,
  vocabularyReport,
  vocabularyVerdict,
  VOCABULARY_SNAPSHOT_PATH,
} from '../tools/vocabulary-snapshot';

/** No retirement recorded anywhere: the default state of every enum but one. */
const NOTHING_RETIRED = (): RetiredNames => ({});

function reportFor(
  committed: Readonly<Record<string, readonly string[]>>,
  current: Readonly<Record<string, readonly string[]>>,
  lookup: (enumName: string) => RetiredNames = NOTHING_RETIRED,
): { readonly verdict: string; readonly text: string } {
  const drift = diffVocabulary(committed, current, lookup);
  const verdict = vocabularyVerdict(drift, true);
  return { verdict, text: vocabularyReport(drift, verdict, current, false) };
}

describe('deriving the vocabulary', () => {
  it('collects every exported tuple of strings and nothing else', () => {
    expect(
      currentVocabulary({
        GOOD: ['a', 'b'],
        EMPTY: [],
        MIXED: ['a', 1],
        RECORDS: [{ id: 'x' }],
        NOT_AN_ARRAY: { a: 1 },
        aFunction: () => 'x',
      }),
    ).toStrictEqual({ GOOD: ['a', 'b'] });
  });

  it('reaches every module the package exports enums from, not a list of them', () => {
    const derived = currentVocabulary();
    // One from each of the four source files that declare tuples today. A fifth
    // file added tomorrow is covered without touching this test, which is the
    // property being asserted; these four only prove the reach is real.
    expect(Object.keys(derived)).toEqual(
      expect.arrayContaining(['RARITIES', 'COUNTER_KINDS', 'LIBRARY_POSITIONS', 'VIOLATION_CODES']),
    );
    for (const [name, members] of Object.entries(derived)) {
      expect(members.length, name).toBeGreaterThan(0);
      expect(new Set(members).size, name).toBe(members.length);
    }
  });
});

describe('an addition', () => {
  it('is mechanical, names what appeared, and asks for the refresh', () => {
    const { verdict, text } = reportFor({ RARITIES: ['common'] }, { RARITIES: ['common', 'mythic'] });
    expect(verdict).toBe('stale');
    expect(text).toBe(
      'RARITIES gained mythic\nthe committed vocabulary snapshot is stale; run npm run vocabulary:refresh\n',
    );
  });

  it('covers a whole new enum the same way', () => {
    const { verdict, text } = reportFor({}, { NEW_KINDS: ['first', 'second'] });
    expect(verdict).toBe('stale');
    expect(text).toContain('NEW_KINDS gained first, second');
  });
});

describe('a removal', () => {
  it('fails hard, names the dropped member, and points at the retired table', () => {
    const { verdict, text } = reportFor({ COUNTER_KINDS: ['horn', 'wing'] }, { COUNTER_KINDS: ['horn'] });
    expect(verdict).toBe('narrowed');
    expect(text).toBe(
      [
        'COUNTER_KINDS no longer declares wing',
        'narrowing a DSL enum invalidates every generated artifact already on disk that names the dropped member, and nothing in CI regenerates those artifacts',
        'record COUNTER_KINDS.wing in packages/dsl/src/retired-vocabulary.ts, mapping each retired name to the member that carries its meaning now, then run npm run vocabulary:refresh',
        'the snapshot was not rewritten: a refresh that accepted an unrecorded removal would be the silent narrowing it exists to catch',
        '',
      ].join('\n'),
    );
  });

  it('is a rename when an addition comes with it, and the rename still fails hard', () => {
    const { verdict, text } = reportFor({ COUNTER_KINDS: ['saberHorn'] }, { COUNTER_KINDS: ['horn'] });
    expect(verdict).toBe('narrowed');
    expect(text).toContain('COUNTER_KINDS gained horn');
    expect(text).toContain('COUNTER_KINDS no longer declares saberHorn');
  });

  it('drops to the mechanical verdict once the retirement is recorded', () => {
    const { verdict, text } = reportFor(
      { COUNTER_KINDS: ['saberHorn'] },
      { COUNTER_KINDS: ['horn'] },
      () => ({
        saberHorn: 'horn',
      }),
    );
    expect(verdict).toBe('stale');
    expect(text).toContain('COUNTER_KINDS dropped saberHorn, recorded as horn');
    expect(text).toContain('run npm run vocabulary:refresh');
  });

  it('reads the recorded name from the enum it belongs to, not from any enum', () => {
    const { verdict } = reportFor({ RARITIES: ['saberHorn'] }, { RARITIES: [] }, retiredNames);
    expect(verdict).toBe('narrowed');
  });
});

describe('the retired table', () => {
  it('records the one narrowing that has happened, and counters.ts still parses it', () => {
    expect(retiredNames('COUNTER_KINDS')).toStrictEqual({ saberHorn: 'horn' });
    expect(retiredNames('RARITIES')).toStrictEqual({});
    expect(CounterKindSchema.parse('saberHorn')).toBe('horn');
    expect(CounterKindSchema.parse('horn')).toBe('horn');
  });

  it('holds no stale entry: every key is a live enum and every value a live member', () => {
    const derived = currentVocabulary();
    for (const [enumName, retired] of Object.entries(RETIRED_VOCABULARY)) {
      const members = derived[enumName];
      expect(members, enumName).toBeDefined();
      for (const [retiredName, currentName] of Object.entries(retired)) {
        expect(members, `${enumName}.${currentName}`).toContain(currentName);
        expect(members, `${enumName}.${retiredName}`).not.toContain(retiredName);
      }
    }
  });

  it('is the only copy of the counter aliases', () => {
    const source = readFileSync(new URL('../src/counters.ts', import.meta.url), 'utf8');
    expect(source).toContain("retiredNames('COUNTER_KINDS')");
    expect(source).not.toContain("saberHorn: 'horn'");
    expect(COUNTER_KINDS).toContain('horn');
  });
});

describe('the refresh', () => {
  it('refuses to rewrite a snapshot the live vocabulary has narrowed', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vocabulary-snapshot-'));
    const path = join(scratch, 'vocabulary-snapshot.json');
    try {
      const current = currentVocabulary();
      const invented = { ...current, RARITIES: [...(current.RARITIES ?? []), 'ultraRare'] };
      const before = await serializeVocabularySnapshot(invented);
      writeFileSync(path, before, { encoding: 'utf8' });
      const result = await refreshVocabularySnapshot(false, path);
      expect(result.verdict).toBe('narrowed');
      expect(result.wrote).toBe(false);
      expect(result.text).toContain('RARITIES no longer declares ultraRare');
      expect(readFileSync(path, 'utf8')).toBe(before);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('takes only --check and says so about anything else', () => {
    expect(parseVocabularySnapshotArgs([])).toStrictEqual({ check: false });
    expect(parseVocabularySnapshotArgs(['--check'])).toStrictEqual({ check: true });
    expect(() => parseVocabularySnapshotArgs(['--out', 'x'])).toThrow(
      /unknown vocabulary snapshot flag --out/,
    );
  });

  /**
   * The gate. `text` is asserted before anything else on purpose: it is the
   * gate's own report, so a failure here prints the enum, the member and the
   * command rather than a diff of two objects. A developer who narrows a tuple
   * reads the same sentence from CI that the tool prints locally.
   */
  it('finds the committed snapshot already fresh', async () => {
    const { verdict, drift, wrote, text } = await refreshVocabularySnapshot(true);
    expect(text).toMatch(/^the vocabulary snapshot is fresh: \d+ enums, \d+ members\n$/);
    expect(drift).toStrictEqual({ added: [], dropped: [] });
    expect(wrote).toBe(false);
    expect(verdict).toBe('fresh');
    expect(readFileSync(VOCABULARY_SNAPSHOT_PATH, 'utf8')).toContain('"COUNTER_KINDS"');
  });
});
