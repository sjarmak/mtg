/** Installed Forge parity for RTR Rakdos, Lord of Riots. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const RAKDOS = parseCard({
  kind: 'creature',
  id: 'rtr-187-rakdos-lord-of-riots-forge',
  name: 'Rakdos, Lord of Riots',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 187 },
  manaCost: { B: 2, R: 2 },
  colors: ['B', 'R'],
  supertypes: ['legendary'],
  subtypes: ['Demon'],
  power: 6,
  toughness: 6,
  keywords: ['flying', 'trample'],
  opponentsLifeLostThisTurnCasting: true,
});

describe('Rakdos, Lord of Riots Forge export', () => {
  it('emits the installed linked permission, reduction, and life-loss SVar', () => {
    expect(mustTranspile(RAKDOS).split('\n')).toEqual([
      'Name:Rakdos, Lord of Riots',
      'ManaCost:B B R R',
      'Types:Legendary Creature Demon',
      'PT:6/6',
      'K:Flying',
      'K:Trample',
      "S:Mode$ CantBeCast | ValidCard$ Card.Self | CheckSVar$ X | SVarCompare$ EQ0 | EffectZone$ All | Description$ You can't cast this spell unless an opponent lost life this turn.",
      'S:Mode$ ReduceCost | ValidCard$ Creature | Type$ Spell | Activator$ You | Amount$ X | Description$ Creature spells you cast cost {1} less to cast for each 1 life your opponents have lost this turn.',
      'SVar:X:Count$LifeOppsLostThisTurn',
      "Oracle:You can't cast this spell unless an opponent lost life this turn.\\nFlying, trample\\nCreature spells you cast cost {1} less to cast for each 1 life your opponents have lost this turn.",
      '',
    ]);
  });
});
