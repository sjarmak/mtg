/**
 * Pure helpers behind `tools/adjudicate.ts`: argument parsing, resume logic
 * and immutable answer recording. The interactive `readline` shell around
 * these is not exercised here on purpose — see `../../src/critic/adjudication.ts`'s
 * docblock for why the split exists.
 */
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answeredSlotIds,
  parseAdjudicateArgs,
  pendingEntries,
  recordAnswer,
} from '../../src/critic/adjudication';
import type { AdjudicationAnswer, AdjudicationFile } from '../../src/critic/records';
import { emptyAdjudicationFile } from '../../src/critic/records';
import type { SampledEntry } from '../../src/critic/sample';
import { testEntry } from './support';

const defaultOutPath = (seed: string): string => `/default/out/${seed}.json`;

describe('parseAdjudicateArgs', () => {
  it('falls back to every default when given no flags', () => {
    const options = parseAdjudicateArgs([], 'default-seed', 60, defaultOutPath);
    expect(options).toStrictEqual({
      seed: 'default-seed',
      size: 60,
      outPath: '/default/out/default-seed.json',
    });
  });

  it('reads --seed, --size and --rater', () => {
    const options = parseAdjudicateArgs(
      ['--seed', 'my-seed', '--size', '12', '--rater', 'the playtester'],
      'default-seed',
      60,
      defaultOutPath,
    );
    expect(options.seed).toBe('my-seed');
    expect(options.size).toBe(12);
    expect(options.rater).toBe('the playtester');
    expect(options.outPath).toBe('/default/out/my-seed.json');
  });

  it('keeps an absolute --out path as given', () => {
    const options = parseAdjudicateArgs(['--out', '/abs/path/file.json'], 'seed', 60, defaultOutPath);
    expect(options.outPath).toBe('/abs/path/file.json');
  });

  it('resolves a relative --out path against the working directory', () => {
    const options = parseAdjudicateArgs(['--out', 'relative/file.json'], 'seed', 60, defaultOutPath);
    expect(isAbsolute(options.outPath)).toBe(true);
    expect(options.outPath.endsWith('relative/file.json')).toBe(true);
  });

  it('rejects a non-positive or non-integer --size', () => {
    expect(() => parseAdjudicateArgs(['--size', '0'], 'seed', 60, defaultOutPath)).toThrow(
      /positive integer/,
    );
    expect(() => parseAdjudicateArgs(['--size', 'abc'], 'seed', 60, defaultOutPath)).toThrow(
      /positive integer/,
    );
    expect(() => parseAdjudicateArgs(['--size', '4.5'], 'seed', 60, defaultOutPath)).toThrow(
      /positive integer/,
    );
  });

  it('carries no rater key at all when --rater is absent', () => {
    const options = parseAdjudicateArgs([], 'seed', 60, defaultOutPath);
    expect('rater' in options).toBe(false);
  });
});

function answer(slotId: string): AdjudicationAnswer {
  return {
    slotId,
    cardName: `Card ${slotId}`,
    position: 1,
    criteria: [{ criterion: 'mechanicIntent', label: 'faithful' }],
    overall: { label: 'faithful' },
    answeredAt: '2026-08-15T00:00:00.000Z',
  };
}

describe('answeredSlotIds', () => {
  it('collects the slot ids already answered', () => {
    const file: AdjudicationFile = { ...emptyAdjudicationFile('s', 2), answers: [answer('A'), answer('B')] };
    expect(answeredSlotIds(file)).toStrictEqual(new Set(['A', 'B']));
  });

  it('is empty for a fresh file', () => {
    expect(answeredSlotIds(emptyAdjudicationFile('s', 2)).size).toBe(0);
  });
});

function sampled(slotId: string, position: number): SampledEntry {
  return { entry: testEntry({ id: slotId }), position };
}

describe('pendingEntries', () => {
  it('returns the whole sample when nothing is answered yet', () => {
    const sample = [sampled('A', 1), sampled('B', 2), sampled('C', 3)];
    const file = emptyAdjudicationFile('s', 3);
    expect(pendingEntries(sample, file).map((s) => s.entry.slot.id)).toStrictEqual(['A', 'B', 'C']);
  });

  it('skips already-answered slots, keeping the original drawn order', () => {
    const sample = [sampled('A', 1), sampled('B', 2), sampled('C', 3)];
    const file = { ...emptyAdjudicationFile('s', 3), answers: [answer('B')] };
    expect(pendingEntries(sample, file).map((s) => s.entry.slot.id)).toStrictEqual(['A', 'C']);
  });

  it('is empty once every slot in the sample has been answered', () => {
    const sample = [sampled('A', 1), sampled('B', 2)];
    const file = { ...emptyAdjudicationFile('s', 2), answers: [answer('A'), answer('B')] };
    expect(pendingEntries(sample, file)).toStrictEqual([]);
  });
});

describe('recordAnswer', () => {
  it('appends the answer without mutating the file passed in', () => {
    const original = emptyAdjudicationFile('s', 2);
    const next = recordAnswer(original, answer('A'));
    expect(original.answers).toStrictEqual([]);
    expect(next.answers).toStrictEqual([answer('A')]);
    expect(next).not.toBe(original);
  });

  it('preserves earlier answers when appending a new one', () => {
    const withOne = recordAnswer(emptyAdjudicationFile('s', 2), answer('A'));
    const withTwo = recordAnswer(withOne, answer('B'));
    expect(withTwo.answers.map((a) => a.slotId)).toStrictEqual(['A', 'B']);
    expect(withOne.answers.map((a) => a.slotId)).toStrictEqual(['A']);
  });
});
