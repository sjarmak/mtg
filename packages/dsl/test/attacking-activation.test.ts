/** Typed placement and Oracle rendering for Ancient Hellkite's combat-only activation. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, validateCard, type Card } from '@mtg/dsl';

const effect = {
  kind: 'dealDamage' as const,
  amount: 1,
  target: { kind: 'targetCreatureDefendingPlayerControls' as const },
};

function hellkite(activateOnlyWhileAttacking: true | undefined): Card {
  return parseCard({
    kind: 'creature',
    id: 'tst-ancient-hellkite',
    name: 'Ancient Hellkite',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 122 },
    colors: ['R'],
    manaCost: { generic: 4, R: 3 },
    power: 6,
    toughness: 6,
    keywords: ['flying'],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { R: 1 } },
        effects: [effect],
        ...(activateOnlyWhileAttacking === true ? { activateOnlyWhileAttacking: true } : {}),
      },
    ],
  });
}

describe('an activation restricted to its source attacking', () => {
  it('renders Ancient Hellkite exactly and admits its defending-player target', () => {
    const card = hellkite(true);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Flying\n{R}: Ancient Hellkite deals 1 damage to target creature defending player controls. Activate only if Ancient Hellkite is attacking.',
    );
  });

  it('still refuses the defending-player target without the combat restriction', () => {
    expect(() => hellkite(undefined)).toThrow(/ILLEGAL_TARGET_IN_ABILITY/);
  });

  it('keeps the restriction outside the generator-facing ability schema', () => {
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'activated',
        cost: { mana: { R: 1 } },
        effects: [effect],
        activateOnlyWhileAttacking: true,
      }).success,
    ).toBe(false);
  });
});
