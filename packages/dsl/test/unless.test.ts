/**
 * "unless its controller pays {2}" (CR 118.8): a spell that resolves as printed
 * only if a player declines to pay a price the card names.
 *
 * The split `may.test.ts` describes holds here for the same reason. Who is
 * asked, whether they can afford it, and what the kernel does while it waits
 * are `@mtg/kernel`'s (`unless-choice.ts`, `stack.ts`); this file is the DSL
 * half, so every assertion below is about the schema, `checkUnless`' six
 * guards, and the line the card prints.
 *
 * The payer is a *word*, not a player. `targetController` and `targetPlayer`
 * are read off the one effect the spell has when it resolves, which is why
 * `UNLESS_PAYER_HAS_NO_TARGET` exists and why the clause is refused on a spell
 * with no effects, several effects, or modes: each of those is a card where
 * "its controller" names nobody in particular.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect, ManaCostInput, UnlessPayer } from '../src/index';
import { renderOracleText, UnlessPayerSchema, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

/**
 * The clause as a brief writes it: a `ManaCost` is five colors, a generic and
 * an `X` after parsing, and no card input spells all seven out.
 */
interface UnlessInput {
  readonly payer: UnlessPayer;
  readonly cost: ManaCostInput;
}

function sorceryInput(fields: {
  readonly effects?: readonly Effect[];
  readonly modes?: readonly { effects: readonly Effect[] }[];
  readonly may?: 'you' | 'opponent';
  readonly unless?: UnlessInput;
}): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-unless-clause',
    name: 'Royal Decree',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: fields.effects ?? [],
    ...(fields.modes !== undefined ? { modes: fields.modes } : {}),
    ...(fields.may !== undefined ? { may: fields.may } : {}),
    ...(fields.unless !== undefined ? { unless: fields.unless } : {}),
  } as unknown as CardInput;
}

function creatureWithUnless(unless: UnlessInput): CardInput {
  return {
    kind: 'creature',
    id: 'tst-unless-guard',
    name: 'Tollkeeper',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Soldier'],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [],
    unless,
    power: 2,
    toughness: 2,
  } as unknown as CardInput;
}

const DESTROY: Effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
const DAMAGE: Effect = { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } };
const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } };
const COUNTER: Effect = { kind: 'counterSpell' };
const TWO: UnlessInput = { payer: 'targetController', cost: { generic: 2 } };

function codesOf(input: CardInput): readonly string[] {
  return validateCard(input).map((found) => found.code);
}

function violationAt(input: CardInput, code: string): string | undefined {
  return validateCard(input).find((found) => found.code === code)?.path;
}

describe('the payer word', () => {
  it('is one of exactly two', () => {
    expect(UnlessPayerSchema.parse('targetController')).toBe('targetController');
    expect(UnlessPayerSchema.parse('targetPlayer')).toBe('targetPlayer');
    expect(UnlessPayerSchema.safeParse('targetOpponent').success).toBe(false);
    expect(UnlessPayerSchema.safeParse('controller').success).toBe(false);
  });

  it('is absent on a card that names no price', () => {
    expect(parseCard(sorceryInput({ effects: [DESTROY] })).unless).toBeUndefined();
  });

  it('survives a parse round trip on a card that names one', () => {
    const card = parseCard(sorceryInput({ effects: [DESTROY], unless: TWO }));
    expect(card.unless?.payer).toBe('targetController');
    expect(card.unless?.cost.generic).toBe(2);
    expect(card.unless?.cost.hasX).toBe(false);
  });
});

describe('where an "unless" clause may legally appear', () => {
  it('is refused on a permanent, the same way modes and may are', () => {
    expect(codesOf(creatureWithUnless(TWO))).toContain('UNLESS_ILLEGAL_ON_CARD_TYPE');
  });

  it('cannot sit beside a mode list, because a mode chosen later names the payer', () => {
    const codes = codesOf(
      sorceryInput({ modes: [{ effects: [DESTROY] }, { effects: [DAMAGE] }], unless: TWO }),
    );
    expect(codes).toContain('UNLESS_AND_MODES_BOTH_PRESENT');
  });

  it('cannot sit beside "may", because the kernel would pause twice in one resolution', () => {
    expect(codesOf(sorceryInput({ effects: [DESTROY], may: 'you', unless: TWO }))).toContain(
      'UNLESS_AND_MAY_BOTH_PRESENT',
    );
  });

  it('is silent on an ordinary spell that gates one targeted effect', () => {
    const codes = codesOf(sorceryInput({ effects: [DESTROY], unless: TWO }));
    expect(codes).toEqual([]);
  });
});

describe('the sentence the clause modifies', () => {
  it('is refused when the spell prints none', () => {
    expect(codesOf(sorceryInput({ effects: [], unless: TWO }))).toContain('UNLESS_NEEDS_ONE_EFFECT');
  });

  it('is refused when the spell prints two, because the price would buy off both', () => {
    expect(codesOf(sorceryInput({ effects: [DESTROY, DAMAGE], unless: TWO }))).toContain(
      'UNLESS_NEEDS_ONE_EFFECT',
    );
  });

  it('does not also complain about the effect count on a modal card', () => {
    const codes = codesOf(
      sorceryInput({ modes: [{ effects: [DESTROY] }, { effects: [DAMAGE] }], unless: TWO }),
    );
    expect(codes).not.toContain('UNLESS_NEEDS_ONE_EFFECT');
  });
});

describe('reading the payer off the target', () => {
  it('refuses "its controller" on an effect that targets nothing', () => {
    const input = sorceryInput({ effects: [COUNTER], unless: TWO });
    expect(codesOf(input)).toContain('UNLESS_PAYER_HAS_NO_TARGET');
    expect(violationAt(input, 'UNLESS_PAYER_HAS_NO_TARGET')).toBe('unless.payer');
  });

  it('refuses "that player" on an effect aimed at a permanent', () => {
    const codes = codesOf(
      sorceryInput({ effects: [DESTROY], unless: { payer: 'targetPlayer', cost: { generic: 2 } } }),
    );
    expect(codes).toContain('UNLESS_PAYER_HAS_NO_TARGET');
  });

  it('refuses "its controller" on an effect aimed at a player', () => {
    expect(codesOf(sorceryInput({ effects: [DRAW], unless: TWO }))).toContain('UNLESS_PAYER_HAS_NO_TARGET');
  });

  it('accepts "that player" on an effect aimed at a player', () => {
    const codes = codesOf(
      sorceryInput({ effects: [DRAW], unless: { payer: 'targetPlayer', cost: { generic: 1, U: 1 } } }),
    );
    expect(codes).toEqual([]);
  });
});

describe('the price', () => {
  it('refuses {0}, which is a clause the card prints and never charges', () => {
    const input = sorceryInput({ effects: [DESTROY], unless: { payer: 'targetController', cost: {} } });
    expect(codesOf(input)).toContain('UNLESS_COST_IS_FREE');
    expect(violationAt(input, 'UNLESS_COST_IS_FREE')).toBe('unless.cost');
  });

  it('refuses {X}, because the payer is not the caster and nothing names the X', () => {
    const input = sorceryInput({
      effects: [DESTROY],
      unless: { payer: 'targetController', cost: { hasX: true } },
    });
    expect(codesOf(input)).toContain('UNLESS_COST_IS_VARIABLE');
    expect(violationAt(input, 'UNLESS_COST_IS_VARIABLE')).toBe('unless.cost');
  });

  it('does not also call an {X} toll free, which would be two names for one fault', () => {
    const codes = codesOf(
      sorceryInput({
        effects: [DESTROY],
        unless: { payer: 'targetController', cost: { hasX: true } },
      }),
    );
    expect(codes).not.toContain('UNLESS_COST_IS_FREE');
  });

  it('still runs the ordinary structural checks on the gated effect', () => {
    const input = sorceryInput({
      effects: [{ kind: 'dealDamage', amount: 40, target: { kind: 'targetCreature' } }],
      unless: TWO,
    });
    expect(violationAt(input, 'EFFECT_PARAM_OUT_OF_RANGE')).toBe('effects[0].amount');
  });
});

describe('the line the card prints', () => {
  it('appends the clause to the one sentence, trimming its full stop', () => {
    const card = parseCard(sorceryInput({ effects: [DESTROY], unless: TWO }));
    expect(renderOracleText(card)).toBe('Destroy target creature unless its controller pays {2}.');
  });

  it('says "that player" when the payer is the target itself', () => {
    const card = parseCard(
      sorceryInput({
        effects: [DRAW],
        unless: { payer: 'targetPlayer', cost: { generic: 1, U: 1 } },
      }),
    );
    expect(renderOracleText(card)).toBe('Target player draws a card unless that player pays {1}{U}.');
  });

  it('names the source in the sentence it modifies, not in the clause', () => {
    const card = parseCard(
      sorceryInput({ effects: [DAMAGE], unless: { payer: 'targetController', cost: { R: 1 } } }),
    );
    expect(renderOracleText(card)).toBe(
      'Royal Decree deals 3 damage to target creature unless its controller pays {R}.',
    );
  });

  it('prints the "may" line too, which it did not between mtg-bc2.152.4 and now', () => {
    const card = parseCard(sorceryInput({ effects: [DESTROY], may: 'you' }));
    expect(renderOracleText(card)).toBe('You may destroy target creature.');
  });

  it('leaves a spell that names neither exactly as it was', () => {
    const card = parseCard(sorceryInput({ effects: [DESTROY] }));
    expect(renderOracleText(card)).toBe('Destroy target creature.');
  });
});
