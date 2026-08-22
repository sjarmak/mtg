import { describe, expect, it } from 'vitest';
import {
  CARD_KINDS,
  loyaltyCostText,
  ModelAbilitySchema,
  oracleRows,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '../src/index';

function walker(overrides: Partial<CardInput> = {}): CardInput {
  return {
    kind: 'planeswalker',
    id: 'tst-ajanis-witness',
    name: "Ajani's Witness",
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, W: 2 },
    colors: ['W'],
    supertypes: ['legendary'],
    subtypes: ['Ajani'],
    startingLoyalty: 4,
    abilities: [
      {
        kind: 'activated',
        loyaltyCost: 1,
        cost: { mana: {} },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        loyaltyCost: 0,
        cost: { mana: {} },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        loyaltyCost: -4,
        cost: { mana: {} },
        effects: [{ kind: 'createToken', count: 1, token: { name: 'Cat', power: 2, toughness: 2 } }],
      },
    ],
    ...overrides,
  } as CardInput;
}

describe('planeswalker cards', () => {
  it('parses starting loyalty and three signed loyalty abilities without creature stats', () => {
    const card = parseCard(walker());
    expect(card.kind).toBe('planeswalker');
    if (card.kind !== 'planeswalker') throw new Error('expected planeswalker');
    expect(card.startingLoyalty).toBe(4);
    expect(CARD_KINDS.at(-1)).toBe('planeswalker');
    expect(renderOracleText(card)).toBe(
      '[+1]: You gain 2 life.\n[0]: Draw a card.\n[−4]: Create a 2/2 colorless creature token.',
    );
  });

  it('rejects loyalty costs on other permanents and non-loyalty abilities on a planeswalker', () => {
    // Built as an artifact rather than spread from `walker()`: an artifact
    // schema declares no `startingLoyalty`, so a walker with its kind swapped
    // fails on that key before the ability is ever read, and the claim under
    // test is about the loyalty cost on the ability.
    const asArtifact = safeParseCard({
      kind: 'artifact',
      id: 'tst-witness-stone',
      name: 'Witness Stone',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 4 },
      abilities: [
        {
          kind: 'activated',
          loyaltyCost: 1,
          cost: { mana: {} },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(asArtifact.ok).toBe(false);
    if (!asArtifact.ok) expect(asArtifact.violations.map((v) => v.code)).toContain('ABILITY_COST_INVALID');

    const staticWalker = safeParseCard({
      ...walker(),
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
      ],
    });
    expect(staticWalker.ok).toBe(false);
    if (!staticWalker.ok) {
      expect(staticWalker.violations.map((v) => v.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }

    const unboundedCost = safeParseCard({
      ...walker(),
      abilities: [
        {
          kind: 'activated',
          loyaltyCost: 21,
          cost: { mana: {} },
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(unboundedCost.ok).toBe(false);
    if (!unboundedCost.ok) {
      expect(unboundedCost.violations.map((v) => v.code)).toContain('PLANESWALKER_INVALID');
    }
  });

  it('hands a face the loyalty cost as its own column, and the ability without it', () => {
    const rows = oracleRows(parseCard(walker()));
    expect(rows).toEqual([
      { loyaltyCost: '+1', text: 'You gain 2 life.' },
      { loyaltyCost: '0', text: 'Draw a card.' },
      { loyaltyCost: '−4', text: 'Create a 2/2 colorless creature token.' },
    ]);
  });

  it('prints the minus as U+2212 and never a hyphen', () => {
    expect(loyaltyCostText(-8)).toBe('\u22128');
    expect(loyaltyCostText(-8)).not.toContain('-');
    expect(loyaltyCostText(0)).toBe('0');
    expect(loyaltyCostText(3)).toBe('+3');
  });

  it('keeps the flat oracle string a projection of the rows', () => {
    const card = parseCard(walker());
    const flattened = oracleRows(card)
      .map((row) => (row.loyaltyCost === null ? row.text : `[${row.loyaltyCost}]: ${row.text}`))
      .join('\n');
    expect(flattened).toBe(renderOracleText(card));
  });

  it('keeps loyalty outside the model ability schema', () => {
    // A fill batch answers in `ModelAbilitySchema`, which declares no
    // `loyaltyCost`; since `mtg-nhyv.69` writing one is a parse error naming
    // the key, so a walker ability reaches a card only through
    // `LoyaltyModelAbilitySchema` and the slot that commissions it.
    const parsed = ModelAbilitySchema.safeParse({
      kind: 'activated',
      loyaltyCost: 1,
      cost: { mana: { generic: 1 } },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining('"loyaltyCost"'),
    );
  });
});
