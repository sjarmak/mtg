/** Exact RTR player-state target restriction and blocking-creature activation. */
import {
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  restrictionFitsTargetKind,
  safeParseCard,
  type CardInput,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const RIX_MAADI = {
  kind: 'creature' as const,
  id: 'rtr-192-rix-maadi-guildmage',
  name: 'Rix Maadi Guildmage',
  rarity: 'uncommon' as const,
  set: { code: 'RTR', collectorNumber: 192 },
  manaCost: { B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Human', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { B: 1, R: 1 } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn' as const,
          power: -1,
          toughness: -1,
          target: {
            kind: 'targetCreature' as const,
            filter: { combat: 'blocking' as const },
          },
        },
      ],
    },
    {
      kind: 'activated' as const,
      cost: { mana: { B: 1, R: 1 } },
      effects: [
        {
          kind: 'loseLife' as const,
          amount: 1,
          target: {
            kind: 'targetPlayer' as const,
            restriction: { kind: 'playerLostLifeThisTurn' as const },
          },
        },
      ],
    },
  ],
};

describe('RTR #192 Rix Maadi Guildmage', () => {
  it('renders both current Oracle abilities exactly and in source order', () => {
    expect(renderOracleText(parseCard(RIX_MAADI as unknown as CardInput))).toBe(
      '{B}{R}: Target blocking creature gets -1/-1 until end of turn.\n' +
        '{B}{R}: Target player who lost life this turn loses 1 life.',
    );
  });

  it('keeps both hand-authored activation bundles outside model output', () => {
    const card = parseCard(RIX_MAADI as unknown as CardInput);
    expect(card.abilities.every((ability) => !ModelAbilitySchema.safeParse(ability).success)).toBe(true);
  });

  it('admits the player-state restriction only on a player target', () => {
    expect(safeParseCard(RIX_MAADI as unknown as CardInput).ok).toBe(true);
    expect(restrictionFitsTargetKind('targetPlayer', { kind: 'playerLostLifeThisTurn' })).toBe(true);
    expect(restrictionFitsTargetKind('targetCreature', { kind: 'playerLostLifeThisTurn' })).toBe(false);
    expect(restrictionFitsTargetKind('targetPlayer', { kind: 'maxPower', power: 2 })).toBe(false);
  });
});
