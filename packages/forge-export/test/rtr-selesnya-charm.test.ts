import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const SELESNYA_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-194-selesnya-charm-forge',
  name: 'Selesnya Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 194 },
  manaCost: { G: 1, W: 1 },
  colors: ['G', 'W'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          keyword: 'trample',
          target: { kind: 'targetCreature' },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCreature', restriction: { kind: 'minPower', power: 5 } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Knight',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Knight'],
            keywords: ['vigilance'],
          },
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('RTR #194 Selesnya Charm Forge export', () => {
  it('faithfully exports the three current upstream Charm choices', () => {
    expect(mustTranspile(SELESNYA_CHARM)).toBe(
      [
        'Name:Selesnya Charm',
        'ManaCost:W G',
        'Types:Instant',
        'A:SP$ Charm | Choices$ Mode1,Mode2,Mode3',
        'SVar:Mode1:DB$ Pump | ValidTgts$ Creature | NumAtt$ +2 | NumDef$ +2 | KW$ Trample | SpellDescription$ Target creature gets +2/+2 and gains trample until end of turn.',
        'SVar:Mode2:DB$ ChangeZone | ValidTgts$ Creature.powerGE5 | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target creature with power 5 or greater.',
        'SVar:Mode3:DB$ Token | TokenScript$ w_2_2_knight_vigilance | TokenOwner$ You | SpellDescription$ Create a 2/2 white Knight creature token with vigilance.',
        'DeckHas:Ability$Token',
        'Oracle:Choose one —\\n• Target creature gets +2/+2 and gains trample until end of turn.\\n• Exile target creature with power 5 or greater.\\n• Create a 2/2 white Knight creature token with vigilance.',
        '',
      ].join('\n'),
    );
  });
});
