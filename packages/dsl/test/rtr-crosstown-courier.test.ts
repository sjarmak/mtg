/** Exact hand-authored damage-linked mill vocabulary for RTR Crosstown Courier. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, EffectInput } from '../src/index';
import {
  MODEL_TARGET_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelEffectSchema,
  renderOracleText,
} from '../src/index';
import { parseCard } from '../src/parse';

const MILL_DAMAGE: EffectInput = {
  kind: 'millCards',
  count: { kind: 'triggeringDamageAmount' },
  target: { kind: 'triggeringPlayer' },
};

const COURIER_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDealsCombatDamageToPlayer',
  printedSourceReference: 'thisCreature',
  effects: [MILL_DAMAGE],
};

function courierInput(ability: AbilityInput = COURIER_TRIGGER): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-034-crosstown-courier',
    name: 'Crosstown Courier',
    rarity: 'common',
    set: { code: 'RTR', collectorNumber: 34 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: ['Vedalken'],
    power: 2,
    toughness: 1,
    abilities: [ability],
  };
}

describe('Crosstown Courier DSL', () => {
  it('keeps the event referents outside the generator schemas', () => {
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('selfDealsCombatDamageToPlayer');
    expect(MODEL_TARGET_KINDS).not.toContain('triggeringPlayer');
    expect(ModelEffectSchema.safeParse(MILL_DAMAGE).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(COURIER_TRIGGER).success).toBe(false);
  });

  it('renders the exact current Oracle text', () => {
    expect(renderOracleText(parseCard(courierInput()))).toBe(
      'Whenever this creature deals combat damage to a player, that player mills that many cards.',
    );
  });

  it('refuses the damage amount outside the matching combat-damage mill slot', () => {
    const wrongTrigger: AbilityInput = { ...COURIER_TRIGGER, condition: 'selfEnters' };
    const wrongEffect: AbilityInput = {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      effects: [
        {
          kind: 'gainLife',
          amount: { kind: 'triggeringDamageAmount' },
          target: { kind: 'noTarget' },
        },
      ],
    };

    expect(() => parseCard(courierInput(wrongTrigger))).toThrow(/triggeringDamageAmount|triggeringPlayer/u);
    expect(() => parseCard(courierInput(wrongEffect))).toThrow(/triggeringDamageAmount.*millCards/u);
  });
});
