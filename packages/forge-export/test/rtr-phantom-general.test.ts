/** Phantom General parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const GENERAL = parseCard({
  kind: 'creature',
  id: 'rtr-16-phantom-general-forge',
  name: 'Phantom General',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 16 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Spirit', 'Soldier'],
  power: 2,
  toughness: 3,
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      filter: { token: true },
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
  ],
});

describe('Phantom General Forge export', () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(GENERAL)).toBe(
      [
        'Name:Phantom General',
        'ManaCost:3 W',
        'Types:Creature Spirit Soldier',
        'PT:2/3',
        'S:Mode$ Continuous | Affected$ Creature.token+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Creature tokens you control get +1/+1.',
        'DeckHints:Ability$Token',
        'Oracle:Creature tokens you control get +1/+1.',
        '',
      ].join('\n'),
    );
  });
});
