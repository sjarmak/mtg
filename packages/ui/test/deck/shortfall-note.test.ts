// @vitest-environment node
/**
 * The gap between what a deck is missing and what the screen says about it.
 *
 * `@mtg/deckbuild` writes for the slice CLI and the balance gate, so its
 * wording is a log line — *spell slots: 0/36 filled (36 short)* — and both
 * builders used to draw it unchanged. These tests pin the two halves apart: the
 * producer keeps its string, because gates assert on it, and nothing the
 * builder shows a person carries a colon-and-ratio readout.
 */
import { describe, expect, it } from 'vitest';
import { formatShortfall } from '@mtg/deckbuild';
import type { Shortfall } from '@mtg/deckbuild';
import { shortfallNote } from '../../src/routes/deck/shortfall-note';

const EVERY_KIND: readonly Shortfall[] = [
  { kind: 'spellSlots', target: 23, achieved: 20, missing: 3 },
  { kind: 'curveSlot', bucket: 3, target: 4, achieved: 3, missing: 1 },
  { kind: 'creatureFloor', target: 14, achieved: 8, missing: 6 },
  { kind: 'colorSources', color: 'W', target: 9, achieved: 6, missing: 3 },
];

describe('what the builder says a deck is missing', () => {
  it('says it in sentences rather than in the producer readout', () => {
    for (const shortfall of EVERY_KIND) {
      const note = shortfallNote(shortfall);
      expect(note, `${shortfall.kind} reads like a log line`).not.toContain(':');
      expect(note, `${shortfall.kind} carries a filled-over-target ratio`).not.toContain('/');
      expect(note.endsWith('.'), `${shortfall.kind} is not a sentence`).toBe(true);
      expect(note).not.toBe(formatShortfall(shortfall));
    }
  });

  it('counts one of a thing without saying "1 cards"', () => {
    expect(shortfallNote({ kind: 'curveSlot', bucket: 2, target: 4, achieved: 3, missing: 1 })).toContain(
      '1 more card ',
    );
    expect(shortfallNote({ kind: 'spellSlots', target: 23, achieved: 21, missing: 2 })).toContain(
      '2 more cards ',
    );
  });

  it('names the color in words, because a bare W is the producer alphabet', () => {
    expect(shortfallNote({ kind: 'colorSources', color: 'W', target: 9, achieved: 6, missing: 3 })).toBe(
      '3 more sources of white mana.',
    );
  });

  it('leaves the producer wording alone for the gates that assert on it', () => {
    expect(formatShortfall({ kind: 'spellSlots', target: 36, achieved: 0, missing: 36 })).toBe(
      'spell slots: 0/36 filled (36 short)',
    );
  });
});
