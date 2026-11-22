/** Exact authoring contract for RTR #13, Knightly Valor. */
import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  ModelTokenSpecSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '@mtg/dsl';

const KNIGHT = {
  name: 'Knight',
  power: 2,
  toughness: 2,
  colors: ['W'],
  subtypes: ['Knight'],
  keywords: ['vigilance'],
  printedKeywordReminder: 'vigilance',
} as const;

const ENTRY = {
  kind: 'triggered',
  condition: 'selfEnters',
  printedSourceReference: 'thisAura',
  effects: [{ kind: 'createToken', count: 1, token: KNIGHT }],
} as const;

function knightlyValor(token: unknown = KNIGHT) {
  return {
    kind: 'enchantment',
    id: 'rtr-013-knightly-valor',
    name: 'Knightly Valor',
    rarity: 'common',
    set: { code: 'RTR', collectorNumber: 13 },
    manaCost: { generic: 4, W: 1 },
    colors: ['W'],
    subtypes: ['Aura'],
    aura: {
      enchant: 'creature',
      modifications: [
        { kind: 'statBonus', power: 2, toughness: 2 },
        { kind: 'grantKeyword', keyword: 'vigilance' },
      ],
    },
    abilities: [{ ...ENTRY, effects: [{ kind: 'createToken', count: 1, token }] }],
  } as const;
}

describe('Knightly Valor authoring', () => {
  it('parses and prints the exact current Oracle text', () => {
    expect(renderOracleText(parseCard(knightlyValor()))).toBe(
      "Enchant creature\nWhen this Aura enters, create a 2/2 white Knight creature token with vigilance. (Attacking doesn't cause it to tap.)\nEnchanted creature gets +2/+2 and has vigilance.",
    );
  });

  it('keeps both source-faithful presentation fields outside the generator contract', () => {
    expect(ModelAbilitySchema.safeParse(ENTRY).success).toBe(false);
    expect(ModelTokenSpecSchema.safeParse(KNIGHT).success).toBe(false);
  });

  it('requires the printed reminder to name a keyword the token has', () => {
    const parsed = safeParseCard(knightlyValor({ ...KNIGHT, keywords: [] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'EFFECT_CONDITION_INVALID',
      'abilities[0].effects[0].token.printedKeywordReminder',
    ]);
  });

  it('confines the printed Aura reference to an Aura card', () => {
    const parsed = safeParseCard({ ...knightlyValor(), subtypes: [], aura: undefined });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities[0].printedSourceReference',
    ]);
  });
});
