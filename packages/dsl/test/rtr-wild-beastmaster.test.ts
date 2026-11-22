/** Exact hand-authored capability bundle for RTR Wild Beastmaster. */
import { describe, expect, it } from 'vitest';
import {
  MODEL_TRIGGER_CONDITIONS,
  ModelEffectSchema,
  TRIGGERING_CREATURE_CONDITIONS,
  parseCard,
  renderOracleText,
  validateCard,
  type AbilityInput,
  type CardInput,
  type EffectInput,
} from '../src/index';

const PUMP_OTHERS: EffectInput = {
  kind: 'pumpUntilEndOfTurn',
  power: { kind: 'triggeringCreaturePower' },
  toughness: { kind: 'triggeringCreaturePower' },
  scope: 'permanentsYouControl',
  scopeFilter: { cardTypes: ['creature'] },
  excludeReferent: true,
  target: { kind: 'noTarget' },
};

const ATTACK_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfAttacks',
  printedSourceReference: 'thisCreature',
  effects: [PUMP_OTHERS],
};

function wildBeastmaster(ability: AbilityInput = ATTACK_TRIGGER): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-139-wild-beastmaster',
    name: 'Wild Beastmaster',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 139 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: ['Human', 'Shaman'],
    power: 1,
    toughness: 1,
    abilities: [ability],
  };
}

describe('RTR #139 Wild Beastmaster', () => {
  it('accepts the atomic self-attack, source-power, other-controlled-creatures bundle', () => {
    expect(validateCard(wildBeastmaster())).toEqual([]);
    expect(TRIGGERING_CREATURE_CONDITIONS).toContain('selfAttacks');
    expect(MODEL_TRIGGER_CONDITIONS).toContain('selfAttacks');
    expect(ModelEffectSchema.safeParse(PUMP_OTHERS).success).toBe(false);
  });

  it('renders current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(wildBeastmaster()))).toBe(
      "Whenever this creature attacks, each other creature you control gets +X/+X until end of turn, where X is this creature's power.",
    );
  });

  it('refuses independent widening of the trigger, scope, target, and computed amount', () => {
    const nearMisses: readonly AbilityInput[] = [
      { ...ATTACK_TRIGGER, condition: 'selfEnters' },
      { ...ATTACK_TRIGGER, effects: [{ ...PUMP_OTHERS, scope: 'allPermanents' }] },
      { ...ATTACK_TRIGGER, effects: [{ ...PUMP_OTHERS, target: { kind: 'selfCreature' } }] },
      {
        ...ATTACK_TRIGGER,
        effects: [{ ...PUMP_OTHERS, power: 1, toughness: 1 }],
      },
    ];

    for (const ability of nearMisses) expect(validateCard(wildBeastmaster(ability))).not.toEqual([]);
  });
});
