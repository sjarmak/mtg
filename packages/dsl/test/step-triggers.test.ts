/**
 * `beginningOfYourUpkeep` and `beginningOfYourEndStep`: CR 603.6b's two step
 * triggers, printed.
 *
 * The kernel's half is `packages/kernel/test/step-triggers.test.ts`; this
 * file is what the card says. Both conditions are hand-authored only — a step
 * trigger names no target and reads no board state, so neither widens
 * `MODEL_TRIGGER_CONDITIONS`'s three, the same freeze `dies-not-sacrificed.test.ts`
 * and `gloom.test.ts` pin for their own members.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function stepTrigger(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  };
}

function creatureInput(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'tst-step-warden',
    name: 'Vigil Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, W: 1 },
    colors: ['W'],
    subtypes: ['Spirit'],
    supertypes: [],
    keywords: [],
    abilities: [stepTrigger(condition)],
    power: 2,
    toughness: 2,
  };
}

describe.each([
  {
    condition: 'beginningOfYourUpkeep' as const,
    printed: 'At the beginning of your upkeep,',
    oracle: 'At the beginning of your upkeep, you gain 1 life.',
  },
  {
    condition: 'beginningOfYourEndStep' as const,
    printed: 'At the beginning of your end step,',
    oracle: 'At the beginning of your end step, you gain 1 life.',
  },
])('$condition', ({ condition, printed, oracle }) => {
  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(condition);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(condition);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = stepTrigger(condition);
    expect(AbilitySchema.safeParse(ability).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('carries a printed template of its own', () => {
    expect(TRIGGER_PRINT_TEMPLATES[condition]).toBe(printed);
  });

  it('prints the whole clause on a real card', () => {
    const card = parseCard(creatureInput(condition) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(oracle);
  });
});
