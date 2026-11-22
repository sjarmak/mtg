/** Palisade Giant's exact, hand-authored live damage-redirection replacement. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { parseCard, renderOracleText, STATIC_MODIFICATION_KINDS, validateCard } from '../src/index';

const STATIC_MARKER = {
  kind: 'static',
  scope: 'self',
  subtype: null,
  modification: { kind: 'preventCombatDamage' },
} as const;

const INPUT = {
  kind: 'creature',
  id: 'rtr-015-palisade-giant',
  name: 'Palisade Giant',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 15 },
  manaCost: { generic: 4, W: 2 },
  colors: ['W'],
  subtypes: ['Giant', 'Soldier'],
  power: 2,
  toughness: 7,
  redirectControllerAndOtherPermanentsDamageToSelf: true,
  abilities: [STATIC_MARKER],
} satisfies CardInput;

describe('Palisade Giant DSL', () => {
  it('prints the current Oracle sentence exactly', () => {
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'All damage that would be dealt to you and other permanents you control is dealt to this creature instead.',
    );
  });

  it('keeps the atomic replacement outside the global static-modification vocabulary', () => {
    expect(STATIC_MODIFICATION_KINDS).not.toContain('redirectControllerAndOtherPermanentsDamageToSelf');
  });

  it('refuses a widened, team-scoped carrier', () => {
    expect(() =>
      parseCard({
        ...INPUT,
        abilities: [{ ...STATIC_MARKER, scope: 'creaturesYouControl' }],
      }),
    ).toThrow(/ABILITY_ILLEGAL_ON_CARD_TYPE/u);
  });

  it('refuses an absent carrier and a noncreature source', () => {
    expect(() => parseCard({ ...INPUT, abilities: [] })).toThrow(/ABILITY_ILLEGAL_ON_CARD_TYPE/u);
    expect(() =>
      parseCard({
        ...INPUT,
        kind: 'enchantment',
        subtypes: [],
        power: undefined,
        toughness: undefined,
      }),
    ).toThrow(/SCHEMA_INVALID/u);
  });
});
