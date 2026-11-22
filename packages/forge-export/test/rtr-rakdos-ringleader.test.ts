import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const RINGLEADER = parseCard({
  kind: 'creature',
  id: 'rtr-186-rakdos-ringleader-forge',
  name: 'Rakdos Ringleader',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 186 },
  manaCost: { generic: 4, B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Skeleton', 'Warrior'],
  keywords: ['firstStrike'],
  power: 3,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'triggeringPlayer' }, random: true }],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1 } },
      regenerateSelf: true,
      printedSourceReference: 'thisCreature',
      effects: [],
    },
  ],
});

describe('RTR #186 Rakdos Ringleader Forge export', () => {
  it('matches the installed executable script under current Oracle wording', () => {
    expect(mustTranspile(RINGLEADER)).toBe(
      [
        'Name:Rakdos Ringleader',
        'ManaCost:4 B R',
        'Types:Creature Skeleton Warrior',
        'PT:3/1',
        'K:First Strike',
        'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever this creature deals combat damage to a player, that player discards a card at random.',
        'SVar:Trig1Effect1:DB$ Discard | Defined$ TriggeredTarget | NumCards$ 1 | Mode$ Random',
        'A:AB$ Regenerate | Cost$ B | SpellDescription$ Regenerate this creature.',
        'Oracle:First strike\\nWhenever this creature deals combat damage to a player, that player discards a card at random.\\n{B}: Regenerate this creature.',
        '',
      ].join('\n'),
    );
  });
});
