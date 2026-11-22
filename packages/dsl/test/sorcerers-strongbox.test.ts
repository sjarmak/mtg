/** Sorcerer's Strongbox: a typed, hand-authored coin-flip branch. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const COIN_FLIP = {
  kind: 'flipCoin',
  winEffects: [
    { kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } },
    { kind: 'drawCards', count: 3, target: { kind: 'noTarget' } },
  ],
} as const;

function strongboxInput(effect: unknown = COIN_FLIP): CardInput {
  return {
    kind: 'artifact',
    id: 'm11-213-sorcerers-strongbox',
    name: "Sorcerer's Strongbox",
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 213 },
    manaCost: { generic: 4 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 }, tapSelf: true },
        effects: [effect],
      },
    ],
  } as CardInput;
}

describe("Sorcerer's Strongbox DSL", () => {
  it('parses and renders the current Oracle text exactly', () => {
    const card = parseCard(strongboxInput());

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "{2}, {T}: Flip a coin. If you win the flip, sacrifice Sorcerer's Strongbox and draw three cards.",
    );
  });

  it('keeps random branching hand-authored and outside the generator answer schema', () => {
    expect(CardEffectSchema.safeParse(COIN_FLIP).success).toBe(true);
    expect(ModelEffectSchema.safeParse(COIN_FLIP).success).toBe(false);
  });

  it('refuses an outcome with neither a win nor a loss branch', () => {
    const result = safeParseCard(strongboxInput({ kind: 'flipCoin' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: 'RANDOM_BRANCH_INVALID', path: 'abilities[0].effects[0]' }),
    );
  });

  it('refuses a branch that would owe an unrepresented target choice', () => {
    const result = safeParseCard(
      strongboxInput({
        kind: 'flipCoin',
        winEffects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'RANDOM_BRANCH_INVALID',
        path: 'abilities[0].effects[0].winEffects[0]',
      }),
    );
  });

  it('applies duplicate-effect validation inside each random branch', () => {
    const draw = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } } as const;
    const result = safeParseCard(
      strongboxInput({
        kind: 'flipCoin',
        winEffects: [draw, draw],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_EFFECT',
        path: 'abilities[0].effects[0].winEffects[1]',
      }),
    );
  });

  it('applies retained-referent validation inside each random branch', () => {
    const result = safeParseCard(
      strongboxInput({
        kind: 'flipCoin',
        winEffects: [
          {
            kind: 'gainLife',
            amount: { kind: 'thatCreatureToughness' },
            target: { kind: 'noTarget' },
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[0].winEffects[0].amount.kind',
      }),
    );
  });
});
