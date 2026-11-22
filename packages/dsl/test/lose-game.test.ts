/** Exact strict-DSL authoring for a targeted game-loss effect. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  CardEffectSchema,
  HAND_AUTHORED_TARGETS,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '@mtg/dsl';

const LOSE_GAME = { kind: 'loseGame', target: { kind: 'targetPlayer' } } as const;

const DOOR = {
  kind: 'artifact',
  id: 'm13-203-door-to-nothingness',
  name: 'Door to Nothingness',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 203 },
  manaCost: { generic: 5 },
  colors: [],
  entryReplacement: { kind: 'entersTapped' },
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: { W: 2, U: 2, B: 2, R: 2, G: 2 },
        tapSelf: true,
        sacrificeSelf: true,
      },
      effects: [LOSE_GAME],
    },
  ],
} as unknown as CardInput;

describe('targeted game-loss authoring', () => {
  it('parses and prints Door to Nothingness exactly', () => {
    expect(CardEffectSchema.parse(LOSE_GAME)).toEqual(LOSE_GAME);
    const card = parseCard(DOOR);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Door to Nothingness enters tapped.\n{W}{W}{U}{U}{B}{B}{R}{R}{G}{G}, {T}, Sacrifice Door to Nothingness: Target player loses the game.',
    );
    expect(HAND_AUTHORED_TARGETS.loseGame).toEqual(['targetPlayer', 'triggeringPlayer']);
  });

  it('keeps the effect outside generator output and rejects wider spellings', () => {
    expect(ModelEffectSchema.safeParse(LOSE_GAME).success).toBe(false);
    const invalid = {
      ...DOOR,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
          effects: [{ kind: 'loseGame', target: { kind: 'noTarget' } }],
        },
      ],
    } as unknown as Parameters<typeof validateCard>[0];
    expect(validateCard(invalid).map((found) => found.code)).toContain('ILLEGAL_TARGET_IN_ABILITY');
    expect(CardEffectSchema.safeParse({ ...LOSE_GAME, reason: 'destroyed' }).success).toBe(false);
  });
});
