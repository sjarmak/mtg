/** Ogre Jailbreaker parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const JAILBREAKER = parseCard({
  kind: 'creature',
  id: 'rtr-72-ogre-jailbreaker-forge',
  name: 'Ogre Jailbreaker',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 72 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Ogre', 'Rogue'],
  keywordAbilities: [{ kind: 'defender' }],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'canAttackAsThoughNoDefender' },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Gate', atLeast: 1 },
      printedSubjectReference: 'thisCreature',
    },
  ],
});

describe('Ogre Jailbreaker Forge export', () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(JAILBREAKER)).toBe(
      [
        'Name:Ogre Jailbreaker',
        'ManaCost:3 B',
        'Types:Creature Ogre Rogue',
        'PT:4/4',
        'K:Defender',
        "S:Mode$ CanAttackDefender | ValidCard$ Card.Self | IsPresent$ Gate.YouCtrl | Description$ CARDNAME can attack as though it didn't have defender as long as you control a Gate.",
        'SVar:BuffedBy:Gate',
        'DeckNeeds:Type$Gate',
        "Oracle:Defender\\nThis creature can attack as though it didn't have defender as long as you control a Gate.",
        '',
      ].join('\n'),
    );
  });
});
