/**
 * Flurry rush N, the flagship set's ability word.
 *
 * An ability word rather than a keyword, and that is the whole reason this file
 * exists beside `dies-not-sacrificed.test.ts` rather than inside it. A keyword
 * is a grant a layer applies and lives in `KEYWORDS`; Flurry rush is one
 * triggered ability with a fixed envelope, so the DSL models it exactly the way
 * it models exalted — a canonical structured spelling, a builder, and a
 * recognizer the renderer calls so the printed line is the word instead of the
 * sentence. The one difference is the rank, and the properties below are the
 * ones the rank introduces.
 *
 * The kernel half is `packages/kernel/test/flurry-rush.test.ts`: whether the
 * trigger reads both halves of a block and compares power strictly. This file
 * is about what the card *says* and what the vocabulary admits.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  abilityLineReminder,
  AbilitySchema,
  flurryRushAbility,
  flurryRushRank,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const FLURRY: TriggerCondition = 'selfBlocksOrIsBlockedByGreaterPower';

function dodgerInput(abilities: readonly unknown[]): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-flurry-probe',
    name: 'Flurry Dodger',
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 5 },
    manaCost: { generic: 2, W: 1 },
    colors: ['W'],
    subtypes: ['Vantan', 'Warrior'],
    supertypes: [],
    keywords: ['vigilance'],
    abilities: [...abilities],
    power: 3,
    toughness: 3,
  };
}

describe('flurry rush', () => {
  it('leaves the conditions the generator chooses from where they were, in order', () => {
    expect([...MODEL_TRIGGER_CONDITIONS]).toEqual(['selfEnters', 'selfAttacks', 'selfDies']);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(TRIGGER_CONDITIONS).toContain(FLURRY);
    expect(chooseable).not.toContain(FLURRY);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = flurryRushAbility(2);
    expect(AbilitySchema.safeParse(ability).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('refuses a rank that is not a positive whole number', () => {
    expect(() => flurryRushAbility(0)).toThrow(RangeError);
    expect(() => flurryRushAbility(-1)).toThrow(RangeError);
    expect(() => flurryRushAbility(1.5)).toThrow(RangeError);
    expect(flurryRushRank(flurryRushAbility(1))).toBe(1);
    expect(flurryRushRank(flurryRushAbility(7))).toBe(7);
  });

  it('prints the ability word and its rank rather than the sentence', () => {
    const card = parseCard(dodgerInput([flurryRushAbility(2)]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain('Flurry rush 2');
    expect(renderOracleText(card)).not.toContain('becomes blocked');
  });

  /**
   * The reminder is computed from the printed line, so the rank in the sentence
   * cannot drift from the rank in the word. A stored table would have been ten
   * rows differing in one character.
   */
  it('reminds the rank it printed', () => {
    expect(abilityLineReminder('Flurry rush 2')?.gloss).toBe(
      '(Whenever this creature blocks or becomes blocked by a creature with greater power, this creature deals 2 damage to that creature.)',
    );
    expect(abilityLineReminder('Flurry rush 4')?.gloss).toContain('deals 4 damage');
    expect(abilityLineReminder('Flurry rush 0')).toBeNull();
    expect(abilityLineReminder('Flurry rush')).toBeNull();
  });

  /**
   * The condition is reusable and only the *word* is reserved. Exalted's
   * condition is reserved outright because a lone attacker is not an event any
   * other card wants; two creatures meeting in a block is.
   */
  it('prints the full sentence when the ability is not the exact envelope', () => {
    const wider = {
      kind: 'triggered',
      condition: FLURRY,
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    };
    expect(flurryRushRank(AbilitySchema.parse(wider))).toBeNull();
    const card = parseCard(dodgerInput([wider]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      'Whenever Flurry Dodger blocks or becomes blocked by a creature with greater power, you gain 1 life.',
    );
  });

  /** Every condition prints something, which is what makes the table total. */
  it('carries a printed template of its own', () => {
    expect(TRIGGER_PRINT_TEMPLATES[FLURRY]).toBe(
      'Whenever {name} blocks or becomes blocked by a creature with greater power,',
    );
  });
});
