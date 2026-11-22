/** Exact hand-authored damage-source growth for RTR Necropolis Regent. */
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

const COUNTER_DAMAGE: EffectInput = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: { kind: 'triggeringDamageAmount' },
  target: { kind: 'triggeringCreature' },
};

const REGENT_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'controlledCreatureDealsCombatDamageToPlayer',
  effects: [COUNTER_DAMAGE],
};

function regentInput(ability: AbilityInput = REGENT_TRIGGER): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-071-necropolis-regent',
    name: 'Necropolis Regent',
    rarity: 'mythic',
    set: { code: 'RTR', collectorNumber: 71 },
    manaCost: { generic: 3, B: 3 },
    colors: ['B'],
    subtypes: ['Vampire'],
    power: 6,
    toughness: 5,
    keywords: ['flying'],
    abilities: [ability],
  };
}

describe('Necropolis Regent DSL', () => {
  it('keeps the retained event bundle outside the generator schemas', () => {
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('controlledCreatureDealsCombatDamageToPlayer');
    expect(MODEL_TARGET_KINDS).not.toContain('triggeringCreature');
    expect(ModelEffectSchema.safeParse(COUNTER_DAMAGE).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(REGENT_TRIGGER).success).toBe(false);
  });

  it('renders the exact current Oracle text', () => {
    expect(renderOracleText(parseCard(regentInput()))).toBe(
      'Flying\nWhenever a creature you control deals combat damage to a player, put that many +1/+1 counters on it.',
    );
  });

  it('refuses either half of the retained bundle outside its exact envelope', () => {
    expect(() => parseCard(regentInput({ ...REGENT_TRIGGER, condition: 'selfEnters' }))).toThrow(
      /triggeringDamageAmount|triggeringCreature/u,
    );
    expect(() =>
      parseCard(
        regentInput({
          ...REGENT_TRIGGER,
          effects: [{ ...COUNTER_DAMAGE, target: { kind: 'selfCreature' } }],
        }),
      ),
    ).toThrow(/controlledCreatureDealsCombatDamageToPlayer|triggeringCreature/u);
    expect(() =>
      parseCard(
        regentInput({
          ...REGENT_TRIGGER,
          effects: [{ ...COUNTER_DAMAGE, count: 2 }],
        }),
      ),
    ).toThrow(/controlledCreatureDealsCombatDamageToPlayer|triggeringDamageAmount/u);
  });
});
