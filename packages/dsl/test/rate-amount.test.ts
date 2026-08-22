/**
 * A one-shot stat change charged per permanent: Mutilate's "All creatures get
 * -1/-1 until end of turn for each Swamp you control" (M13 102, `mtg-nhyv.16`).
 *
 * ## What was actually missing
 *
 * Less than the bead claimed, and the difference is worth writing down. The
 * pump's two magnitudes already took a whole `Amount`, `landsWithSubtype`
 * already counted Swamps, and the kernel already evaluated the magnitude once
 * at resolution and froze it into an `endOfTurn` layer-7c effect — so the CR
 * 609.2 clock the bead says the vocabulary lacked was already the only clock a
 * pump had. Two things were missing. The first is the signed per-unit number:
 * every board tally counts permanents and no count is negative, so "-1 per
 * Swamp" had nothing to carry the minus. The second is the sentence, because
 * the letter convention prints "gets +X/+X … where X is the number of Swamps
 * you control", which is a card that gets one point of power per Swamp rather
 * than one point on each half per Swamp.
 *
 * ## Why the rate is not `statBonusPer`
 *
 * Same two fields, different clock, and the clock is what the card is.
 * `statBonusPer` is a CR 613.4c static: the layer walk multiplies it out again
 * every pass, so its subject shrinks the moment a counted permanent leaves.
 * This one is fixed as the spell resolves and never moves again. The kernel
 * half of that assertion lives in `@mtg/kernel`'s `rate-amount.test.ts`, which
 * removes the Swamps afterwards and watches the creatures stay small.
 *
 * ## Where it may be printed
 *
 * One slot, by schema rather than by validator: `CardEffectSchema`'s pump
 * magnitudes. The two outer unions refuse it rather than stripping it, which is
 * the one way this differs from the keyword rider — a rider is an extra key and
 * zod drops those, while a rate is a *value* in a field both of those unions
 * declare as a numeral.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, PermanentTally, RatePer } from '@mtg/dsl';
import {
  CardEffectSchema,
  EffectSchema,
  ModelEffectSchema,
  PumpAmountSchema,
  RatePerSchema,
  isRateAmount,
  renderEffect,
  renderOracleText,
  safeParseCard,
} from '@mtg/dsl';
import { parseCard } from '../src/parse';

const SWAMPS: PermanentTally = { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' };

function perSwamp(rate: number): RatePer {
  return { kind: 'ratePer', rate, each: SWAMPS };
}

/** Mutilate (M13 102): `{2}{B}{B}` sorcery, -1/-1 to everything per Swamp. */
function mutilateInput(): CardInput {
  return {
    kind: 'sorcery',
    id: 'ref-mutilate',
    name: 'Mutilate',
    rarity: 'rare',
    set: { code: 'REF', collectorNumber: 102 },
    manaCost: { generic: 2, B: 2 },
    colors: ['B'],
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: perSwamp(-1),
        toughness: perSwamp(-1),
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  } as CardInput;
}

/** The same card with one field replaced, so each refusal below is one edit. */
function mutilateWith(power: unknown, toughness: unknown): unknown {
  return {
    ...mutilateInput(),
    id: 'ref-mutilate-variant',
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power,
        toughness,
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  };
}

function messagesOf(input: unknown): string {
  const result = safeParseCard(input);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.violations.map((found) => found.message).join(' ');
}

function codesOf(input: unknown): readonly string[] {
  const result = safeParseCard(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.violations.map((found) => found.code);
}

describe('the rate a one-shot stat change may carry', () => {
  it('parses as its own record, with the tally as its multiplicand', () => {
    const parsed = RatePerSchema.parse(perSwamp(-1));
    expect(parsed).toEqual({ kind: 'ratePer', rate: -1, each: SWAMPS });
    expect(PumpAmountSchema.parse(perSwamp(-1))).toEqual(parsed);
    expect(isRateAmount(parsed)).toBe(true);
  });

  it('leaves every other amount answering false, since no other union carries one', () => {
    expect(isRateAmount(3)).toBe(false);
    expect(isRateAmount({ kind: 'countMatching', filter: { cardTypes: ['creature'] } })).toBe(false);
  });

  it("is on a card's union and off both the priced one and the model's", () => {
    const effect = {
      kind: 'pumpUntilEndOfTurn',
      power: perSwamp(-1),
      toughness: perSwamp(-1),
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    };
    const authored = CardEffectSchema.parse(effect);
    expect(authored.kind === 'pumpUntilEndOfTurn' && isRateAmount(authored.power)).toBe(true);
    // Refusal, not the keyword rider's silent strip: `power` is a field both of
    // these unions declare, so a value they do not admit fails the union rather
    // than falling off it. A recorded generation fixture is keyed by the JSON
    // Schema of `ModelEffectSchema`, and this is the assertion that says the
    // model's schema did not move.
    expect(EffectSchema.safeParse(effect).success).toBe(false);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });
});

describe('the sentence a rate prints', () => {
  it('prints Mutilate, count named once at the end for the whole stat line', () => {
    expect(renderOracleText(parseCard(mutilateInput()))).toBe(
      'All creatures get -1/-1 until end of turn for each Swamp you control.',
    );
  });

  it('conjugates for a single target and keeps the rate as the printed numerals', () => {
    expect(
      renderEffect(
        {
          kind: 'pumpUntilEndOfTurn',
          power: perSwamp(2),
          toughness: { kind: 'ratePer', rate: 0, each: SWAMPS },
          target: { kind: 'targetCreature' },
        },
        'Marsh Might',
      ),
    ).toBe('Target creature gets +2/+0 until end of turn for each Swamp you control.');
  });

  it('gives the zero half the sign of the rate beside it, as a printed pair does', () => {
    expect(
      renderEffect(
        {
          kind: 'pumpUntilEndOfTurn',
          power: perSwamp(-2),
          toughness: { kind: 'ratePer', rate: 0, each: SWAMPS },
          target: { kind: 'targetCreature' },
        },
        'Marsh Wither',
      ),
    ).toBe('Target creature gets -2/-0 until end of turn for each Swamp you control.');
  });

  it('keeps the rider inside the one sentence, ahead of the duration and the count', () => {
    expect(
      renderEffect(
        {
          kind: 'pumpUntilEndOfTurn',
          power: perSwamp(1),
          toughness: perSwamp(1),
          keyword: 'trample',
          target: { kind: 'targetCreature' },
        },
        'Swampwalk Surge',
      ),
    ).toBe('Target creature gets +1/+1 and gains trample until end of turn for each Swamp you control.');
  });
});

describe('the shapes a rate may not be written in', () => {
  it('refuses a rate beside a numeral, which the printed frame has no room for', () => {
    const input = mutilateWith(perSwamp(-1), -1);
    expect(codesOf(input)).toContain('PUMP_RATE_INVALID');
    expect(messagesOf(input)).toContain('both halves of the pump must be rates or neither may be');
  });

  it('refuses two rates charged against two different tallies', () => {
    const input = mutilateWith(perSwamp(-1), {
      kind: 'ratePer',
      rate: -1,
      each: { kind: 'countMatching', filter: { cardTypes: ['creature'] } },
    });
    expect(codesOf(input)).toContain('PUMP_RATE_INVALID');
    expect(messagesOf(input)).toContain('charged against the same tally');
  });

  it('refuses a rate the range table would refuse as a numeral', () => {
    const input = mutilateWith(perSwamp(-9), perSwamp(-9));
    expect(codesOf(input)).toContain('EFFECT_PARAM_OUT_OF_RANGE');
    expect(messagesOf(input)).toContain('power delta rate must be between -8 and 8');
  });

  it('refuses a rate of zero on both halves, which is the no-op with extra words on it', () => {
    const input = mutilateWith(perSwamp(0), perSwamp(0));
    expect(messagesOf(input)).toContain('a +0/+0 pump is a no-op');
  });
});
