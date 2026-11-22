/** Jinxed Idol: one controller-relative trigger and one source-bound control transfer. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '@mtg/dsl';

const TRANSFER = {
  kind: 'targetPlayerGainsControlOfSelfPermanent',
  target: { kind: 'targetOpponent' },
} as const;

function jinxedIdolInput(effect: unknown = TRANSFER): CardInput {
  return {
    kind: 'artifact',
    id: 'm11-208-jinxed-idol',
    name: 'Jinxed Idol',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 208 },
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'triggered',
        condition: 'beginningOfYourUpkeep',
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        cost: { mana: {}, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
        effects: [effect],
      },
    ],
  } as unknown as CardInput;
}

describe('Jinxed Idol DSL', () => {
  it('parses and renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(jinxedIdolInput()))).toBe(
      [
        'At the beginning of your upkeep, this artifact deals 2 damage to you.',
        'Sacrifice a creature: Target opponent gains control of this artifact.',
      ].join('\n'),
    );
  });

  it('keeps source-bound control transfer hand-authored', () => {
    expect(CardEffectSchema.safeParse(TRANSFER).success).toBe(true);
    expect(ModelEffectSchema.safeParse(TRANSFER).success).toBe(false);
  });

  it.each(['targetPlayer', 'targetCreature'] as const)(
    'requires a target opponent rather than %s',
    (target) => {
      const result = safeParseCard(
        jinxedIdolInput({
          kind: 'targetPlayerGainsControlOfSelfPermanent',
          target: { kind: target },
        }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          code: 'ILLEGAL_TARGET_IN_ABILITY',
          path: 'abilities[1].effects[0].target.kind',
        }),
      );
    },
  );
});
