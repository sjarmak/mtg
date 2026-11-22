/** Forge keyword selectors pinned from the reference corpus. */
import { describe, expect, it } from 'vitest';
import type { Effect, EffectInput, TargetFilter } from '@mtg/dsl';
import { forgeFilteredTargets, transpileEffect, unmappedFilterField } from '@mtg/forge-export';

const FLYERS: TargetFilter = { cardTypes: ['creature'], keywords: ['flying'] };

function transpiled(effect: EffectInput): ReturnType<typeof transpileEffect> {
  return transpileEffect(effect as Effect, 'tst-silklash', 'abilities[0].effects[0]');
}

describe('a keyword narrowing reaching the exporter', () => {
  /** Keyword filters no longer count as unmapped; conjunctive types still do. */
  it('maps the pinned with-keyword selector and leaves the filter writable', () => {
    expect(unmappedFilterField(FLYERS)).toBeNull();
    expect(unmappedFilterField({ cardTypes: ['creature'] })).toBeNull();
    expect(forgeFilteredTargets('Permanent', FLYERS, 'base')).toEqual(['Creature.withFlying']);
    expect(
      forgeFilteredTargets('Permanent', { cardTypes: ['creature'], excludeKeywords: ['flying'] }, 'base'),
    ).toEqual(['Creature.withoutFlying']);
  });

  /** Silklash Spider's sweep shape, with a literal amount to isolate the selector. */
  it('exports the sweep with the attested keyword selector', () => {
    const result = transpiled({
      kind: 'dealDamage',
      amount: 2,
      scope: 'allPermanents',
      scopeFilter: FLYERS,
      target: { kind: 'noTarget' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ability.params).toContainEqual(['ValidCards', 'Creature.withFlying']);
  });

  /** Control: the unfiltered sweep continues to export. */
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
