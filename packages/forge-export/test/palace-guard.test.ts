/** Palace Guard against Forge's current checked-in card script. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PALACE_GUARD = parseCard({
  kind: 'creature',
  id: 'm11-24-palace-guard-forge',
  name: 'Palace Guard',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 24 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  subtypes: ['Human', 'Soldier'],
  power: 1,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'canBlockAnyNumber' },
    },
  ],
});

describe('Palace Guard Forge export', () => {
  it('emits Forge current card source exactly', () => {
    expect(mustTranspile(PALACE_GUARD)).toBe(
      [
        'Name:Palace Guard',
        'ManaCost:2 W',
        'Types:Creature Human Soldier',
        'PT:1/4',
        'S:Mode$ Continuous | Affected$ Card.Self | CanBlockAny$ True | Description$ CARDNAME can block any number of creatures.',
        'Oracle:Palace Guard can block any number of creatures.',
        '',
      ].join('\n'),
    );
  });
});
