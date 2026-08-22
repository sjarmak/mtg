/**
 * A keyword narrowing is refused by name, the way a conjunctive card type is.
 *
 * `conjunctive-card-type.test.ts` is the same argument one field over, and the
 * two files exist separately because the refusal is per-field on purpose:
 * `mtg-nhyv.62` gave the DSL `TargetFilter.keywords`, so "each creature with
 * flying" is now a sentence the kernel runs, and Forge plausibly spells it
 * `Creature.withFlying`. Plausibly is the whole problem — every row in
 * `vocabulary-map.ts` is read off `res/cardsfolder`, which this checkout does
 * not carry, and an oracle that invents a selector reports a mismatch as
 * agreement.
 *
 * What this file adds beyond the conjunction's is the *message*. One refusal
 * message covering both fields, which is what the exporter had, told an author
 * to rewrite a card type on a card that carried none. Silklash Spider names no
 * conjunction at all.
 */
import { describe, expect, it } from 'vitest';
import type { Effect, EffectInput, TargetFilter } from '@mtg/dsl';
import { forgeFilteredTargets, transpileEffect, unmappedFilterField } from '@mtg/forge-export';

const FLYERS: TargetFilter = { cardTypes: ['creature'], keywords: ['flying'] };

const NO_SELECTOR =
  'a keyword narrowing ("keywords") has no Forge selector attested in res/cardsfolder, and this exporter does not guess one';

function transpiled(effect: EffectInput): ReturnType<typeof transpileEffect> {
  return transpileEffect(effect as Effect, 'tst-silklash', 'abilities[0].effects[0]');
}

describe('a keyword narrowing reaching the exporter', () => {
  /**
   * The field, not a boolean. The two unmapped fields have different fixes — one
   * wants a conjunction selector, the other a keyword selector — so the function
   * that spots them says which, and the reason table is keyed by the answer.
   */
  it('is named by unmappedFilterField, and a bare card type is not', () => {
    expect(unmappedFilterField(FLYERS)).toBe('keywords');
    expect(unmappedFilterField({ cardTypes: ['creature'] })).toBeNull();
    expect(forgeFilteredTargets('Permanent', FLYERS, 'base')).toBeNull();
  });

  /**
   * Silklash Spider's sweep at the only site the validator lets a keyword
   * reach, with a literal amount in place of its X. The announced X is refused
   * here for a reason of its own, so a fixture carrying both would prove only
   * that something was refused; the keyword has to be the sole cause for the
   * message to be evidence. The path matters as much as the reason: an author
   * reading "keywords" on `scopeFilter` knows which clause to look at.
   */
  it('refuses the sweep, names the scopeFilter, and blames the keyword', () => {
    const result = transpiled({
      kind: 'dealDamage',
      amount: 2,
      scope: 'allPermanents',
      scopeFilter: FLYERS,
      target: { kind: 'noTarget' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((found) => found.message)).toEqual([NO_SELECTOR]);
    expect(result.rejections[0]?.path).toBe('abilities[0].effects[0].scopeFilter');
  });

  /**
   * The control, and it is the same control the conjunction file uses: the same
   * sweep with the keyword taken out exports, so the refusal is about the field
   * rather than about sweeps having a filter at all.
   */
  it('exports the same sweep once the keyword is gone', () => {
    const result = transpiled({
      kind: 'dealDamage',
      amount: 2,
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    });
    expect(result.ok).toBe(true);
  });
});
