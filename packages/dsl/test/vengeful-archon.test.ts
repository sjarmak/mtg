/** Vengeful Archon's hand-authored depleting shield and linked retaliation. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  legalTargetsFor,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  UNPRICED_EFFECT_KINDS,
} from '@mtg/dsl';

const EFFECT = {
  kind: 'preventNextDamageToYouAndRetaliate' as const,
  amount: { kind: 'chosenX' as const },
  target: { kind: 'targetPlayerOrPlaneswalker' as const },
};

const VENGEFUL_ARCHON = {
  kind: 'creature' as const,
  id: 'm11-037-vengeful-archon',
  name: 'Vengeful Archon',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 37 },
  colors: ['W'] as const,
  manaCost: { generic: 4, W: 3 },
  power: 7,
  toughness: 7,
  keywords: ['flying'] as const,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { hasX: true } },
      effects: [EFFECT],
    },
  ],
};

describe('Vengeful Archon authoring', () => {
  it('prints current Oracle and parses the activation as strict DSL', () => {
    const card = parseCard(VENGEFUL_ARCHON);

    expect(renderOracleText(card)).toBe(
      'Flying\n{X}: Prevent the next X damage that would be dealt to you this turn. If damage is prevented this way, Vengeful Archon deals that much damage to target player or planeswalker.',
    );
  });

  it('uses the player-or-planeswalker target space without widening model output', () => {
    expect([...legalTargetsFor(EFFECT.kind)]).toEqual(['targetPlayerOrPlaneswalker', 'noTarget']);
    expect(ALL_EFFECT_KINDS).toContain(EFFECT.kind);
    expect(UNPRICED_EFFECT_KINDS).toContain(EFFECT.kind);
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });

  it('admits only chosen X on an X activation, never a fixed amount or spell placement', () => {
    const literal = safeParseCard({
      ...VENGEFUL_ARCHON,
      abilities: [
        {
          ...VENGEFUL_ARCHON.abilities[0],
          cost: { mana: { W: 1 } },
          effects: [{ ...EFFECT, amount: 3 }],
        },
      ],
    });
    expect(literal.ok ? [] : literal.violations.map((violation) => violation.code)).toEqual([
      'EFFECT_CONDITION_INVALID',
    ]);

    const fixedCost = {
      ...VENGEFUL_ARCHON,
      abilities: [{ ...VENGEFUL_ARCHON.abilities[0], cost: { mana: { W: 1 } } }],
    };
    const fixedResult = safeParseCard(fixedCost);
    expect(fixedResult.ok ? [] : fixedResult.violations.map((violation) => violation.code)).toContain(
      'CHOSEN_X_WITHOUT_X_COST',
    );

    const spell = safeParseCard({
      kind: 'instant',
      id: 'tst-archon-shield-spell',
      name: 'Archon Shield Spell',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 37 },
      colors: ['W'],
      manaCost: { W: 1, hasX: true },
      effects: [EFFECT],
    });
    expect(spell.ok ? [] : spell.violations.map((violation) => violation.code)).toContain(
      'EFFECT_ILLEGAL_ON_CARD_TYPE',
    );
  });
});
