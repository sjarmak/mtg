/**
 * Condemn's linked object value: the second sentence reads the toughness of the
 * creature the first sentence targeted, after that creature has left the
 * battlefield. The target filter and controller back-reference already exist;
 * this file pins the missing amount and its one unambiguous earlier chooser.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Card, CardInput } from '../src/index';
import { AmountSchema, canonicalJson, ModelEffectSchema, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

function instantInput(effects: readonly unknown[]): CardInput {
  return {
    kind: 'instant',
    id: 'm11-011',
    name: 'Condemn',
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 11 },
    manaCost: { W: 1 },
    colors: ['W'],
    effects: [...effects],
  } as unknown as CardInput;
}

const CONDEMN_EFFECTS = [
  {
    kind: 'putOnLibrary',
    position: 'bottom',
    target: { kind: 'targetCreature', filter: { combat: 'attacking' } },
  },
  {
    kind: 'gainLife',
    amount: { kind: 'thatCreatureToughness' },
    target: { kind: 'thatCreaturesController' },
  },
] as const;

describe('the exact Condemn sentence', () => {
  it('parses, validates, and renders the linked target and amount', () => {
    const card = parseCard(instantInput(CONDEMN_EFFECTS));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness.",
    );
  });

  it('admits the retained amount only to the engine-facing schema', () => {
    expect(AmountSchema.parse({ kind: 'thatCreatureToughness' })).toEqual({
      kind: 'thatCreatureToughness',
    });
    expect(canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }))).not.toContain(
      'thatCreatureToughness',
    );
  });
});

describe('a linked toughness with no single creature behind it', () => {
  it('refuses a first-clause use with an actionable amount path', () => {
    const card = instantInput([
      {
        kind: 'gainLife',
        amount: { kind: 'thatCreatureToughness' },
        target: { kind: 'noTarget' },
      },
    ]) as unknown as Card;
    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'effects[0].amount.kind',
        message: expect.stringContaining('no effect before this one chooses a creature'),
      }),
    );
  });

  it('refuses two earlier creature choices rather than guessing the nearest', () => {
    const card = instantInput([
      { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
      { kind: 'untapPermanent', target: { kind: 'targetCreature' } },
      {
        kind: 'gainLife',
        amount: { kind: 'thatCreatureToughness' },
        target: { kind: 'noTarget' },
      },
    ]) as unknown as Card;
    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'effects[2].amount.kind',
        message: expect.stringContaining('2 earlier effects'),
      }),
    );
  });
});
