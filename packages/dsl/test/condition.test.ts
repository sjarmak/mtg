/**
 * `Condition`: the predicate a CR 611.2c conditional continuous effect asks.
 *
 * `condition.ts` argues the shape; these tests are the three claims that
 * matter for a value that has to survive a worker boundary and drive a
 * kernel evaluator it never imports: it parses the one member the vocabulary
 * has, it round-trips through the serialization boundary the design docblock
 * promises, and it carries no function anywhere in its shape.
 */
import { describe, expect, it } from 'vitest';
import {
  AnyCreatureHasCounterConditionSchema,
  ConditionSchema,
  ControlsSubtypeConditionSchema,
  LifeAtLeastConditionSchema,
  NoOpponentDealtDamageThisTurnConditionSchema,
  OpponentGraveyardAtLeastConditionSchema,
  renderOracleText,
  validateCards,
} from '../src/index';
import type { CardInput, Condition } from '../src/index';
import { parseCard, safeParseCard } from '../src/parse';

describe('ControlsSubtypeConditionSchema', () => {
  it('parses a threshold over a named subtype', () => {
    const parsed = ControlsSubtypeConditionSchema.parse({
      kind: 'controlsSubtype',
      subtype: 'Merfolk',
      atLeast: 3,
    });
    expect(parsed).toEqual({ kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 });
  });

  it('refuses a threshold below one, since a floor of zero is unconditional', () => {
    expect(
      ControlsSubtypeConditionSchema.safeParse({ kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 0 })
        .success,
    ).toBe(false);
  });

  it('refuses a non-integer threshold', () => {
    expect(
      ControlsSubtypeConditionSchema.safeParse({ kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 1.5 })
        .success,
    ).toBe(false);
  });
});

describe('AnyCreatureHasCounterConditionSchema', () => {
  it('parses a board-wide presence check over a named counter kind', () => {
    const parsed = AnyCreatureHasCounterConditionSchema.parse({
      kind: 'anyCreatureHasCounter',
      counter: 'gloom',
    });
    expect(parsed).toEqual({ kind: 'anyCreatureHasCounter', counter: 'gloom' });
  });

  it('carries no atLeast field: presence, not a threshold', () => {
    const parsed = AnyCreatureHasCounterConditionSchema.parse({
      kind: 'anyCreatureHasCounter',
      counter: 'gloom',
    });
    expect('atLeast' in parsed).toBe(false);
  });

  it('refuses a counter kind outside CounterKindSchema', () => {
    expect(
      AnyCreatureHasCounterConditionSchema.safeParse({ kind: 'anyCreatureHasCounter', counter: 'nope' })
        .success,
    ).toBe(false);
  });
});

describe('OpponentGraveyardAtLeastConditionSchema', () => {
  it('parses a threshold over the other seat graveyard', () => {
    const parsed = OpponentGraveyardAtLeastConditionSchema.parse({
      kind: 'opponentGraveyardAtLeast',
      atLeast: 10,
    });
    expect(parsed).toEqual({ kind: 'opponentGraveyardAtLeast', atLeast: 10 });
  });

  it('refuses a floor of zero, which is unconditional rather than conditional', () => {
    expect(
      OpponentGraveyardAtLeastConditionSchema.safeParse({ kind: 'opponentGraveyardAtLeast', atLeast: 0 })
        .success,
    ).toBe(false);
  });

  it('names no player and no filter: the seat and the whole graveyard are both fixed', () => {
    const parsed = OpponentGraveyardAtLeastConditionSchema.parse({
      kind: 'opponentGraveyardAtLeast',
      atLeast: 10,
    });
    expect(Object.keys(parsed).sort()).toEqual(['atLeast', 'kind']);
  });
});

describe('LifeAtLeastConditionSchema', () => {
  it('parses a life threshold and names no seat, so "you" is read at evaluation time', () => {
    const parsed = LifeAtLeastConditionSchema.parse({ kind: 'lifeAtLeast', atLeast: 30 });
    expect(parsed).toEqual({ kind: 'lifeAtLeast', atLeast: 30 });
    expect(Object.keys(parsed).sort()).toEqual(['atLeast', 'kind']);
  });

  it('refuses a floor of zero, which every life total already satisfies', () => {
    expect(LifeAtLeastConditionSchema.safeParse({ kind: 'lifeAtLeast', atLeast: 0 }).success).toBe(false);
  });

  it('refuses a fractional life threshold', () => {
    expect(LifeAtLeastConditionSchema.safeParse({ kind: 'lifeAtLeast', atLeast: 20.5 }).success).toBe(false);
  });
});

describe('NoOpponentDealtDamageThisTurnConditionSchema', () => {
  it('carries nothing but its kind: presence, with no amount and no source', () => {
    const parsed = NoOpponentDealtDamageThisTurnConditionSchema.parse({
      kind: 'noOpponentDealtDamageThisTurn',
    });
    expect(Object.keys(parsed)).toEqual(['kind']);
  });

  it('refuses an amount, which the printed clause does not name', () => {
    expect(
      NoOpponentDealtDamageThisTurnConditionSchema.safeParse({
        kind: 'noOpponentDealtDamageThisTurn',
        atLeast: 1,
      }).success,
    ).toBe(false);
  });
});

describe('ConditionSchema', () => {
  it('discriminates on kind, so an unrecognized member is rejected rather than coerced', () => {
    expect(ConditionSchema.safeParse({ kind: 'inGraveyard', subtype: 'Merfolk' }).success).toBe(false);
  });

  it('has exactly the five members this schema has shipped, in declaration order', () => {
    expect(ConditionSchema.options.map((option) => [...option.shape.kind.values])).toEqual([
      ['controlsSubtype'],
      ['anyCreatureHasCounter'],
      ['opponentGraveyardAtLeast'],
      ['lifeAtLeast'],
      ['noOpponentDealtDamageThisTurn'],
    ]);
  });

  it('parses a board-wide counter condition through the union, not just the member schema', () => {
    const condition: Condition = ConditionSchema.parse({
      kind: 'anyCreatureHasCounter',
      counter: 'gloom',
    });
    expect(condition).toEqual({ kind: 'anyCreatureHasCounter', counter: 'gloom' });
  });

  it('is serializable: no closures anywhere in the parsed shape', () => {
    const condition: Condition = ConditionSchema.parse({
      kind: 'controlsSubtype',
      subtype: 'Merfolk',
      atLeast: 3,
    });
    // The determinism constraint `condition.ts` argues, checked on the value
    // rather than assumed from the schema: JSON round-trips a function as
    // `undefined` or drops the key, so a survived closure would show up as a
    // shape mismatch here.
    const roundTripped = JSON.parse(JSON.stringify(condition)) as Condition;
    expect(roundTripped).toEqual(condition);

    for (const value of Object.values(condition)) {
      expect(typeof value).not.toBe('function');
    }
  });

  it('survives structuredClone unchanged, the same boundary GameState crosses', () => {
    const condition: Condition = ConditionSchema.parse({
      kind: 'controlsSubtype',
      subtype: 'Merfolk',
      atLeast: 3,
    });
    expect(structuredClone(condition)).toEqual(condition);
  });
});

/**
 * The printed half. A conditional static whose text omits the condition
 * describes a strictly better card than the one the kernel runs, and the
 * kernel's half of this field has been enforced since it existed: `oracle.ts`
 * dropped `enabledWhile` on the floor, so "Creatures you control get +1/+1."
 * was the whole printed sentence of an ability that applied only sometimes.
 */
describe('a conditional static, printed', () => {
  function lord(condition: Condition): CardInput {
    return {
      kind: 'creature',
      id: 'tst-conditional-lord',
      name: 'Tidecaller Elder',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 9 },
      manaCost: { generic: 2, U: 1 },
      colors: ['U'],
      subtypes: ['Merfolk'],
      supertypes: [],
      keywords: [],
      power: 2,
      toughness: 3,
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
          enabledWhile: condition,
        },
      ],
    } as unknown as CardInput;
  }

  it('says the condition in front of the sentence it governs', () => {
    const card = parseCard(lord({ kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 1 }));
    expect(renderOracleText(card)).toContain(
      'As long as you control a Merfolk, creatures you control get +1/+1.',
    );
  });

  it('prints a floor above one as the floor it is', () => {
    const card = parseCard(lord({ kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 3 }));
    expect(renderOracleText(card)).toContain(
      'As long as you control three or more Merfolk, creatures you control get +1/+1.',
    );
  });

  it('leaves an unconditional static exactly as it was', () => {
    const input = lord({ kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 1 });
    const abilities = (input as unknown as { abilities: Record<string, unknown>[] }).abilities;
    const first = abilities[0];
    if (first === undefined) throw new Error('no ability');
    delete first.enabledWhile;
    expect(renderOracleText(parseCard(input))).toContain('Creatures you control get +1/+1.');
    expect(renderOracleText(parseCard(input))).not.toContain('As long as');
  });

  it('prints a board-wide counter condition as presence, not a floor', () => {
    const card = parseCard(lord({ kind: 'anyCreatureHasCounter', counter: 'gloom' }));
    expect(renderOracleText(card)).toContain(
      'As long as any creature has a gloom counter, creatures you control get +1/+1.',
    );
  });

  it("prints a graveyard threshold in Jace's Phantasm's own words", () => {
    const card = parseCard(lord({ kind: 'opponentGraveyardAtLeast', atLeast: 10 }));
    expect(renderOracleText(card)).toContain(
      'As long as an opponent has ten or more cards in their graveyard, creatures you control get +1/+1.',
    );
  });

  it("prints a life threshold in Serra Ascendant's own words, in digits", () => {
    // `numberWord` spells up to ten and prints digits beyond it, which is Magic
    // style and is what the printed card says: "30 or more life", not "thirty".
    const card = parseCard(lord({ kind: 'lifeAtLeast', atLeast: 30 }));
    expect(renderOracleText(card)).toContain(
      'As long as you have 30 or more life, creatures you control get +1/+1.',
    );
  });

  it("prints the turn-scoped damage clause in Bloodcrazed Goblin's own words", () => {
    const card = parseCard(lord({ kind: 'noOpponentDealtDamageThisTurn' }));
    expect(renderOracleText(card)).toContain(
      'As long as no opponent has been dealt damage this turn, creatures you control get +1/+1.',
    );
  });

  it('refuses a life threshold above the highest number a card of this shape prints', () => {
    // `LIMITS.lifeThreshold` tops out at Test of Endurance's 50; the shared
    // `conditionThreshold` would have refused Serra Ascendant's own 30, which
    // is why the two are separate entries.
    expect(validateCards([parseCard(lord({ kind: 'lifeAtLeast', atLeast: 30 }))])).toEqual([]);
    const tooHigh = safeParseCard(lord({ kind: 'lifeAtLeast', atLeast: 51 }));
    expect(tooHigh.ok).toBe(false);
    expect(tooHigh.ok ? [] : tooHigh.violations).toEqual([
      {
        code: 'CONDITION_THRESHOLD_OUT_OF_RANGE',
        path: 'abilities[0].enabledWhile.atLeast',
        message: 'life threshold must be between 1 and 50, got 51',
      },
    ]);
  });
});
