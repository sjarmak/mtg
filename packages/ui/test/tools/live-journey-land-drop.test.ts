/**
 * `mtg-rdtno`: the live journey's Commander precon step spent all 30
 * decisions passing priority and discarding to hand size because it only
 * recognized a basic land as a legal move, never a starter deck's nonbasics
 * (`Choked Estuary`, `Akoum Refuge`, ...). The recognizer this covers is what
 * `live-journey.ts`'s `oneDecision` in-page script embeds by value, so a
 * change here is a change there too.
 */
import { describe, expect, it } from 'vitest';
import { landDropName, LAND_DROP_LABEL_PREFIX } from '../../tools/live-journey-land-drop';

describe('landDropName', () => {
  it('names a basic land drop', () => {
    expect(landDropName('Play Swamp')).toBe('Swamp');
  });

  it('names a nonbasic land drop the same way', () => {
    expect(landDropName('Play Choked Estuary')).toBe('Choked Estuary');
  });

  it('returns null for a cast move, which is never prefixed with Play', () => {
    expect(landDropName('Cast Sol Ring')).toBeNull();
  });

  it('returns null for a pass or a halt', () => {
    expect(landDropName('Pass priority')).toBeNull();
    expect(landDropName('Continue')).toBeNull();
  });

  it('does not match a move that only happens to contain the word Play', () => {
    expect(landDropName('Replay from the graveyard')).toBeNull();
  });

  it('uses the exported prefix, not a private literal', () => {
    expect(landDropName(`${LAND_DROP_LABEL_PREFIX}Akoum Refuge`)).toBe('Akoum Refuge');
  });
});
