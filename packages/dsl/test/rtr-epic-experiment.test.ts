/** RTR #159: one closed top-X exile, free-cast, and remainder-cleanup capability. */
import { describe, expect, it } from 'vitest';
import {
  MODEL_EFFECT_KINDS,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '../src/index';

export const EPIC_EXPERIMENT_INPUT = {
  kind: 'sorcery',
  id: 'rtr-159-epic-experiment',
  name: 'Epic Experiment',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 159 },
  manaCost: { hasX: true, U: 1, R: 1 },
  colors: ['R', 'U'],
  effects: [
    {
      kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
      topXOriginalsProfile: true,
    },
  ],
} as CardInput;

describe('Epic Experiment', () => {
  it('parses and renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(EPIC_EXPERIMENT_INPUT))).toBe(
      "Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard.",
    );
  });

  it('keeps the atomic batch capability outside the generator effect schema', () => {
    const kind = 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts';
    expect(ModelEffectSchema.safeParse({ kind, topXOriginalsProfile: true }).success).toBe(false);
    expect(MODEL_EFFECT_KINDS).not.toContain(kind);
  });

  it('binds the profile to one X-valued spell effect rather than opening its halves', () => {
    expect(safeParseCard({ ...EPIC_EXPERIMENT_INPUT, manaCost: { U: 1, R: 1 } }).ok).toBe(false);
    expect(
      safeParseCard({
        ...EPIC_EXPERIMENT_INPUT,
        effects: [
          {
            kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
            topXOriginalsProfile: true,
          },
          { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
        ],
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        kind: 'enchantment',
        id: 'epic-profile-trigger-probe',
        name: 'Epic Profile Trigger Probe',
        rarity: 'rare',
        set: { code: 'TST', collectorNumber: 159 },
        manaCost: { U: 1 },
        colors: ['U'],
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [
              {
                kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts',
                topXOriginalsProfile: true,
              },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
  });
});
