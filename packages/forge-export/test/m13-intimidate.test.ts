/** Forge parity for M13 Intimidate uses Forge's native keyword spelling. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('M13 Intimidate Forge export', () => {
  it('emits Bladetusk Boar as K:Intimidate', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-bladetusk-boar',
      name: 'Bladetusk Boar',
      rarity: 'common',
      set: { code: 'M13', collectorNumber: 121 },
      manaCost: { generic: 3, R: 1 },
      colors: ['R'],
      subtypes: ['Boar'],
      power: 3,
      toughness: 2,
      keywordAbilities: [{ kind: 'intimidate' }] as never,
    });

    const script = mustTranspile(card);
    expect(script).toContain('K:Intimidate');
    expect(script).toContain('Oracle:Intimidate');
  });
});
