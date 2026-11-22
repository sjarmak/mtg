/** Exact authoring contract for RTR Deathrite Shaman. */
import { ModelAbilitySchema, isManaAbility, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

export const DEATHRITE_SHAMAN_INPUT = {
  kind: 'creature' as const,
  id: 'rtr-213-deathrite-shaman',
  name: 'Deathrite Shaman',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 213 },
  manaCost: { hybrid: { 'B/G': 1 } },
  colors: ['B', 'G'] as const,
  subtypes: ['Elf', 'Shaman'] as const,
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: {}, tapSelf: true },
      activateOnlyAsInstantReminder: true as const,
      effects: [
        {
          kind: 'exileTarget' as const,
          target: {
            kind: 'targetCardInAGraveyard' as const,
            filter: { cardTypes: ['land' as const] },
          },
        },
        {
          kind: 'addMana' as const,
          amount: 1,
          produces: ['W', 'U', 'B', 'R', 'G'] as const,
        },
      ],
    },
    {
      kind: 'activated' as const,
      cost: { mana: { B: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget' as const,
          target: {
            kind: 'targetCardInAGraveyard' as const,
            filter: { cardTypes: ['instant' as const, 'sorcery' as const] },
          },
        },
        {
          kind: 'loseLife' as const,
          amount: 2,
          players: 'eachOpponent' as const,
          target: { kind: 'noTarget' as const },
        },
      ],
    },
    {
      kind: 'activated' as const,
      cost: { mana: { G: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget' as const,
          target: {
            kind: 'targetCardInAGraveyard' as const,
            filter: { cardTypes: ['creature' as const] },
          },
        },
        { kind: 'gainLife' as const, amount: 2, target: { kind: 'noTarget' as const } },
      ],
    },
  ],
} satisfies CardInput;

describe('Deathrite Shaman authoring', () => {
  it('keeps its targeted mana production on the stack and renders every current Oracle clause', () => {
    const card = parseCard(DEATHRITE_SHAMAN_INPUT);
    expect(isManaAbility(card.abilities[0]!)).toBe(false);
    expect(renderOracleText(card)).toBe(
      '{T}: Exile target land card from a graveyard. Add one mana of any color. (Activate only as an instant.)\n' +
        '{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life.\n' +
        '{G}, {T}: Exile target creature card from a graveyard. You gain 2 life.',
    );
  });

  it('keeps every activation outside model output', () => {
    for (const ability of DEATHRITE_SHAMAN_INPUT.abilities) {
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
  });
});
