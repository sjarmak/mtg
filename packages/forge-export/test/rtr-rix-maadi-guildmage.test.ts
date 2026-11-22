/** Installed Forge 2.0.14 parity for RTR #192. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-192-rix-maadi-guildmage-forge',
  name: 'Rix Maadi Guildmage',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 192 },
  manaCost: { B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Human', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { B: 1, R: 1 } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -1,
          toughness: -1,
          target: { kind: 'targetCreature', filter: { combat: 'blocking' } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1, R: 1 } },
      effects: [
        {
          kind: 'loseLife',
          amount: 1,
          target: {
            kind: 'targetPlayer',
            restriction: { kind: 'playerLostLifeThisTurn' },
          },
        },
      ],
    },
  ],
} as CardInput);

describe('RTR #192 Rix Maadi Guildmage Forge export', () => {
  it('emits both installed selectors and the hostile blocking-pump hint', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        'Name:Rix Maadi Guildmage',
        'ManaCost:B R',
        'Types:Creature Human Shaman',
        'PT:2/2',
        'A:AB$ Pump | Cost$ B R | ValidTgts$ Creature.blocking | NumAtt$ -1 | NumDef$ -1 | IsCurse$ True | SpellDescription$ Target blocking creature gets -1/-1 until end of turn.',
        'A:AB$ LoseLife | Cost$ B R | ValidTgts$ Player.LostLifeThisTurn | TgtPrompt$ Select target player who lost life this turn | LifeAmount$ 1 | SpellDescription$ Target player who lost life this turn loses 1 life.',
        'Oracle:{B}{R}: Target blocking creature gets -1/-1 until end of turn.\\n{B}{R}: Target player who lost life this turn loses 1 life.',
        '',
      ].join('\n'),
    );
  });
});
