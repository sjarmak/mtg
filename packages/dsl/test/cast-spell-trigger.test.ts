/**
 * `youCastSpell` and `youCastInstantOrSorcery`: CR 601.2i's "whenever you
 * cast a spell" trigger, printed, and its instant-or-sorcery-filtered
 * sibling.
 *
 * The kernel's half is `packages/kernel/test/cast-spell.test.ts`; this file
 * is what the card says. `drawCards` is the payoff rather than `gainLife`
 * here for the same reason `gain-life-trigger.test.ts` gives: neither
 * condition risks a self-referential loop the way `youGainLife` does, but the
 * card printed below is meant to read like a spells-matter payoff a real set
 * would print, and drawing off your own casts is the more familiar one.
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

function castTrigger(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  };
}

function creatureInput(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'tst-spell-warden',
    name: 'Spell Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 3 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: ['Wizard'],
    supertypes: [],
    keywords: [],
    abilities: [castTrigger(condition)],
    power: 1,
    toughness: 2,
  };
}

describe.each([
  {
    condition: 'youCastSpell' as const,
    printed: 'Whenever you cast a spell,',
    oracle: 'Whenever you cast a spell, draw a card.',
  },
  {
    condition: 'youCastInstantOrSorcery' as const,
    printed: 'Whenever you cast an instant or sorcery spell,',
    oracle: 'Whenever you cast an instant or sorcery spell, draw a card.',
  },
])('$condition', ({ condition, printed, oracle }) => {
  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(condition);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(condition);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = castTrigger(condition);
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
