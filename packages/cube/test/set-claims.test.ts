/**
 * A whole generated set measured against what its format claims, with and
 * without the one judgment a model owns.
 *
 * The second block is the acceptance criterion this exists for: CI has no key,
 * so the untagged run has to reach a verdict and say which half is missing. The
 * failure it guards against is not an error — it is an archetype reported at
 * zero playable cards, which is a true statement about an absent model and a
 * false one about the set.
 */
import { describe, expect, it } from 'vitest';
import { measureAvailability } from '../src/availability';
import type { CubeCriteriaInput } from '../src/criteria';
import { claimsForSet, UNTAGGED_REASON } from '../src/set-claims';
import {
  DRAFTABLE_CRITERIA_INPUT,
  DRAFTABLE_SET,
  draftableCriteria,
  draftableEntries,
  draftablePool,
} from './support/draftable-cube';

/** Every card in the set, tagged by color the way the model's answer arrives. */
function taggingByColor(): ReadonlyMap<string, readonly string[]> {
  return new Map(
    DRAFTABLE_SET.cards.map((card) => {
      const identity = card.kind === 'land' ? card.producesMana : card.colors;
      const serves: string[] = [];
      if (identity.includes('W') || identity.includes('U')) serves.push('azorius control', 'azorius tempo');
      if (identity.includes('G')) serves.push('mono-green stompy');
      return [card.id, serves] as const;
    }),
  );
}

const STATED: CubeCriteriaInput = DRAFTABLE_CRITERIA_INPUT;

describe("a generated set against its format's stated capabilities", () => {
  it('measures every card in the set, because a format claims about the set that exists', () => {
    const { validation, tagged } = claimsForSet({
      set: DRAFTABLE_SET,
      stated: STATED,
      tagging: taggingByColor(),
    });

    expect(tagged).toBe(true);
    expect(validation.measurement.size).toBe(DRAFTABLE_SET.cards.length);
  });

  it('reports the archetypes the tagging supports and misses the one it does not', () => {
    const { claims } = claimsForSet({ set: DRAFTABLE_SET, stated: STATED, tagging: taggingByColor() });

    const support = claims.claims.filter((claim) => claim.capability === 'archetype-support');
    expect(support.map((claim) => claim.subject)).toEqual([
      'azorius control',
      'azorius tempo',
      'mono-green stompy',
    ]);
    expect(
      support.filter((claim) => claim.subject.startsWith('azorius')).every((claim) => claim.status === 'met'),
    ).toBe(true);
    const green = support.find((claim) => claim.subject === 'mono-green stompy');
    expect(green?.measured, 'the thin color was not counted').toBe(8);
    expect(green?.status).toBe('met');
  });
});

describe('a run with no model key', () => {
  it('reaches a verdict and names the half that is missing', () => {
    // A pod the set can actually fill, so the only thing left that could fail
    // the format is the archetype half — which is the thing being tested.
    const stated: CubeCriteriaInput = { ...STATED, seats: 2, cardsPerSeat: 20 };
    const { claims, tagged } = claimsForSet({ set: DRAFTABLE_SET, stated });

    expect(tagged).toBe(false);
    const archetypes = claims.claims.filter((claim) => claim.capability === 'archetype-support');
    expect(archetypes).toHaveLength(3);
    for (const claim of archetypes) {
      expect(claim.status, 'an untagged archetype was measured at zero rather than left unmeasured').toBe(
        'unmeasured',
      );
      expect(claim.measured).toBeNull();
      expect(claim.detail).toBe(UNTAGGED_REASON);
    }
    expect(claims.ok, 'the absent model failed the format').toBe(true);
  });

  it('still measures every capability that needs no judgment', () => {
    const { claims } = claimsForSet({ set: DRAFTABLE_SET, stated: STATED });

    const mechanical = claims.claims.filter((claim) => claim.status !== 'unmeasured');
    expect(mechanical.map((claim) => claim.capability)).toEqual(['size', 'draft-capacity']);
    expect(mechanical.every((claim) => claim.measured !== null)).toBe(true);
  });

  it('shows a difference against a defaulted dial without failing the format on it', () => {
    const stated: CubeCriteriaInput = { ...STATED, seats: 2, cardsPerSeat: 20 };
    const { claims } = claimsForSet({ set: DRAFTABLE_SET, stated });

    // The fixture is deep in white and blue and thin in green, so the schema's
    // default color tolerance has plenty to report. Nobody stated a tolerance.
    expect(claims.reported.map((finding) => finding.code)).toContain('color-balance');
    expect(claims.claims.map((claim) => claim.capability)).not.toContain('color-balance');
    expect(claims.unclaimed, 'a defaulted dial was treated as a construction fault').toEqual([]);
    expect(claims.ok, 'a number nobody chose failed the format').toBe(true);
  });

  it('lets no untagged archetype finding leak into the unclaimed list', () => {
    const { claims } = claimsForSet({ set: DRAFTABLE_SET, stated: STATED });

    expect(claims.unclaimed.map((finding) => finding.code)).not.toContain('archetype-support');
    expect(claims.unclaimed.map((finding) => finding.code)).not.toContain('archetype-color');
  });
});

describe('the drafted half, drafted for real', () => {
  const criteria = draftableCriteria();
  const availability = measureAvailability(draftableEntries(), criteria, draftablePool().draftable, {
    drafts: 2,
    seed: 'cube/set-claims/test',
  });

  it('carries the seed and the sample every share is out of', () => {
    const stated: CubeCriteriaInput = {
      ...STATED,
      archetypes: (STATED.archetypes ?? []).map((archetype) => ({ ...archetype, minAvailability: 0.5 })),
    };
    const { claims } = claimsForSet({
      set: DRAFTABLE_SET,
      stated,
      tagging: taggingByColor(),
      availability,
    });

    expect(availability.kind).toBe('measured');
    expect(claims.draftProvenance?.seed).toBe('cube/set-claims/test');
    expect(claims.draftProvenance?.drafts).toBe(2);
    expect(claims.draftProvenance?.seatDrafts).toBe(2 * criteria.seats);
    expect(claims.limits.kind).toBe('shares-measured');
    expect(claims.claims.filter((claim) => claim.capability === 'archetype-availability')).toHaveLength(3);
  });

  it('reports the shares as unmeasured when the format stated no minimum', () => {
    const { claims } = claimsForSet({
      set: DRAFTABLE_SET,
      stated: STATED,
      tagging: taggingByColor(),
      availability,
    });

    expect(claims.claims.map((claim) => claim.capability)).not.toContain('archetype-availability');
    expect(claims.limits.kind, 'the limits stopped being shown once nothing was failed on them').toBe(
      'shares-measured',
    );
  });
});
