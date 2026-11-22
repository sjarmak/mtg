/** Installed Forge 2.0.14 parity for RTR Ash Zealot. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Ash Zealot Forge export', () => {
  it('emits the graveyard-cast filter and damages the triggering caster', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-086-ash-zealot-forge',
      name: 'Ash Zealot',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 86 },
      manaCost: { R: 2 },
      colors: ['R'],
      subtypes: ['Human', 'Warrior'],
      keywords: ['firstStrike', 'haste'],
      keywordLineGroups: [['firstStrike', 'haste']],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'triggered',
          condition: 'youCastSpell',
          castFromGraveyardByAnyPlayer: true,
          printedSourceReference: 'thisCreature',
          effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'triggeringPlayer' } }],
        },
      ],
    });

    expect(mustTranspile(card)).toContain(
      'T:Mode$ SpellCast | ValidCard$ Card.wasCastFromGraveyard | Execute$ Trig1Effect1 | TriggerZones$ Battlefield | TriggerDescription$ Whenever a player casts a spell from a graveyard, CARDNAME deals 3 damage to that player.',
    );
    expect(mustTranspile(card)).toContain(
      'SVar:Trig1Effect1:DB$ DealDamage | Defined$ TriggeredCardController | NumDmg$ 3',
    );
  });
});
