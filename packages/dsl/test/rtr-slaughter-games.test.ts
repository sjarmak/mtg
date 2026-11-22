/** RTR #197's closed nonland-name opponent-zone exile bundle. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCards,
} from '@mtg/dsl';

const EFFECT = {
  kind: 'nameNonlandCardAndExileMatchingOpponentZones' as const,
  target: { kind: 'targetOpponent' as const },
};

function slaughterGames(effect: unknown = EFFECT): CardInput {
  return {
    kind: 'sorcery',
    id: 'rtr-197',
    name: 'Slaughter Games',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 197 },
    manaCost: { generic: 2, B: 1, R: 1 },
    colors: ['B', 'R'],
    cannotBeCountered: true,
    effects: [effect],
  } as unknown as CardInput;
}

describe('Slaughter Games authoring', () => {
  it('parses, validates, and renders the exact closed operation', () => {
    expect(CardEffectSchema.safeParse(EFFECT).success).toBe(true);
    const card = parseCard(slaughterGames());
    expect(validateCards([card])).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "This spell can't be countered.\nChoose a nonland card name. Search target opponent's graveyard, hand, and library for any number of cards with that name and exile them. Then that player shuffles.",
    );
  });

  it('is engine-only and keeps its target and zones inside one strict bundle', () => {
    expect(ALL_EFFECT_KINDS).toContain('nameNonlandCardAndExileMatchingOpponentZones');
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...EFFECT, target: { kind: 'targetPlayer' } }).success).toBe(true);
    expect(CardEffectSchema.safeParse({ ...EFFECT, zones: ['graveyard', 'hand', 'library'] }).success).toBe(
      false,
    );
  });

  it('refuses a wider player target during semantic validation', () => {
    const parsed = safeParseCard(
      slaughterGames({
        kind: 'nameNonlandCardAndExileMatchingOpponentZones',
        target: { kind: 'targetPlayer' },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('Slaughter Games accepted a target that includes its controller');
    expect(parsed.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ILLEGAL_TARGET_FOR_EFFECT', path: 'effects[0].target.kind' }),
      ]),
    );
  });
});
