/**
 * `anotherControlledPermanentEnters` and `anotherControlledCreatureEnters`:
 * CR 603.6e's "another permanent" trigger, printed, and its
 * creature-filtered sibling.
 *
 * The kernel's half is `packages/kernel/test/another-permanent-enters.test.ts`;
 * this file is what the card says. Both are hand-authored only, for the same
 * reason `selfDiesNotSacrificed` is: a filter beyond the three the generator
 * is shown widens the engine's vocabulary without widening what the model may
 * print.
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

function enterTrigger(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  };
}

function creatureInput(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'tst-arrival-warden',
    name: 'Arrival Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: ['Elemental'],
    supertypes: [],
    keywords: [],
    abilities: [enterTrigger(condition)],
    power: 2,
    toughness: 3,
  };
}

describe.each([
  {
    condition: 'anotherControlledPermanentEnters' as const,
    printed: 'Whenever another permanent you control enters the battlefield,',
    oracle: 'Whenever another permanent you control enters the battlefield, you gain 1 life.',
  },
  {
    condition: 'anotherControlledCreatureEnters' as const,
    printed: 'Whenever another creature you control enters the battlefield,',
    oracle: 'Whenever another creature you control enters the battlefield, you gain 1 life.',
  },
])('$condition', ({ condition, printed, oracle }) => {
  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(condition);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(condition);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = enterTrigger(condition);
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

describe('the two conditions', () => {
  it('print different sentences from each other', () => {
    expect(TRIGGER_PRINT_TEMPLATES.anotherControlledPermanentEnters).not.toBe(
      TRIGGER_PRINT_TEMPLATES.anotherControlledCreatureEnters,
    );
  });
});
