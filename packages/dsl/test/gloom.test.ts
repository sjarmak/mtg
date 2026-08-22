/**
 * Gloom N, the flagship set's second ability word.
 *
 * Toxic's shape with two substitutions the set makes on purpose: the counters
 * go on the creature that was hit rather than on a player, and the counter is
 * gloom, which is a -1/-1 counter carrying an identity of its own so the set's
 * black removal can ask whether a body is marked. The DSL models it the way it
 * models Flurry rush and exalted before it - a canonical structured spelling, a
 * builder, and a recognizer the renderer calls - so the properties below are the
 * ones that differ: which envelope earns the word, and what the reminder says.
 *
 * The kernel half is `packages/kernel/test/gloom.test.ts`: whether combat
 * damage actually marks the creature and whether the mark shrinks it. This file
 * is about what the card says.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  abilityLineReminder,
  AbilitySchema,
  gloomAbility,
  gloomRank,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const ON_DAMAGE: TriggerCondition = 'selfDealsCombatDamageToCreature';

function raiderInput(abilities: readonly unknown[]): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-gloom-probe',
    name: 'Gloom Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 5 },
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    subtypes: ['Monster'],
    supertypes: [],
    keywords: [],
    abilities: [...abilities],
    power: 2,
    toughness: 2,
  };
}

describe('gloom', () => {
  it('rides a condition the generator already cannot choose', () => {
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(TRIGGER_CONDITIONS).toContain(ON_DAMAGE);
    expect(chooseable).not.toContain(ON_DAMAGE);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = gloomAbility(1);
    expect(AbilitySchema.safeParse(ability).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('refuses a rank that is not a positive whole number', () => {
    expect(() => gloomAbility(0)).toThrow(RangeError);
    expect(() => gloomAbility(-2)).toThrow(RangeError);
    expect(() => gloomAbility(1.5)).toThrow(RangeError);
    expect(gloomRank(gloomAbility(1))).toBe(1);
    expect(gloomRank(gloomAbility(3))).toBe(3);
  });

  it('prints the ability word and its rank rather than the sentence', () => {
    const card = parseCard(raiderInput([gloomAbility(1)]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Gloom 1');
  });

  /**
   * The reminder carries the second sentence because a gloom counter is not a
   * counter a player can be assumed to know. Singular and plural are computed
   * from the rank for the reason the rank itself is: one stored sentence per
   * rank is one chance per rank to typo it.
   */
  it('reminds what the counters are and what they do', () => {
    expect(abilityLineReminder('Gloom 1')?.gloss).toBe(
      '(Whenever this creature deals combat damage to a creature, put a gloom counter on that creature. A creature with a gloom counter gets -1/-1.)',
    );
    expect(abilityLineReminder('Gloom 2')?.gloss).toContain('put 2 gloom counters on that creature');
    expect(abilityLineReminder('Gloom 0')).toBeNull();
    expect(abilityLineReminder('Gloom')).toBeNull();
  });

  /**
   * The condition is shared - the set's white-green legend grows himself off the
   * same event - so only the exact envelope earns the word and everything else
   * on that condition prints its sentence in full.
   */
  it('prints the full sentence when the ability is not the exact envelope', () => {
    const otherCounter = {
      kind: 'triggered',
      condition: ON_DAMAGE,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    };
    expect(gloomRank(AbilitySchema.parse(otherCounter))).toBeNull();
    const card = parseCard(raiderInput([otherCounter]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      'Whenever Gloom Probe deals combat damage to a creature, put a +1/+1 counter on target creature you control.',
    );
  });

  /** A gloom counter aimed at a creature somebody chose is a spell's job, not the word's. */
  it('does not earn the word when the counters land where a player pointed them', () => {
    const chosen = {
      kind: 'triggered',
      condition: ON_DAMAGE,
      effects: [{ kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'targetCreature' } }],
    };
    expect(gloomRank(AbilitySchema.parse(chosen))).toBeNull();
  });
});
