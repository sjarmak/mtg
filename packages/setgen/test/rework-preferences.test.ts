/**
 * `rework-preferences.ts` in two parts: a valid file parses, and each rejection
 * case names itself rather than throwing a shapeless schema dump at whoever was
 * editing the file by hand.
 *
 * The third thing worth checking, that a committed rework file names only cards
 * its set actually has, reads a whole set file by path, so it lives beside that
 * set rather than here. Everything in this file states its own cards.
 */
import { describe, expect, it } from 'vitest';
import { parseReworkFile } from '../src/rework-preferences';

describe('parseReworkFile', () => {
  it('accepts a well-formed file', () => {
    const file = parseReworkFile({
      formatVersion: 1,
      requests: [
        { cardId: 'set-card-one', verdict: 'rework', note: 'costed too low for what it does' },
        { cardId: 'set-card-two', verdict: 'watch', note: 'strong, keep an eye on it post-playtest' },
      ],
    });
    expect(file.requests).toHaveLength(2);
    expect(file.requests[0]?.verdict).toBe('rework');
  });

  it('accepts an empty requests list', () => {
    const file = parseReworkFile({ formatVersion: 1, requests: [] });
    expect(file.requests).toEqual([]);
  });

  it('rejects an unrecognized formatVersion', () => {
    expect(() => parseReworkFile({ formatVersion: 2, requests: [] })).toThrow();
  });

  it('rejects an unknown top-level key', () => {
    expect(() => parseReworkFile({ formatVersion: 1, requests: [], extra: true })).toThrow();
  });

  it('rejects an unknown key on a request entry', () => {
    expect(() =>
      parseReworkFile({
        formatVersion: 1,
        requests: [{ cardId: 'set-card-one', verdict: 'watch', note: 'fine', priority: 1 }],
      }),
    ).toThrow();
  });

  it('rejects an empty note', () => {
    expect(() =>
      parseReworkFile({
        formatVersion: 1,
        requests: [{ cardId: 'set-card-one', verdict: 'watch', note: '' }],
      }),
    ).toThrow(/note/);
  });

  it('rejects a verdict outside the three grades', () => {
    expect(() =>
      parseReworkFile({
        formatVersion: 1,
        requests: [{ cardId: 'set-card-one', verdict: 'bad', note: 'not workable' }],
      }),
    ).toThrow();
  });

  it('rejects a duplicate cardId', () => {
    expect(() =>
      parseReworkFile({
        formatVersion: 1,
        requests: [
          { cardId: 'set-card-one', verdict: 'watch', note: 'first note' },
          { cardId: 'set-card-one', verdict: 'rework', note: 'second note' },
        ],
      }),
    ).toThrow(/set-card-one/);
  });

  it('names the offending entry in the error message', () => {
    expect(() =>
      parseReworkFile({
        formatVersion: 1,
        requests: [{ cardId: 'set-card-one', verdict: 'watch', note: '' }],
      }),
    ).toThrow(/requests\.0\.note/);
  });
});
