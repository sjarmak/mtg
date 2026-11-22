import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  StaticModificationSchema,
} from '@mtg/dsl';
import { ModelStaticModificationSchema } from '../src/ability-shape';

const DISCARD_REPLACEMENT = { kind: 'discardedByOpponentEntersBattlefield' } as const;

export const LOXODON_SMITER = {
  kind: 'creature',
  id: 'rtr-178',
  name: 'Loxodon Smiter',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 178 },
  manaCost: { generic: 1, G: 1, W: 1 },
  colors: ['G', 'W'],
  subtypes: ['Elephant', 'Soldier'],
  power: 4,
  toughness: 4,
  cannotBeCountered: true,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      printedSourceReference: 'thisCard',
      modification: DISCARD_REPLACEMENT,
    },
  ],
} as const;

describe('RTR #178 Loxodon Smiter DSL', () => {
  it('renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(LOXODON_SMITER))).toBe(
      [
        "This spell can't be countered.",
        'If a spell or ability an opponent controls causes you to discard this card, put it onto the battlefield instead of putting it into your graveyard.',
      ].join('\n'),
    );
  });

  it('keeps the discard replacement outside model-authored static modifications', () => {
    expect(StaticModificationSchema.safeParse(DISCARD_REPLACEMENT).success).toBe(true);
    expect(ModelStaticModificationSchema.safeParse(DISCARD_REPLACEMENT).success).toBe(false);
    expect(AbilitySchema.safeParse(LOXODON_SMITER.abilities[0]).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(LOXODON_SMITER.abilities[0]).success).toBe(false);
  });

  it('rejects the in-hand source reference on an unrelated static rule', () => {
    const parsed = safeParseCard({
      ...LOXODON_SMITER,
      abilities: [
        {
          ...LOXODON_SMITER.abilities[0],
          modification: { kind: 'grantKeyword', keyword: 'vigilance' },
        },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((violation) => [violation.code, violation.path])).toContainEqual([
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities[0].printedSourceReference',
    ]);
  });
});
