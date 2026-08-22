/**
 * The seven conditions M11's cards needed printed, and what each one says.
 *
 * The kernel's half is `packages/kernel/test/m11-event-triggers.test.ts`;
 * this file is the vocabulary's. Three things have to hold for every one of
 * them: the generator cannot reach it (`MODEL_TRIGGER_CONDITIONS` is
 * unchanged, and the containment invariant is that the generator's space stays
 * inside the engine's), it is expressible by hand, and it prints a template of
 * its own rather than borrowing one.
 *
 * The five color members are one cycle and are asserted as a cycle, because
 * that is the argument for their being five members instead of one member with
 * a color field: `COLOR_CAST_TRIGGER_CONDITIONS` is what the kernel reads to
 * get from a spell's color to a condition name, and a table with a hole in it
 * would be a spell color nothing can watch for.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  COLOR_CAST_TRIGGER_CONDITIONS,
  COLORS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_POWER_THRESHOLD,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const ADDED: readonly TriggerCondition[] = [
  'aPlayerCastsWhiteSpell',
  'aPlayerCastsBlueSpell',
  'aPlayerCastsBlackSpell',
  'aPlayerCastsRedSpell',
  'aPlayerCastsGreenSpell',
  'opponentDealtNoncombatDamage',
  'anotherControlledCreatureWithPowerThreeOrGreaterEnters',
];

function trigger(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  };
}

function artifactInput(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'artifact',
    id: 'tst-horn',
    name: 'Test Horn',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 7 },
    manaCost: { generic: 2 },
    colors: [],
    abilities: [trigger(condition)],
  };
}

describe('the conditions M11 needed', () => {
  it('leaves the conditions the generator chooses from where they were, in order', () => {
    expect([...MODEL_TRIGGER_CONDITIONS]).toEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    expect([...TRIGGER_CONDITIONS].slice(0, MODEL_TRIGGER_CONDITIONS.length)).toEqual([
      ...MODEL_TRIGGER_CONDITIONS,
    ]);
  });

  it.each(ADDED)('%s is a condition the engine knows and the generator may not choose', (condition) => {
    expect(TRIGGER_CONDITIONS).toContain(condition);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(condition);
  });

  it.each(ADDED)('%s is expressible by hand and unreachable from the generator', (condition) => {
    expect(AbilitySchema.safeParse(trigger(condition)).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(trigger(condition)).success).toBe(false);
  });

  it.each(ADDED)('%s carries a printed template of its own', (condition) => {
    const template = TRIGGER_PRINT_TEMPLATES[condition];
    expect(template.startsWith('Whenever ')).toBe(true);
    expect(template.endsWith(',')).toBe(true);
  });
});

describe('the five color-cast conditions as one cycle', () => {
  it('names one condition per color, with no color left unwatchable', () => {
    expect(Object.keys(COLOR_CAST_TRIGGER_CONDITIONS).sort()).toEqual([...COLORS].sort());
    const named = Object.values(COLOR_CAST_TRIGGER_CONDITIONS);
    expect(new Set(named).size).toBe(named.length);
    for (const condition of named) expect(TRIGGER_CONDITIONS).toContain(condition);
  });

  it('prints the whole clause on a real card', () => {
    const card = parseCard(artifactInput('aPlayerCastsWhiteSpell') as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Whenever a player casts a white spell, draw a card.');
  });
});

describe('the two remaining conditions', () => {
  it('prints the noncombat-damage clause on a real card', () => {
    const card = parseCard(artifactInput('opponentDealtNoncombatDamage') as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Whenever an opponent is dealt noncombat damage, draw a card.');
  });

  it('prints the power threshold it holds as a constant, not as a literal in the template', () => {
    expect(TRIGGER_POWER_THRESHOLD).toBe(3);
    expect(TRIGGER_PRINT_TEMPLATES.anotherControlledCreatureWithPowerThreeOrGreaterEnters).toContain(
      `power ${String(TRIGGER_POWER_THRESHOLD)} or greater`,
    );
  });

  it('prints the whole arrival clause on a real card', () => {
    const card = parseCard({
      kind: 'creature' as const,
      id: 'tst-packleader',
      name: 'Test Packleader',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 8 },
      manaCost: { generic: 4, G: 1 },
      colors: ['G'],
      subtypes: ['Beast'],
      supertypes: [],
      keywords: [],
      abilities: [trigger('anotherControlledCreatureWithPowerThreeOrGreaterEnters')],
      power: 4,
      toughness: 4,
    } as unknown as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Whenever another creature you control with power 3 or greater enters the battlefield, draw a card.',
    );
  });
});
