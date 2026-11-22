/** Oak Street Innkeeper parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const OAK_STREET_INNKEEPER = parseCard({
  kind: 'creature',
  id: 'rtr-131-oak-street-innkeeper-forge',
  name: 'Oak Street Innkeeper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 131 },
  colors: ['G'],
  manaCost: { generic: 2, G: 1 },
  subtypes: ['Elf'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      filter: { tapped: true },
      activeDuring: 'turnsOtherThanYours',
      modification: { kind: 'grantKeyword', keyword: 'hexproof' },
    },
  ],
});

describe('Oak Street Innkeeper Forge export', () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(OAK_STREET_INNKEEPER)).toBe(
      [
        'Name:Oak Street Innkeeper',
        'ManaCost:2 G',
        'Types:Creature Elf',
        'PT:1/2',
        'S:Mode$ Continuous | Affected$ Creature.tapped+YouCtrl | AddKeyword$ Hexproof | Condition$ NotPlayerTurn | Description$ During turns other than yours, tapped creatures you control have hexproof.',
        'Oracle:During turns other than yours, tapped creatures you control have hexproof.',
        '',
      ].join('\n'),
    );
  });
});
