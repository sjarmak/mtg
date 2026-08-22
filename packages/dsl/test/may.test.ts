/**
 * "You may" spells (CR 601.2c): a card's `may` field asks a yes/no question
 * about its own printed effects, resolved before any of them apply.
 *
 * `modal.test.ts`'s split applies here unchanged and for the same reason:
 * "who is asked, and does the kernel pause for them" is `mtg-bc2.152.4`'s
 * kernel-side mechanism, threaded through resolution after this lane merges
 * (`@mtg/kernel`'s `may-choice.ts`, `stack.ts`). This file is the DSL half —
 * expressibility and the structural checker — so every assertion below is
 * about the schema and `checkEffects`' `MAY_ILLEGAL_ON_CARD_TYPE` /
 * `MAY_AND_MODES_BOTH_PRESENT` guards, not about a game ever answering one.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect, MayChooser } from '../src/index';
import { MayChooserSchema, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(fields: {
  readonly effects?: readonly Effect[];
  readonly modes?: readonly { effects: readonly Effect[] }[];
  readonly may?: MayChooser;
}): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-may-choice',
    name: "Aelune's Mercy",
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: fields.effects ?? [],
    ...(fields.modes !== undefined ? { modes: fields.modes } : {}),
    ...(fields.may !== undefined ? { may: fields.may } : {}),
  } as unknown as CardInput;
}

function creatureWithMay(may: MayChooser): CardInput {
  return {
    kind: 'creature',
    id: 'tst-may-beast',
    name: 'Reluctant Beast',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 2 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: ['Beast'],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [],
    may,
    power: 2,
    toughness: 2,
  } as unknown as CardInput;
}

const DESTROY: Effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } };

describe('a "you may" spell', () => {
  it('parses clean with the controller as chooser', () => {
    const card = parseCard(sorceryInput({ effects: [DESTROY], may: 'you' }));
    expect(validateCard(card)).toEqual([]);
    expect(card.may).toBe('you');
  });

  it('parses clean with the opponent as chooser', () => {
    const card = parseCard(sorceryInput({ effects: [DRAW], may: 'opponent' }));
    expect(validateCard(card)).toEqual([]);
    expect(card.may).toBe('opponent');
  });

  it('accepts only the two printed chooser words', () => {
    expect(() => MayChooserSchema.parse('you')).not.toThrow();
    expect(() => MayChooserSchema.parse('opponent')).not.toThrow();
    expect(() => MayChooserSchema.parse('anyPlayer')).toThrow();
  });

  it('is absent by default on an ordinary spell', () => {
    const card = parseCard(sorceryInput({ effects: [DESTROY] }));
    expect(card.may).toBeUndefined();
  });
});

describe('where "may" may legally appear', () => {
  it('is refused on a permanent, the same way modes is', () => {
    const violations = validateCard(creatureWithMay('you'));
    expect(violations.map((found) => found.code)).toContain('MAY_ILLEGAL_ON_CARD_TYPE');
  });

  it('cannot sit beside a modal spell mode list on the same card', () => {
    const violations = validateCard(
      sorceryInput({ modes: [{ effects: [DESTROY] }, { effects: [DRAW] }], may: 'you' }),
    );
    expect(violations.map((found) => found.code)).toContain('MAY_AND_MODES_BOTH_PRESENT');
  });

  it('is silent on an ordinary spell that gates a fixed effect list', () => {
    const violations = validateCard(sorceryInput({ effects: [DESTROY], may: 'opponent' }));
    expect(violations.map((found) => found.code)).not.toContain('MAY_ILLEGAL_ON_CARD_TYPE');
    expect(violations.map((found) => found.code)).not.toContain('MAY_AND_MODES_BOTH_PRESENT');
  });

  it('still runs the ordinary structural checks on the gated effect list', () => {
    const violations = validateCard(
      sorceryInput({
        effects: [{ kind: 'dealDamage', amount: 40, target: { kind: 'targetCreature' } }],
        may: 'you',
      }),
    );
    const found = violations.find((v) => v.code === 'EFFECT_PARAM_OUT_OF_RANGE');
    expect(found?.path).toBe('effects[0].amount');
  });
});
