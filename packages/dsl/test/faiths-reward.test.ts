/** Faith's Reward's owner-relative, turn-provenance graveyard cohort. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '@mtg/dsl';

const RETURN_THIS_TURN = {
  kind: 'returnFromGraveyard',
  fromBattlefieldThisTurn: true,
  target: { kind: 'noTarget' },
} as const;

function faithsReward(effect: Record<string, unknown> = RETURN_THIS_TURN): CardInput {
  return {
    kind: 'instant',
    id: 'm13-14-faiths-reward',
    name: "Faith's Reward",
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: 14 },
    colors: ['W'],
    manaCost: { generic: 3, W: 1 },
    effects: [effect],
  } as CardInput;
}

describe("Faith's Reward DSL", () => {
  it('prints the exact owner-relative, turn-provenance cohort', () => {
    const card = parseCard(faithsReward());

    expect(renderOracleText(card)).toBe(
      'Return to the battlefield all permanent cards in your graveyard that were put there from the battlefield this turn.',
    );
  });

  it('keeps the provenance selector hand-authored and outside the generator contract', () => {
    expect(CardEffectSchema.safeParse(RETURN_THIS_TURN).success).toBe(true);
    expect(ModelEffectSchema.safeParse(RETURN_THIS_TURN).success).toBe(false);
  });

  it('rejects envelopes that would change the printed cohort or destination', () => {
    for (const override of [
      { scope: 'creatureCardsInPlayerGraveyard' },
      { destination: 'hand' },
      { control: 'you' },
      { alsoBecomes: { subtypes: ['Zombie'] } },
      { target: { kind: 'targetPlayer' } },
    ]) {
      const parsed = safeParseCard(faithsReward({ ...RETURN_THIS_TURN, ...override }));
      expect(parsed.ok).toBe(false);
    }
  });
});
