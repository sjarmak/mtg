/**
 * `Condition`: the predicate a CR 611.2c conditional continuous effect asks.
 *
 * `condition.ts` argues the shape; these tests are the three claims that
 * matter for a value that has to survive a worker boundary and drive a
 * kernel evaluator it never imports: it parses representative members of the
 * vocabulary, round-trips through the serialization boundary the design docblock
 * promises, and it carries no function anywhere in its shape.
 */
import { describe, expect, it } from 'vitest';
import {
  AnyCreatureHasCounterConditionSchema,
  ConditionSchema,
  ControllerLifeAtLeastConditionSchema,
  ControllerLifeBelowConditionSchema,
  ControlsSubtypeConditionSchema,
  OpponentGraveyardAtLeastConditionSchema,
  renderOracleText,
} from '../src/index';
import type { CardInput, Condition } from '../src/index';
import { parseCard } from '../src/parse';

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

describe('ControllerLifeAtLeastConditionSchema', () => {
  it('parses a live controller-life floor', () => {
    const parsed = ControllerLifeAtLeastConditionSchema.parse({
      kind: 'controllerLifeAtLeast',
      atLeast: 30,
    });
    expect(parsed).toEqual({ kind: 'controllerLifeAtLeast', atLeast: 30 });
  });

  it('refuses a floor of zero, which is unconditional rather than conditional', () => {
    expect(
      ControllerLifeAtLeastConditionSchema.safeParse({ kind: 'controllerLifeAtLeast', atLeast: 0 }).success,
    ).toBe(false);
  });

  it('does not impose an arbitrary ceiling on Magic life totals', () => {
    expect(
      ControllerLifeAtLeastConditionSchema.safeParse({
        kind: 'controllerLifeAtLeast',
        atLeast: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true);
  });
});

describe('ControllerLifeBelowConditionSchema', () => {
  it('parses a live controller-life ceiling', () => {
    const parsed = ControllerLifeBelowConditionSchema.parse({
      kind: 'controllerLifeBelow',
      fewerThan: 7,
    });
    expect(parsed).toEqual({ kind: 'controllerLifeBelow', fewerThan: 7 });
  });

  it('refuses a ceiling of zero, which can never be satisfied', () => {
    expect(
      ControllerLifeBelowConditionSchema.safeParse({ kind: 'controllerLifeBelow', fewerThan: 0 }).success,
    ).toBe(false);
  });
});

describe('ConditionSchema', () => {
  it('discriminates on kind, so an unrecognized member is rejected rather than coerced', () => {
    expect(ConditionSchema.safeParse({ kind: 'inGraveyard', subtype: 'Merfolk' }).success).toBe(false);
  });

  it('has exactly the eleven members this schema has shipped, in declaration order', () => {
    expect(ConditionSchema.options.map((option) => [...option.shape.kind.values])).toEqual([
      ['controlsSubtype'],
      ['anyCreatureHasCounter'],
      ['opponentGraveyardAtLeast'],
      ['opponentUndamagedThisTurn'],
      ['controllerLifeAtLeast'],
      ['controllerLifeBelow'],
      ['controllerLibraryAtLeast'],
      ['controllerTopLibraryHasColor'],
      ['battlefieldCountBelow'],
      ['controlsNoneOfSubtypes'],
      ['selfCounterCountBelow'],
      ['selfCounterCountAtLeast'],
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
});
