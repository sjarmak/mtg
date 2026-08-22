/**
 * `youGainLife`: CR 119.3 / CR 702.15e's life-total increase, printed.
 *
 * The kernel's half is `packages/kernel/test/gain-life.test.ts`; this file is
 * what the card says. `drawCards` is the payoff rather than `gainLife` for
 * the reason its own docblock gives: a trigger whose payoff is the condition
 * it watches for would refire itself on its own resolution, so a card that
 * actually printed "whenever you gain life, you gain life" would be an
 * infinite loop rather than a legal Magic card, and this fixture is meant to
 * be one.
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

const YOU_GAIN_LIFE: TriggerCondition = 'youGainLife';

const LIFE_TRIGGER = {
  kind: 'triggered',
  condition: YOU_GAIN_LIFE,
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
};

function creatureInput(): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'tst-life-warden',
    name: 'Life Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 5 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Cleric'],
    supertypes: [],
    keywords: [],
    abilities: [LIFE_TRIGGER],
    power: 1,
    toughness: 3,
  };
}

describe('whenever you gain life', () => {
  it('leaves the conditions the generator chooses from where they were, in order', () => {
    expect([...MODEL_TRIGGER_CONDITIONS]).toEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    expect([...TRIGGER_CONDITIONS].slice(0, MODEL_TRIGGER_CONDITIONS.length)).toEqual([
      ...MODEL_TRIGGER_CONDITIONS,
    ]);
  });

  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(YOU_GAIN_LIFE);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(YOU_GAIN_LIFE);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    expect(AbilitySchema.safeParse(LIFE_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(LIFE_TRIGGER).success).toBe(false);
  });

  it('carries a printed template of its own', () => {
    expect(TRIGGER_PRINT_TEMPLATES[YOU_GAIN_LIFE]).toBe('Whenever you gain life,');
  });

  it('prints the whole clause on a real card', () => {
    const card = parseCard(creatureInput() as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Whenever you gain life, draw a card.');
  });
});
