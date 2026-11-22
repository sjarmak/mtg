/** Armory Guard parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const GUARD = parseCard({
  kind: 'creature',
  id: 'rtr-2-armory-guard-forge',
  name: 'Armory Guard',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 2 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Giant', 'Soldier'],
  power: 2,
  toughness: 5,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'grantKeyword', keyword: 'vigilance' },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Gate', atLeast: 1 },
      printedSubjectReference: 'thisCreature',
    },
  ],
});

describe('Armory Guard Forge export', () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(GUARD)).toBe(
      [
        'Name:Armory Guard',
        'ManaCost:3 W',
        'Types:Creature Giant Soldier',
        'PT:2/5',
        'S:Mode$ Continuous | Affected$ Card.Self | AddKeyword$ Vigilance | IsPresent$ Gate.YouCtrl | Description$ CARDNAME has vigilance as long as you control a Gate.',
        'DeckHints:Type$Gate',
        'Oracle:This creature has vigilance as long as you control a Gate.',
        '',
      ].join('\n'),
    );
  });
});
