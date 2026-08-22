/**
 * Modal spells (CR 700.2): a card whose `modes` field carries several
 * mutually exclusive effect lists in place of a fixed `effects` list.
 *
 * This bead's acceptance criterion is expressibility and validation, not
 * resolution: "which mode did the player pick" is `mtg-bc2.152.4`'s
 * mechanism, threaded through casting and the stack after this lane merges.
 * So every assertion below is about the schema and the structural checker —
 * a mode parses, is checked with the same rigor as a flat effect list, is
 * refused in the wrong places, and cannot nest a second level deep.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect } from '../src/index';
import { CardEffectSchema, MAX_MODES, MIN_MODES, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(fields: {
  readonly effects?: readonly Effect[];
  readonly modes?: readonly { effects: readonly Effect[] }[];
}): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-fork-in-the-road',
    name: 'Fork in the Road',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: fields.effects ?? [],
    ...(fields.modes !== undefined ? { modes: fields.modes } : {}),
  } as unknown as CardInput;
}

function creatureWithModes(modes: readonly { effects: readonly Effect[] }[]): CardInput {
  return {
    kind: 'creature',
    id: 'tst-modal-beast',
    name: 'Modal Beast',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: ['Beast'],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [],
    modes,
    power: 2,
    toughness: 2,
  } as unknown as CardInput;
}

const BOLT: Effect = { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } };
const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } };

describe('a modal spell', () => {
  it('expresses distinct effects per mode and validates clean', () => {
    const card = parseCard(sorceryInput({ modes: [{ effects: [BOLT] }, { effects: [DRAW] }] }));
    expect(validateCard(card)).toEqual([]);
    expect(card.modes).toHaveLength(2);
    expect(card.modes?.[0]?.effects).toEqual([BOLT]);
    expect(card.modes?.[1]?.effects).toEqual([DRAW]);
  });

  it('bounds recursion at depth one: a mode draws from the vocabulary that has no modal primitive', () => {
    const kinds = CardEffectSchema.options.map((option) => option.shape.kind.value);
    expect(kinds).not.toContain('modal');
  });

  it(`accepts exactly ${String(MIN_MODES)} modes, the CR 700.2 floor`, () => {
    const card = parseCard(sorceryInput({ modes: [{ effects: [BOLT] }, { effects: [DRAW] }] }));
    expect(card.modes).toHaveLength(MIN_MODES);
  });

  it('rejects one mode below the floor at the schema level', () => {
    const input = sorceryInput({ modes: [{ effects: [BOLT] }] });
    expect(() => parseCard(input)).toThrow();
  });

  it(`accepts exactly ${String(MAX_MODES)} modes, the measured ceiling`, () => {
    const modes = Array.from({ length: MAX_MODES }, () => ({ effects: [BOLT] }));
    const card = parseCard(sorceryInput({ modes }));
    expect(card.modes).toHaveLength(MAX_MODES);
  });

  it('rejects one mode past the ceiling at the schema level', () => {
    const modes = Array.from({ length: MAX_MODES + 1 }, () => ({ effects: [BOLT] }));
    expect(() => parseCard(sorceryInput({ modes }))).toThrow();
  });

  it('rejects a mode with no effects at the schema level', () => {
    const input = sorceryInput({ modes: [{ effects: [] }, { effects: [DRAW] }] });
    expect(() => parseCard(input)).toThrow();
  });
});

describe('where modes may legally appear', () => {
  it('is refused on a permanent, the same way a flat effect list is', () => {
    const violations = validateCard(creatureWithModes([{ effects: [BOLT] }, { effects: [DRAW] }]));
    expect(violations.map((found) => found.code)).toContain('MODES_ILLEGAL_ON_CARD_TYPE');
  });

  it('cannot sit beside a populated flat effect list on the same spell', () => {
    const violations = validateCard(
      sorceryInput({ effects: [BOLT], modes: [{ effects: [BOLT] }, { effects: [DRAW] }] }),
    );
    expect(violations.map((found) => found.code)).toContain('EFFECTS_AND_MODES_BOTH_PRESENT');
  });

  it('satisfies the "spell must print something" rule on its own, without a flat effects list', () => {
    const violations = validateCard(sorceryInput({ modes: [{ effects: [BOLT] }, { effects: [DRAW] }] }));
    expect(violations.map((found) => found.code)).not.toContain('SPELL_WITHOUT_EFFECT');
  });

  it('still refuses a spell with neither an effect list nor modes', () => {
    const violations = validateCard(sorceryInput({}));
    expect(violations.map((found) => found.code)).toContain('SPELL_WITHOUT_EFFECT');
  });
});

describe('a mode gets the same structural rigor as a flat effect list', () => {
  it('flags an out-of-range param inside a mode, at the nested path', () => {
    const violations = validateCard(
      sorceryInput({
        modes: [
          { effects: [{ kind: 'dealDamage', amount: 40, target: { kind: 'targetCreature' } }] },
          { effects: [DRAW] },
        ],
      }),
    );
    const found = violations.find((v) => v.code === 'EFFECT_PARAM_OUT_OF_RANGE');
    expect(found?.path).toBe('modes[0].effects[0].amount');
  });

  it('flags a duplicate effect within one mode', () => {
    const violations = validateCard(
      sorceryInput({
        modes: [{ effects: [BOLT, BOLT] }, { effects: [DRAW] }],
      }),
    );
    expect(violations.map((found) => found.code)).toContain('DUPLICATE_EFFECT');
  });

  it('does not compare effects across different modes as duplicates of each other', () => {
    // Both modes deal the identical 3 damage to a creature; that is the point
    // of "choose one" and must not be flagged the way a repeated effect
    // inside one mode is.
    const violations = validateCard(sorceryInput({ modes: [{ effects: [BOLT] }, { effects: [BOLT] }] }));
    expect(violations.map((found) => found.code)).not.toContain('DUPLICATE_EFFECT');
  });
});
