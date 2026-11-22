/** Source-attested Forge parity for RTR #134's three-card basic-land search. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'sorcery',
  id: 'rtr-134',
  name: 'Seek the Horizon',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 134 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'searchLibrary',
      filter: { cardTypes: ['land'], supertypes: ['basic'] },
      count: 3,
      reveal: true,
      destination: 'hand',
    },
  ],
});

describe('RTR Seek the Horizon Forge parity', () => {
  it('exports one ChangeZone search for three basic lands into hand', () => {
    const line = mustTranspile(CARD)
      .split('\n')
      .find((candidate) => candidate.startsWith('A:'));

    expect(line).toContain('SP$ ChangeZone');
    expect(line).toContain('Origin$ Library');
    expect(line).toContain('Destination$ Hand');
    expect(line).toContain('ChangeType$ Land.Basic');
    expect(line).toContain('ChangeNum$ 3');
    expect(line).toContain('ShuffleNonMandatory$ True');
  });
});
