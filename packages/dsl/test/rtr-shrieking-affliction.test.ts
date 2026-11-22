/** Exact hand-authored vocabulary and Oracle text for RTR Shrieking Affliction. */
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  TRIGGERING_PLAYER_CONDITIONS,
  TRIGGER_CONDITIONS,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const AFFLICTION_TRIGGER = {
  kind: 'triggered' as const,
  condition: 'beginningOfEachPlayersUpkeep' as const,
  triggeringPlayerIsOpponent: true as const,
  triggeringPlayerHandAtMost: 1,
  effects: [
    {
      kind: 'loseLife' as const,
      amount: 3,
      target: { kind: 'triggeringPlayer' as const },
    },
  ],
};

const SHRIEKING_AFFLICTION = parseCard({
  kind: 'enchantment',
  id: 'rtr-76-shrieking-affliction',
  name: 'Shrieking Affliction',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 76 },
  manaCost: { B: 1 },
  colors: ['B'],
  abilities: [AFFLICTION_TRIGGER],
});

describe('Shrieking Affliction in the DSL', () => {
  it('parses and renders the exact current Oracle text', () => {
    expect(validateCard(SHRIEKING_AFFLICTION)).toEqual([]);
    expect(renderOracleText(SHRIEKING_AFFLICTION)).toBe(
      "At the beginning of each opponent's upkeep, if that player has one or fewer cards in hand, they lose 3 life.",
    );
  });

  it('keeps the opponent-upkeep condition and hand threshold outside model output', () => {
    expect(TRIGGER_CONDITIONS).toContain('beginningOfEachPlayersUpkeep');
    expect(TRIGGERING_PLAYER_CONDITIONS).toContain('beginningOfEachPlayersUpkeep');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('beginningOfEachPlayersUpkeep');
    expect(AbilitySchema.safeParse(AFFLICTION_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(AFFLICTION_TRIGGER).success).toBe(false);
  });

  it('requires a nonnegative integral maximum hand size', () => {
    expect(
      AbilitySchema.safeParse({
        ...AFFLICTION_TRIGGER,
        triggeringPlayerHandAtMost: -1,
      }).success,
    ).toBe(false);
    expect(
      AbilitySchema.safeParse({
        ...AFFLICTION_TRIGGER,
        triggeringPlayerHandAtMost: 1.5,
      }).success,
    ).toBe(false);
  });

  it('rejects the hand predicate outside its one retained-player trigger envelope', () => {
    const violationsFor = (ability: unknown) => {
      const result = safeParseCard({
        kind: 'enchantment',
        id: 'rtr-76-shrieking-affliction-hostile',
        name: 'Shrieking Affliction Hostile',
        rarity: 'uncommon',
        set: { code: 'RTR', collectorNumber: 76 },
        manaCost: { B: 1 },
        colors: ['B'],
        abilities: [ability],
      });
      return result.ok ? validateCard(result.card) : result.violations;
    };
    const { triggeringPlayerIsOpponent: _opponent, ...withoutOpponent } = AFFLICTION_TRIGGER;

    expect(violationsFor(withoutOpponent)).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].triggeringPlayerHandAtMost',
      }),
    );
    expect(
      violationsFor({
        ...AFFLICTION_TRIGGER,
        condition: 'selfEnters',
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].triggeringPlayerIsOpponent',
      }),
    );
    expect(
      violationsFor({
        ...AFFLICTION_TRIGGER,
        interveningIf: { kind: 'controlsSubtype', subtype: 'Gate', atLeast: 1 },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].triggeringPlayerHandAtMost',
      }),
    );
  });
});
