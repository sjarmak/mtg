/**
 * `Amount`: a number a card prints, which is not always a number.
 *
 * Three claims are worth assertions, and one of them is the reason the shape is
 * general rather than a special case at one field.
 *
 *  1. **The generator's schema did not move.** The amount is threaded into the
 *     effect factories as a type parameter, exactly as the target spec already
 *     is, so `ModelEffectSchema` passes `z.int()` and its JSON Schema is
 *     byte-identical to what every recorded fixture was keyed against. A narrow
 *     change inside the shared factory would have leaked into the model's
 *     schema and renamed every fixture — which is why the general version is
 *     the *cheap* one. The recorded-run tests are the same claim end to end;
 *     this file states it directly, on the bytes.
 *  2. **Every card written before this parses unchanged**, because a bare
 *     integer is still an `Amount`.
 *  3. **The range table is about literals only.** `LIMITS` guards numerals a
 *     model chose; a computed amount has no numeral, and both ways of
 *     pretending otherwise (refusing it, clamping it) are worse than declining.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Amount, CardInput, CountFilter, Effect } from '../src/index';
import {
  canonicalJson,
  isLiteralAmount,
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  renderOracleText,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const EXILED: Amount = { kind: 'exiledThisResolution' };

function sorceryInput(effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-counted-strike',
    name: 'Counted Strike',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 3, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

function digest(schema: z.ZodType): string {
  return createHash('sha256')
    .update(canonicalJson(z.toJSONSchema(schema, { io: 'output' })))
    .digest('hex');
}

describe('what the generator is shown', () => {
  /**
   * The pinned bytes, so a change that widens the model's numeric slots fails
   * here first — before it fails as a wall of missing fixtures in `@mtg/setgen`
   * under a key nobody can trace back to a numeric field.
   *
   * The equality was measured across the change that introduced `Amount`, not
   * asserted: the schema `@mtg/llm` derives a fixture key from was hashed on the
   * tree before and after and came out identical (4164 bytes,
   * `dea6435f2abd805a2a5df59026259473b1922816b81cda40f5339629a049f266`). This
   * digest is over `z.toJSONSchema` directly rather than through that package,
   * which differs only by the `$schema`/`$id` keys `@mtg/llm` strips, and which
   * keeps this test inside the package it is about.
   */
  it('shows the model the same numeric slots it always showed', () => {
    expect(digest(ModelEffectSchema)).toBe(
      '654b51f0eded32ff5af1d228413125e291976f1abd2d94dfa8064a6d055c391a',
    );
  });

  it('offers no computed amount anywhere in the generatable vocabulary', () => {
    const shown = canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }));
    const withParts = canonicalJson(z.toJSONSchema(PartBearingModelEffectSchema, { io: 'output' }));
    expect(shown).not.toContain('exiledThisResolution');
    expect(withParts).not.toContain('exiledThisResolution');
    // `countMatching` joined the union after this test did; same proof, same
    // reason `putCounters` and `exileTarget` are hand-authored only.
    expect(shown).not.toContain('countMatching');
    expect(withParts).not.toContain('countMatching');
  });
});

describe('an amount that is a number', () => {
  it('parses and prints exactly as it did before the union existed', () => {
    const card = parseCard(
      sorceryInput([{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }]),
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Counted Strike deals 3 damage to target creature.');
    expect(isLiteralAmount(3)).toBe(true);
  });

  it('is still range-checked', () => {
    const card = sorceryInput([
      { kind: 'dealDamage', amount: 40, target: { kind: 'targetCreature' } },
    ]) as unknown as Parameters<typeof validateCard>[0];
    expect(validateCard(card).map((found) => found.code)).toContain('EFFECT_PARAM_OUT_OF_RANGE');
  });
});

describe('an amount that is counted', () => {
  it('parses, and the range table declines to judge it', () => {
    const card = parseCard(
      sorceryInput([{ kind: 'dealDamage', amount: EXILED, target: { kind: 'targetOpponent' } }]),
    );
    expect(validateCard(card)).toEqual([]);
    expect(isLiteralAmount(EXILED)).toBe(false);
  });

  /**
   * The second template, not a substitution: the numeral's slot disappears
   * rather than being filled, which is why every amount-bearing arm of
   * `renderEffect` is written twice.
   */
  it('prints Magic sentence for damage', () => {
    const card = parseCard(
      sorceryInput([{ kind: 'dealDamage', amount: EXILED, target: { kind: 'targetOpponent' } }]),
    );
    expect(renderOracleText(card)).toBe(
      'Counted Strike deals damage to target opponent equal to the number of cards exiled this way.',
    );
  });

  it('prints a second template for every other slot that carries one', () => {
    const sentences = [
      [
        { kind: 'drawCards', count: EXILED, target: { kind: 'noTarget' } },
        'Draw a number of cards equal to the number of cards exiled this way.',
      ],
      [
        { kind: 'gainLife', amount: EXILED, target: { kind: 'noTarget' } },
        'You gain life equal to the number of cards exiled this way.',
      ],
      [
        { kind: 'millCards', count: EXILED, target: { kind: 'noTarget' } },
        'You mill a number of cards equal to the number of cards exiled this way.',
      ],
      [
        { kind: 'putCounters', counter: 'plusOnePlusOne', count: EXILED, target: { kind: 'targetCreature' } },
        'Put a number of +1/+1 counters on target creature equal to the number of cards exiled this way.',
      ],
    ] as const;
    for (const [effect, expected] of sentences) {
      const card = parseCard(sorceryInput([effect as unknown as Effect]));
      expect(validateCard(card), JSON.stringify(effect)).toEqual([]);
      expect(renderOracleText(card)).toBe(expected);
    }
  });

  /**
   * A P/T bonus is the one slot Magic has no "equal to" wording for, so it uses
   * the letter convention. The clause is built from the amounts actually
   * present, which is what keeps it right if the computed union ever grows a
   * second member two deltas could disagree about.
   */
  it('prints the letter convention for a computed P/T bonus', () => {
    const card = parseCard(
      sorceryInput([
        { kind: 'pumpUntilEndOfTurn', power: EXILED, toughness: 0, target: { kind: 'targetCreature' } },
      ] as unknown as readonly Effect[]),
    );
    expect(renderOracleText(card)).toBe(
      'Target creature gets +X/+0 until end of turn, where X is the number of cards exiled this way.',
    );
  });

  /**
   * Two distinct computed kinds in one pump effect, which was structurally
   * impossible while `ComputedAmount` had one member: power and toughness now
   * disagree about what they count, so the letter clause has to name both.
   */
  it('assigns a second letter when power and toughness count different things', () => {
    const zombies: Amount = { kind: 'countMatching', filter: { subtypes: ['Zombie'] } };
    const card = parseCard(
      sorceryInput([
        { kind: 'pumpUntilEndOfTurn', power: EXILED, toughness: zombies, target: { kind: 'targetCreature' } },
      ] as unknown as readonly Effect[]),
    );
    expect(renderOracleText(card)).toBe(
      'Target creature gets +X/+Y until end of turn, where X is the number of cards exiled this way and ' +
        'Y is the number of Zombies you control.',
    );
  });
});

describe('an amount counted off the board', () => {
  function withCount(filter: CountFilter): string {
    const amount: Amount = { kind: 'countMatching', filter };
    const card = parseCard(
      sorceryInput([{ kind: 'dealDamage', amount, target: { kind: 'targetOpponent' } }]),
    );
    expect(validateCard(card)).toEqual([]);
    return renderOracleText(card);
  }

  it('prints "permanents" for a filter with neither constraint', () => {
    expect(withCount({})).toBe(
      'Counted Strike deals damage to target opponent equal to the number of permanents you control.',
    );
  });

  it('prints the pluralized card type for a cardTypes-only filter', () => {
    expect(withCount({ cardTypes: ['creature'] })).toBe(
      'Counted Strike deals damage to target opponent equal to the number of creatures you control.',
    );
  });

  it('joins several card types with "and"', () => {
    expect(withCount({ cardTypes: ['creature', 'artifact'] })).toBe(
      'Counted Strike deals damage to target opponent equal to the number of creatures and artifacts you control.',
    );
  });

  it('prints the pluralized subtype for a subtypes-only filter, dropping the card-type word', () => {
    expect(withCount({ subtypes: ['Zombie'] })).toBe(
      'Counted Strike deals damage to target opponent equal to the number of Zombies you control.',
    );
  });

  it('lets a subtype win over a stated card type, matching how Magic prints it', () => {
    expect(withCount({ cardTypes: ['creature'], subtypes: ['Zombie'] })).toBe(
      'Counted Strike deals damage to target opponent equal to the number of Zombies you control.',
    );
  });
});

describe('a resolution-scoped amount after a pause', () => {
  /**
   * Both amounts that count a span of one resolution read that span off the
   * event log, and a scry or a library search resumes the resolution in a later
   * reduction whose log starts empty. `exiledThisResolution` always survived
   * that because the pre-pause count was banked on the pending record;
   * `damageDealtThisResolution` did not, so validation refused the arrangement
   * by name (`DAMAGE_TALLY_ACROSS_PAUSE`) rather than print a card that
   * undercounts. The bank is a `ResolutionTally` carrying both halves now
   * (`kernel/src/state.ts`), the kernel proves the number survives
   * (`kernel/test/scry.test.ts`), and the rule is gone — which is a claim about
   * this package, so it is asserted here.
   */
  it('validates a damage tally read after a scry, and after a library search', () => {
    for (const pause of [
      { kind: 'scry', count: 2 },
      { kind: 'searchLibrary', filter: { cardTypes: ['land'] }, destination: 'hand' },
    ] as const satisfies readonly Effect[]) {
      const card = parseCard(
        sorceryInput([
          { kind: 'dealDamage', amount: 3, target: { kind: 'targetOpponent' } },
          pause,
          {
            kind: 'dealDamage',
            amount: { kind: 'damageDealtThisResolution' },
            target: { kind: 'targetOpponent' },
          },
        ]),
      );
      expect(validateCard(card), pause.kind).toEqual([]);
    }
  });
});
