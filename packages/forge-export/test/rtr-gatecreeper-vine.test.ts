/** Gatecreeper Vine parity against the installed Forge 2.0.14 script. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const VINE = parseCard({
  kind: 'creature',
  id: 'rtr-124-gatecreeper-vine-forge',
  name: 'Gatecreeper Vine',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 124 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  subtypes: ['Plant'],
  power: 0,
  toughness: 2,
  keywordAbilities: [{ kind: 'defender' }],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      optional: true,
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'searchLibrary',
          filter: {
            anyOf: [{ cardTypes: ['land'], supertypes: ['basic'] }, { subtypes: ['Gate'] }],
          },
          destination: 'hand',
          reveal: true,
        },
      ],
    },
  ],
});

describe('Gatecreeper Vine Forge export', () => {
  it('emits the installed comma-separated whole-spec search', () => {
    expect(mustTranspile(VINE)).toContain('ChangeType$ Land.Basic,Card.Gate');
  });
});
