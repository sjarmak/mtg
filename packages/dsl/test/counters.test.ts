/**
 * Counter kinds as data: one declaration per kind, and a DSL effect that places
 * one.
 *
 * The claim this file exists to hold is `mtg-bc2.132.8`'s: adding a part to The
 * flagship set is adding an entry to `COUNTER_DECLARATIONS` and nothing else.
 * Every assertion below is written against the table rather than against a list
 * of kinds repeated here, so a kind added tomorrow is covered by the same
 * sentences.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '../src/index';
import {
  COUNTER_DECLARATIONS,
  COUNTER_KINDS,
  counterGrantedKeywords,
  CounterKindSchema,
  counterReminderText,
  counterStatBonus,
  EFFECT_KINDS,
  LEGAL_TARGETS,
  renderOracleText,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const SET_CODE = 'TST';

function sorceryWith(effects: readonly Effect[]): Card {
  return parseCard(sorceryInput(effects) as CardInput);
}

/**
 * The same card without the parse, for the two cases whose whole point is that
 * the structural validator rejects them: `parseCard` throws on a violation, so
 * asserting the code needs the record handed straight to `validateCard`.
 */
function unparsedSorceryWith(effects: readonly Effect[]): Card {
  return sorceryInput(effects) as unknown as Card;
}

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'tst-graft',
    name: 'Test Graft',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 1 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

describe('the counter-kind table', () => {
  it('declares every kind exactly once, and derives the tuple and schema from it', () => {
    expect(COUNTER_KINDS).toEqual(Object.keys(COUNTER_DECLARATIONS));
    expect(new Set(COUNTER_KINDS).size).toBe(COUNTER_KINDS.length);
    for (const kind of COUNTER_KINDS) {
      expect(CounterKindSchema.parse(kind)).toBe(kind);
      expect(COUNTER_DECLARATIONS[kind].printName.length).toBeGreaterThan(0);
    }
    expect(CounterKindSchema.safeParse('wyrmheadHorn').success).toBe(false);
  });

  /**
   * `saberHorn` was `horn`'s name before `mtg-bs1`/`mtg-18a` renamed it. A set
   * generated against the old name (`out/XMP/set.json`, mtg-gofm) still has it
   * on disk, so the schema accepts the retired name and normalizes it to the
   * one this table declares, rather than rejecting a file nothing regenerates.
   */
  it('parses a retired counter-kind name as its current one', () => {
    expect(CounterKindSchema.parse('saberHorn')).toBe('horn');
  });

  /**
   * The no-regression pin. Before the table, layer 7d read
   * `plusOnePlusOne - minusOneMinusOne` off two hardcoded fields; these two
   * declarations are what make that subtraction fall out of the data, and a
   * table that quietly said something else would change every game in the
   * suite without any test naming the number.
   */
  it('says what the two stock kinds have always meant', () => {
    expect(counterStatBonus('plusOnePlusOne')).toEqual({ power: 1, toughness: 1 });
    expect(counterStatBonus('minusOneMinusOne')).toEqual({ power: -1, toughness: -1 });
    expect(counterGrantedKeywords('plusOnePlusOne')).toEqual([]);
    expect(counterGrantedKeywords('minusOneMinusOne')).toEqual([]);
  });

  it('carries a part whose one entry reaches both a stat and a keyword', () => {
    expect(counterStatBonus('horn')).toEqual({ power: 1, toughness: 1 });
    expect(counterGrantedKeywords('horn')).toEqual(['firstStrike']);
  });

  /**
   * Acceptance 5, stated as a property of the source rather than of a run: the
   * layer walk may not name a characteristic-modifying counter kind, because a
   * kind it named would be a kind the next part has to be added beside. Loyalty
   * is deliberately a marker counter: planeswalker rules inspect its count,
   * while its empty declaration never modifies characteristics.
   *
   * The match is on the whole identifier rather than the substring. A kind is
   * an identifier, and short ones sit inside ordinary English: `wing` is in
   * `throwing`, and a substring check read the tiered parts as a layer walk
   * that names four of them while the walk had not changed at all.
   */
  it('is the only place a characteristic-modifying kind is named', () => {
    const kernelSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kernel', 'src');
    const characteristicKinds = COUNTER_KINDS.filter(
      (kind) => COUNTER_DECLARATIONS[kind].modifications.length > 0,
    );
    for (const file of ['layers.ts', 'characteristics.ts']) {
      const text = readFileSync(join(kernelSrc, file), 'utf8');
      for (const kind of characteristicKinds) {
        const named = new RegExp(`(?<![A-Za-z])${kind}(?![A-Za-z])`).test(text);
        expect(named, `${file} names ${kind}`).toBe(false);
      }
    }
    expect(COUNTER_DECLARATIONS.loyalty.modifications).toEqual([]);
  });
});

describe('the counter-placing effect', () => {
  it('is a pinned effect kind that validates like every other one', () => {
    expect(EFFECT_KINDS).toContain('putCounters');
    expect(LEGAL_TARGETS.putCounters).toEqual(['targetCreature', 'targetCreatureYouControl']);
    const card = sorceryWith([
      { kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } },
    ]);
    expect(validateCard(card)).toEqual([]);
  });

  it('obeys the same target table a spell effect obeys', () => {
    const card = unparsedSorceryWith([
      { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetPlayer' } },
    ]);
    expect(validateCard(card).map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('holds its count to the vocabulary range', () => {
    const card = unparsedSorceryWith([
      { kind: 'putCounters', counter: 'plusOnePlusOne', count: 9, target: { kind: 'targetCreature' } },
    ]);
    expect(validateCard(card).map((found) => found.code)).toContain('EFFECT_PARAM_OUT_OF_RANGE');
  });

  it('refuses a counter kind outside the table', () => {
    const bad = {
      kind: 'sorcery',
      id: 'tst-bad-graft',
      name: 'Bad Graft',
      rarity: 'common',
      set: { code: SET_CODE, collectorNumber: 2 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      effects: [
        { kind: 'putCounters', counter: 'wyrmheadHorn', count: 1, target: { kind: 'targetCreature' } },
      ],
    };
    expect(() => parseCard(bad as CardInput)).toThrow();
  });
});

describe('a printed card that says what the counter does', () => {
  it('prints the part and its declared effect as reminder text', () => {
    const card = sorceryWith([
      { kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } },
    ]);
    expect(renderOracleText(card)).toBe(
      'Put a horn counter on target creature. (A creature with a horn counter gets +1/+1 and has first strike.)',
    );
  });

  it('leaves a counter whose name is its own stat line without a reminder', () => {
    expect(counterReminderText('plusOnePlusOne')).toBeNull();
    expect(counterReminderText('minusOneMinusOne')).toBeNull();
    const card = sorceryWith([
      { kind: 'putCounters', counter: 'plusOnePlusOne', count: 2, target: { kind: 'targetCreature' } },
    ]);
    expect(renderOracleText(card)).toBe('Put two +1/+1 counters on target creature.');
  });

  it('gives every declared kind a printed sentence, including one added later', () => {
    for (const kind of COUNTER_KINDS) {
      const card = sorceryWith([
        { kind: 'putCounters', counter: kind, count: 1, target: { kind: 'targetCreature' } },
      ]);
      const text = renderOracleText(card);
      expect(text.startsWith('Put ')).toBe(true);
      expect(text).toContain(`${COUNTER_DECLARATIONS[kind].printName} counter`);
    }
  });
});
