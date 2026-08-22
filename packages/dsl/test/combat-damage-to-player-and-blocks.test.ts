/**
 * `selfDealsCombatDamageToPlayer` (CR 510.1c) and `selfBlocks` (CR 509.1h),
 * printed.
 *
 * The kernel's half is
 * `packages/kernel/test/combat-damage-to-player-and-blocks.test.ts`; this
 * file is what the card says. Neither condition retains a referent — unlike
 * `selfDealsCombatDamageToCreature`, whose damaged creature is the payload's
 * `triggeringCreature` target, a damaged player is not a placement
 * `checkAbilities` allows any effect to point at, and `gloom.test.ts` already
 * pins that exactly one non-exalted condition may use `triggeringCreature`.
 * The negative half of that claim belongs here: putting `triggeringCreature`
 * on either of these two members is refused the same way putting it on
 * `selfAttacks` is.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard, safeParseCard } from '../src/parse';

function combatTrigger(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  };
}

function creatureInput(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'tst-combat-warden',
    name: 'Combat Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 4 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: ['Warrior'],
    supertypes: [],
    keywords: [],
    abilities: [combatTrigger(condition)],
    power: 2,
    toughness: 2,
  };
}

describe.each([
  {
    condition: 'selfDealsCombatDamageToPlayer' as const,
    printed: 'Whenever {name} deals combat damage to a player,',
    oracle: 'Whenever Combat Warden deals combat damage to a player, you gain 1 life.',
  },
  {
    condition: 'selfBlocks' as const,
    printed: 'Whenever {name} blocks,',
    oracle: 'Whenever Combat Warden blocks, you gain 1 life.',
  },
])('$condition', ({ condition, printed, oracle }) => {
  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(condition);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(condition);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = combatTrigger(condition);
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

  it('may not name the triggering creature: it has no damaged creature to point at', () => {
    const misplaced: AbilityInput = {
      kind: 'triggered',
      condition,
      effects: [{ kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'triggeringCreature' } }],
    } as AbilityInput;
    const result = safeParseCard(creatureInput(condition) as CardInput & { abilities: unknown[] });
    expect(result.ok).toBe(true);
    const rejected = safeParseCard({
      ...(creatureInput(condition) as Record<string, unknown>),
      abilities: [misplaced],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.ok ? [] : rejected.violations.map((found) => found.code)).toContain(
      'ILLEGAL_TARGET_IN_ABILITY',
    );
  });
});
