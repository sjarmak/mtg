/** Niv-Mizzet, Dracogenius's exact source-damage trigger composition. */
import { describe, expect, it } from 'vitest';
import {
  CardSchema,
  ModelTriggerConditionSchema,
  TriggerConditionSchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '../src/index';

const NIV_MIZZET = parseCard({
  kind: 'creature',
  id: 'rtr-183-niv-mizzet-dracogenius',
  name: 'Niv-Mizzet, Dracogenius',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 183 },
  manaCost: { generic: 2, U: 2, R: 2 },
  colors: ['U', 'R'],
  supertypes: ['legendary'],
  subtypes: ['Dragon', 'Wizard'],
  power: 5,
  toughness: 5,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      includesNoncombatDamage: true,
      printedSourceReference: 'cardNameBeforeComma',
      optional: true,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      printedSourceReference: 'cardNameBeforeComma',
      cost: { mana: { U: 1, R: 1 } },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
  ],
});

describe('Niv-Mizzet, Dracogenius composition', () => {
  it('keeps the damage trigger engine-only and renders current Oracle ordering', () => {
    expect(TriggerConditionSchema.safeParse('selfDealsCombatDamageToPlayer').success).toBe(true);
    expect(ModelTriggerConditionSchema.safeParse('selfDealsCombatDamageToPlayer').success).toBe(false);
    expect(validateCard(NIV_MIZZET)).toEqual([]);
    expect(renderOracleText(NIV_MIZZET)).toBe(
      'Flying\nWhenever Niv-Mizzet deals damage to a player, you may draw a card.\n{U}{R}: Niv-Mizzet deals 1 damage to any target.',
    );
  });

  it('refuses the noncombat refinement on an unrelated trigger condition', () => {
    const invalid = CardSchema.parse({
      ...NIV_MIZZET,
      abilities: [
        {
          ...NIV_MIZZET.abilities[0],
          condition: 'selfEnters',
          includesNoncombatDamage: true,
        },
      ],
    });
    expect(validateCard(invalid).map((entry) => entry.message)).toContain(
      'includesNoncombatDamage refines only a selfDealsCombatDamageToPlayer trigger',
    );
  });
});
