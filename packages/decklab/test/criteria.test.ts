/**
 * The land count reaches deck maths only through the thing that decided it.
 *
 * `ResolvedCriteria` used to be a plain structural widening of `DeckCriteria`,
 * so its one-origin guarantee was a doc comment. Any caller — the package's own
 * future self, or anyone importing `@mtg/decklab` — could write
 * `{ ...criteria, landCount: 24 }` and hand it to `assembleDeck`, which is the
 * frozen-constant bug `land-plan.ts` exists to undo, wearing the type that says
 * the bug is gone.
 *
 * A phantom brand closed that spelling and left a wider one open: a brand only
 * polices the field it sits on, so `{ ...built.criteria, size: 100 }` still
 * type-checked and produced criteria whose eighteen-land count was decided for a
 * sixty-card deck (mtg-bc2.93). The type is now a class holding both halves in
 * `#private` fields, which no object literal can satisfy, so every reshaping is
 * refused rather than the two a brand could see.
 *
 * The first four tests are compile-time assertions, so `npm run typecheck` is
 * where they run and `vitest` is not: each `@ts-expect-error` fails the build the
 * moment its expression type-checks again. The rest hold what the class must not
 * cost — a mint that stamps whatever it is handed is only ceremony, and a holder
 * that leaks itself into the deck artifact would hand the browser a key the
 * artifact schema rejects.
 */
import { describe, expect, it } from 'vitest';
import { DeckCriteriaSchema, type ResolvedCriteria } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';

const stated = DeckCriteriaSchema.parse({ prompt: 'aggressive red burn', format: 'modern', size: 60 });

/** What a caller of the package holds: one the mint actually made. */
const held = resolveCriteria(stated, { count: 18, source: 'model', reason: 'burn wants spell density' });

describe('ResolvedCriteria', () => {
  it('cannot be written by hand, whatever the land count claims to be', () => {
    // @ts-expect-error a land count nobody decided cannot pose as a resolved one
    const forged: ResolvedCriteria = { ...stated, landCount: 24 };
    expect(forged.landCount).toBe(24);
  });

  it('cannot be re-minted by spreading one that was', () => {
    // @ts-expect-error the spread copies the values out, leaving the holder behind
    const forged: ResolvedCriteria = { ...held, landCount: 24 };
    expect(forged.landCount).toBe(24);
  });

  it('cannot lend its decided count to criteria nobody decided it for', () => {
    // @ts-expect-error a real count, but this object never went through the mint
    const forged: ResolvedCriteria = { ...stated, landCount: held.landCount };
    expect(forged.landCount).toBe(18);
  });

  it('cannot have any other field changed under it either, which the brand allowed', () => {
    // The mtg-bc2.93 hole: a resized deck is not the deck this count was
    // decided for, and the count is the one thing the deck's maths cannot
    // re-derive.
    // @ts-expect-error a spread of a resolved criteria is a plain object again
    const resized: ResolvedCriteria = { ...held, size: 100 };
    expect(resized.size).toBe(100);
  });

  it('carries the plan count and shows nothing of the holder at runtime', () => {
    const resolved = resolveCriteria(stated, {
      count: 19,
      source: 'model',
      reason: 'burn wants spell density',
    });

    expect(resolved.landCount).toBe(19);
    // The holder is opaque in both directions: it enumerates as nothing, and it
    // serializes as the record it was built from. Anything else and the deck
    // artifact would carry a key the page's schema rejects.
    expect(Reflect.ownKeys(resolved)).toEqual([]);
    expect(JSON.parse(JSON.stringify(resolved))).toEqual({ ...stated, landCount: 19 });
  });
});

describe('resolveCriteria', () => {
  it('accepts the plan the model actually gave for these criteria', () => {
    const resolved = resolveCriteria(stated, { count: 19, source: 'model', reason: 'spell density' });
    expect(resolved.landCount).toBe(19);
  });

  it('accepts a count the player stated, which wins outright', () => {
    const withCount = DeckCriteriaSchema.parse({ prompt: 'x', format: 'modern', size: 60, landCount: 17 });
    const resolved = resolveCriteria(withCount, {
      count: 17,
      source: 'stated',
      reason: 'as the player stated',
    });
    expect(resolved.landCount).toBe(17);
  });

  it('refuses a stated plan the criteria never stated', () => {
    expect(() =>
      resolveCriteria(stated, { count: 24, source: 'stated', reason: 'as the player stated' }),
    ).toThrow(/criteria state no count at all/);
  });

  it('refuses a stated plan that disagrees with the count stated', () => {
    const withCount = DeckCriteriaSchema.parse({ prompt: 'x', format: 'modern', size: 60, landCount: 17 });
    expect(() =>
      resolveCriteria(withCount, { count: 24, source: 'stated', reason: 'as the player stated' }),
    ).toThrow(/criteria state 17/);
  });

  it('refuses a model plan where the player already stated a count', () => {
    const withCount = DeckCriteriaSchema.parse({ prompt: 'x', format: 'modern', size: 60, landCount: 17 });
    expect(() =>
      resolveCriteria(withCount, { count: 24, source: 'model', reason: 'the format runs 24' }),
    ).toThrow(/a stated count wins/);
  });

  it('refuses a model count no model could have answered for this deck', () => {
    // Half a sixty-card deck is the band's ceiling, so 40 is not an answer the
    // schema would have let through — it arrived some other way.
    expect(() => resolveCriteria(stated, { count: 40, source: 'model', reason: 'lands are good' })).toThrow(
      /no model answer for a 60-card deck/,
    );
  });
});
