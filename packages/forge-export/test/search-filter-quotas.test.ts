/** Forge parity for keyword-union and heterogeneous-quota searches. */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';

describe('Mwonvuli Beast Tracker search', () => {
  it('exports the source-attested OR as whole Forge selector specs', () => {
    const card = spell('Beast Tracker Search', [
      {
        kind: 'searchLibrary',
        filter: {
          cardTypes: ['creature'],
          keywords: ['deathtouch', 'hexproof', 'reach', 'trample'],
        },
        destination: 'libraryTop',
        reveal: true,
      } as unknown as Effect,
    ]);
    expect(mustTranspile(card)).toContain(
      'ChangeType$ Creature.withDeathtouch,Creature.withHexproof,Creature.withReach,Creature.withTrample',
    );
  });
});

describe('Gem of Becoming search', () => {
  it('exports the source-attested EACH selector and one shared shuffle', () => {
    const card = spell('Gem Search', [
      {
        kind: 'searchLibrary',
        filterQuotas: [
          { filter: { subtypes: ['Island'] }, count: 1 },
          { filter: { subtypes: ['Swamp'] }, count: 1 },
          { filter: { subtypes: ['Mountain'] }, count: 1 },
        ],
        destination: 'hand',
        reveal: true,
      } as unknown as Effect,
    ]);
    const script = mustTranspile(card);
    expect(script).toContain('ChangeType$ EACH Island & Swamp & Mountain');
    // Forge's ChangeZone search reveals its chosen cards intrinsically; the
    // upstream Gem script carries no separate Reveal parameter.
    expect(script).not.toContain('Reveal$');
    expect(script).toContain('ShuffleNonMandatory$ True');
  });
});
