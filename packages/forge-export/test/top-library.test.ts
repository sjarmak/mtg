/** Forge export for M13's bounded top-library trio. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const INDEX = parseCard({
  kind: 'sorcery',
  id: 'm13-055-index-forge',
  name: 'Index',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 55 },
  manaCost: { U: 1 },
  colors: ['U'],
  effects: [{ kind: 'reorderTopLibrary', count: 5 }],
});

const AUGUR = parseCard({
  kind: 'creature',
  id: 'm13-043-augur-forge',
  name: 'Augur of Bolas',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 43 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Merfolk', 'Wizard'],
  power: 1,
  toughness: 3,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'selectFromTopLibrary',
          count: 3,
          filter: { cardTypes: ['instant', 'sorcery'] },
          optional: true,
          reveal: true,
          destination: 'hand',
          rest: 'bottom',
        },
      ],
    },
  ],
});

const SPHINX = parseCard({
  kind: 'creature',
  id: 'm13-069-sphinx-forge',
  name: 'Sphinx of Uthuun',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 69 },
  manaCost: { generic: 5, U: 2 },
  colors: ['U'],
  subtypes: ['Sphinx'],
  keywords: ['flying'],
  power: 5,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'separateTopLibraryIntoPiles', count: 5 }],
    },
  ],
});

describe('top-library Forge export', () => {
  it('exports Index as a complete ordered five-card Dig', () => {
    expect(mustTranspile(INDEX)).toContain(
      'A:SP$ Dig | DigNum$ 5 | ChangeNum$ All | DestinationZone$ Library | DestinationPosition$ Top',
    );
  });

  it('exports Augur with its spell filter, optional change, reveal, and ordered bottom remainder', () => {
    const script = mustTranspile(AUGUR);
    expect(script).toContain('DB$ Dig | DigNum$ 3 | ChangeNum$ 1');
    expect(script).toContain('ChangeValid$ Card.Instant,Card.Sorcery');
    expect(script).toContain('DestinationZone$ Hand');
    expect(script).toContain('RestRandomOrder$ False | RestZone$ Library | RestPosition$ Bottom');
  });

  it('exports Sphinx as the revealed five-card MultiplePiles protocol', () => {
    expect(mustTranspile(SPHINX)).toContain('DB$ MultiplePiles | Zone$ Library | Amount$ 5 | Reveal$ True');
  });
});
