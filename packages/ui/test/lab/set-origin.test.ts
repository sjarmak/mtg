/**
 * The set taxonomy (`mtg-tewc.1`).
 *
 * The playtester's instruction is that the custom/official split be "built from
 * metadata rather than hard-coding UI assumptions", so what is asserted here is
 * that no set code appears in the decision: a document is read, and a set nobody
 * has heard of gets an origin for the same reason the flagship set does. The
 * other half is the label — `official` is the value and **Magic** is the word on
 * screen — and the empty group, which is dropped rather than drawn as a heading
 * with nothing under it.
 */
import { describe, expect, it } from 'vitest';
import {
  SET_ORIGINS,
  SET_ORIGIN_LABELS,
  SET_ORIGIN_ORDER,
  groupSetsByOrigin,
  setOrigin,
} from '../../src/lab/set-origin';
import type { SetOrigin, SetOriginEvidence } from '../../src/lab/set-origin';

/** A row is anything carrying an origin; the grouping reads nothing else. */
function row(stem: string, origin: SetOrigin): { readonly stem: string; readonly origin: SetOrigin } {
  return { stem, origin };
}

describe('what a set document says it is', () => {
  it.each([
    ['a reduced printing, which carries the flag its schema requires', { reduced: true }, 'official'],
    ['a generated set, whose schema has no such flag to carry', {}, 'custom'],
    ['a document that says it plainly is not reduced', { reduced: false }, 'custom'],
  ])('reads %s as %s', (_what, evidence: SetOriginEvidence, expected) => {
    expect(setOrigin(evidence)).toBe(expected);
  });

  it.each(SET_ORIGINS)('takes a declared origin of %s over the evidence', (declared) => {
    // Declared beats derived in both directions, which is the whole point of the
    // field: a set added later needs metadata, not a change to this function.
    expect(setOrigin({ origin: declared, reduced: true })).toBe(declared);
    expect(setOrigin({ origin: declared })).toBe(declared);
  });

  it.each([['nonsense'], [''], [null], [3], [true]])(
    'falls back to the evidence when the declared value is %o, rather than trusting it',
    (junk) => {
      expect(setOrigin({ origin: junk, reduced: true })).toBe('official');
      expect(setOrigin({ origin: junk })).toBe('custom');
    },
  );

  it('decides a set it has never seen, because it reads no set codes', () => {
    // Neither of these is a set this checkout stages, and both get an answer.
    expect(setOrigin({ reduced: true })).toBe('official');
    expect(setOrigin({ origin: 'custom' })).toBe('custom');
  });
});

describe('the groups a picker draws', () => {
  it('says Magic rather than official, which is what the value is called in code', () => {
    expect(SET_ORIGIN_LABELS.official).toBe('Magic');
    expect(SET_ORIGIN_LABELS.custom).toBe('Custom');
    for (const label of Object.values(SET_ORIGIN_LABELS)) expect(label).not.toMatch(/official/i);
  });

  it('puts what this lab made first, and keeps each group in the order it arrived', () => {
    const groups = groupSetsByOrigin([row('m11', 'official'), row('xmp', 'custom'), row('m13', 'official')]);
    expect(groups.map((group) => group.origin)).toEqual([...SET_ORIGIN_ORDER]);
    expect(groups.map((group) => group.label)).toEqual(['Custom', 'Magic']);
    expect(groups[1]?.rows.map((r) => r.stem)).toEqual(['m11', 'm13']);
  });

  it('drops a group nothing is in, rather than drawing an empty heading', () => {
    const groups = groupSetsByOrigin([row('xmp', 'custom')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Custom');
  });

  it('still draws the heading when every set is one kind, so the kind is stated', () => {
    expect(groupSetsByOrigin([row('m11', 'official'), row('m13', 'official')])).toHaveLength(1);
  });

  it('groups nothing into nothing', () => {
    expect(groupSetsByOrigin([])).toEqual([]);
  });
});
