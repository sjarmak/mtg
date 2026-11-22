/** A reusable, hand-authored pregame action for the Leyline family. */
import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  OpeningHandActionSchema,
  openingHandActionOf,
  parseCard,
  renderOracleText,
  type CardInput,
} from '@mtg/dsl';

const BEGIN_ON_BATTLEFIELD = { kind: 'beginOnBattlefield' } as const;

const LEYLINE_OF_VITALITY = {
  kind: 'enchantment' as const,
  id: 'm11-183-leyline-of-vitality',
  name: 'Leyline of Vitality',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 183 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'] as const,
  openingHandAction: BEGIN_ON_BATTLEFIELD,
  abilities: [
    {
      kind: 'static' as const,
      scope: 'creaturesYouControl' as const,
      subtype: null,
      modification: { kind: 'statBonus' as const, power: 0, toughness: 1 },
    },
    {
      kind: 'triggered' as const,
      condition: 'controlledCreatureEnters' as const,
      optional: true,
      effects: [{ kind: 'gainLife' as const, amount: 1, target: { kind: 'noTarget' as const } }],
    },
  ],
};

describe('opening-hand card actions', () => {
  it('parses and prints every Leyline of Vitality clause exactly', () => {
    expect(OpeningHandActionSchema.safeParse(BEGIN_ON_BATTLEFIELD).success).toBe(true);

    const card = parseCard(LEYLINE_OF_VITALITY);
    expect(openingHandActionOf(card)).toEqual(BEGIN_ON_BATTLEFIELD);
    expect(renderOracleText(card)).toBe(
      'If Leyline of Vitality is in your opening hand, you may begin the game with it on the battlefield.\n' +
        'Creatures you control get +0/+1.\n' +
        'Whenever a creature you control enters, you may gain 1 life.',
    );
  });

  it('is card-level engine vocabulary rather than an ability the model can emit', () => {
    expect(ModelAbilitySchema.safeParse(BEGIN_ON_BATTLEFIELD).success).toBe(false);
  });

  it('rejects the battlefield action on a nonpermanent card', () => {
    expect(() =>
      parseCard({
        kind: 'instant',
        id: 'illegal-opening-hand-instant',
        name: 'Illegal Opening Hand Instant',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { U: 1 },
        colors: ['U'],
        openingHandAction: BEGIN_ON_BATTLEFIELD,
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      } as unknown as CardInput),
    ).toThrow(/openingHandAction|unrecognized|permanent/iu);
  });

  it('rejects invented action kinds and extra policy fields', () => {
    expect(OpeningHandActionSchema.safeParse({ kind: 'reveal' }).success).toBe(false);
    expect(
      OpeningHandActionSchema.safeParse({ ...BEGIN_ON_BATTLEFIELD, onlyIfStartingPlayer: false }).success,
    ).toBe(false);
  });
});
