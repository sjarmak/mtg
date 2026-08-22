/**
 * `addMana`: the effect that puts mana in a pool.
 *
 * Until this kind existed the vocabulary had exactly one mana source — a land's
 * `producesMana`, tapped for exactly one mana — so a core set could not print
 * Llanowar Elves, could not print a Sol Ring, could not print a dual mana
 * ability and could not print a ritual. Four cards, one missing primitive.
 *
 * What is asserted here is the printed shape rather than the pool: the kernel's
 * `add-mana.test.ts` proves the mana lands and can be spent, and a test that
 * only proves an effect parses would prove nothing about whether the game runs
 * it. What belongs on this side is the card face and the refusals, because the
 * refusals are the design: `produces` is a *choice* list and never a sum, a
 * mana ability is one effect behind one `{T}`, and a card carries at most one
 * of them — the three rules that let `activateManaAbility`'s frozen
 * `(oid, color)` payload name one activation unambiguously.
 */
import { describe, expect, it } from 'vitest';
import {
  ActivationCostSchema,
  MechanicModelActivationCostSchema,
  ModelActivationCostSchema,
} from '../src/ability-shape';
import type { Amount, CardInput, Effect, ViolationCode } from '../src/index';
import {
  isManaEffect,
  isPricedEffectKind,
  manaAbilityOf,
  manaSourceColors,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const SWAMP_COUNT: Amount = { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' };

function tapFor(produces: readonly string[], amount: Amount = 1): Record<string, unknown> {
  return {
    kind: 'activated',
    cost: { mana: {}, tapSelf: true },
    effects: [{ kind: 'addMana', produces: [...produces], amount }],
  };
}

function mystic(abilities: readonly Record<string, unknown>[]): CardInput {
  return {
    kind: 'creature',
    id: 'tst-mystic',
    name: 'Thicket Mystic',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { G: 1 },
    colors: ['G'],
    subtypes: ['Elf', 'Druid'],
    power: 1,
    toughness: 1,
    abilities: [...abilities],
  } as CardInput;
}

function ritual(effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-rite',
    name: 'Shadow Rite',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { B: 1 },
    colors: ['B'],
    effects: [...effects],
  } as CardInput;
}

function codesOf(input: CardInput): readonly ViolationCode[] {
  return validateCard(input).map((found) => found.code);
}

describe('a mana ability on a card face', () => {
  it('prints Llanowar templating: one tap, one mana', () => {
    const card = mystic([tapFor(['G'])]);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(parseCard(card))).toBe('{T}: Add {G}.');
  });

  it('prints a repeated symbol for a quantity rather than a numeral', () => {
    const ring: CardInput = {
      kind: 'artifact',
      id: 'tst-ring',
      name: 'Sun Ring',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 1 },
      abilities: [tapFor(['C'], 2)],
    } as CardInput;
    expect(validateCard(ring)).toEqual([]);
    expect(renderOracleText(parseCard(ring))).toBe('{T}: Add {C}{C}.');
  });

  it('prints a choice of colors as a choice, not a sum', () => {
    const card = mystic([tapFor(['W', 'U'])]);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(parseCard(card))).toBe('{T}: Add {W} or {U}.');
  });

  it('prints all five colors as "any color" rather than a four-way disjunction', () => {
    const card = mystic([tapFor(['W', 'U', 'B', 'R', 'G'])]);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(parseCard(card))).toBe('{T}: Add one mana of any color.');
  });

  it('carries a quantity beside the five-color choice, which is the Lotus line', () => {
    const lotus: CardInput = {
      kind: 'artifact',
      id: 'tst-bloom',
      name: 'Gleaming Bloom',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 5 },
      manaCost: { generic: 5 },
      abilities: [tapFor(['W', 'U', 'B', 'R', 'G'], 3)],
    } as CardInput;
    expect(validateCard(lotus)).toEqual([]);
    expect(renderOracleText(parseCard(lotus))).toBe('{T}: Add three mana of any one color.');
  });

  it('may cost mana as well as the tap, which is what a filter and a Coffers are', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: { generic: 2 }, tapSelf: true },
        effects: [{ kind: 'addMana', produces: ['B'], amount: SWAMP_COUNT }],
      },
    ]);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(parseCard(card))).toBe(
      '{2}, {T}: Add an amount of {B} equal to the number of Swamps you control.',
    );
  });

  it('reports its colors through one function, whichever way the card prints them', () => {
    expect(manaSourceColors(parseCard(mystic([tapFor(['W', 'U'])])))).toEqual(['W', 'U']);
    expect(manaAbilityOf(parseCard(mystic([tapFor(['G'])])))).not.toBeNull();
    expect(manaAbilityOf(parseCard(mystic([])))).toBeNull();
  });
});

describe('a ritual', () => {
  it('adds several mana of one color as a spell', () => {
    const card = ritual([{ kind: 'addMana', produces: ['B'], amount: 3 }]);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(parseCard(card))).toBe('Add {B}{B}{B}.');
  });

  it('cannot offer a choice of colors, because a resolving spell has nobody to ask', () => {
    expect(codesOf(ritual([{ kind: 'addMana', produces: ['B', 'R'], amount: 1 }]))).toContain(
      'MANA_ABILITY_INVALID',
    );
  });
});

describe('what a mana ability may not be', () => {
  it('refuses a second effect beside the mana', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: {}, tapSelf: true },
        effects: [
          { kind: 'addMana', produces: ['G'], amount: 1 },
          { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
        ],
      },
    ]);
    expect(codesOf(card)).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a cost with no tap symbol, which is repeatable at one priority', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, tapSelf: false },
        effects: [{ kind: 'addMana', produces: ['G'], amount: 2 }],
      },
    ]);
    expect(codesOf(card)).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a sacrifice in the cost, which the frozen activation payload cannot carry', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
        effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
      },
    ]);
    expect(codesOf(card)).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a second mana ability on the same card', () => {
    expect(codesOf(mystic([tapFor(['G']), tapFor(['W'])]))).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a land that both produces mana and prints one', () => {
    const land: CardInput = {
      kind: 'land',
      id: 'tst-spring',
      name: 'Verdant Spring',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 4 },
      producesMana: ['G'],
      abilities: [tapFor(['G'])],
    } as CardInput;
    expect(codesOf(land)).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a trigger that adds mana, because a mana ability never uses the stack', () => {
    const card = mystic([
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
      },
    ]);
    expect(codesOf(card)).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a repeated color, which is a choice between one thing', () => {
    expect(codesOf(mystic([tapFor(['G', 'G'])]))).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a quantity beside a choice of colors', () => {
    expect(codesOf(mystic([tapFor(['W', 'U'], 2)]))).toContain('MANA_ABILITY_INVALID');
  });

  it('refuses a quantity outside the printed range', () => {
    expect(codesOf(mystic([tapFor(['G'], 9)]))).toContain('EFFECT_PARAM_OUT_OF_RANGE');
  });
});

describe('where addMana sits in the vocabulary', () => {
  it('is unpriced and unreachable from the generator', () => {
    expect(isPricedEffectKind('addMana')).toBe(false);
    expect(MODEL_EFFECT_KINDS).not.toContain('addMana');
  });

  it('is named by its own predicate, the way a source-body effect is', () => {
    expect(isManaEffect('addMana')).toBe(true);
    expect(isManaEffect('fight')).toBe(false);
  });
});

describe('an activation cost that prices a caster-chosen X', () => {
  /**
   * `hasX` on an `ActivationCost` has always been schema-legal. What
   * `mtg-nhyv.17` decided is that it is charged and read rather than refused
   * outright, and that the two halves have to arrive together —
   * `checkActivationCost`'s own docblock argues why an X nobody reads is worse
   * on an activation than on a spell.
   */
  it('parses on the engine tier and is refused on both model tiers', () => {
    // Where the containment invariant is strict rather than equal. The engine
    // reads `hasX` off an activation cost because `ActivationCostSchema`
    // embeds `ManaCostSchema` whole and always has; both model tiers override
    // that one field with `ModelManaCostSchema`, which declares no `hasX` at
    // all, so a model that emits one is refused by the name of the key and sent
    // back rather than carried (`mtg-nhyv.69`). Silklash Spider's `{X}{G}{G}`
    // is hand-authorable and runnable and unreachable from the generator, the
    // same way `sacrificeOther` is.
    expect(ActivationCostSchema.parse({ mana: { G: 2, hasX: true } }).mana.hasX).toBe(true);
    for (const schema of [ModelActivationCostSchema, MechanicModelActivationCostSchema] as const) {
      const parsed = schema.safeParse({ mana: { G: 2, hasX: true } });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContainEqual(
        expect.stringContaining('hasX'),
      );
      // The same cost without the rider is reachable on both tiers, so each
      // refusal is about this field and not about the shape around it.
      expect(schema.safeParse({ mana: { G: 2 } }).success).toBe(true);
    }
  });

  it('is refused when no effect reads the value it announces', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: { generic: 1, hasX: true }, tapSelf: true },
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(codesOf(card)).toContain('ABILITY_COST_INVALID');
  });

  it('is accepted when an effect reads it', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: { generic: 1, hasX: true }, tapSelf: true },
        effects: [{ kind: 'gainLife', amount: { kind: 'chosenX' }, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(validateCard(card)).toEqual([]);
  });

  it('refuses the reverse: an effect that reads an X the cost never announces', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, tapSelf: true },
        effects: [{ kind: 'gainLife', amount: { kind: 'chosenX' }, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(codesOf(card)).toContain('CHOSEN_X_WITHOUT_X_COST');
  });

  it('leaves an ordinary activation cost alone', () => {
    const card = mystic([
      {
        kind: 'activated',
        cost: { mana: { generic: 1 }, tapSelf: true },
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(validateCard(card)).toEqual([]);
  });
});
