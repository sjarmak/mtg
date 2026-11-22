/**
 * Does the format do what it claims — and does it only answer for the claims
 * the designer actually made.
 *
 * The first block is the projection working on a list that meets everything and
 * a list that misses everything, which is the same pair `validate.test.ts` uses
 * and for the same reason: a builder that reported `met` for everything passes
 * one and fails the other. The second block is the rule this module exists for,
 * that a default the schema supplied is not a statement the designer made, and
 * the third is what happens to the drafted half when nothing was drafted.
 */
import { describe, expect, it } from 'vitest';
import type { AvailabilityMeasured } from '../src/availability';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY } from '@mtg/draft-export';
import { formatClaims } from '../src/claims';
import { CubeCriteriaSchema } from '../src/criteria';
import type { CubeCriteriaInput } from '../src/criteria';
import { validateCube } from '../src/validate';
import { FIXTURE_CRITERIA_INPUT, balancedCube, fixtureCriteria, lopsidedCube } from './support/fixture-cube';

const CRITERIA = fixtureCriteria();

function drafted(shares: Readonly<Record<string, number>>): AvailabilityMeasured {
  return {
    kind: 'measured',
    botPolicy: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
    seed: 'test/claims',
    drafts: 2,
    seats: 2,
    packs: 3,
    cardsPerSeat: 25,
    seatDrafts: 4,
    spellsRequired: 23,
    archetypes: Object.entries(shares).map(([name, share]) => ({
      name,
      assembled: Math.round(share * 4),
      share,
      minShare: 0.5,
      castable: 20,
      dealtCastable: 25,
    })),
  };
}

describe('a format measured against what it claims', () => {
  it('reports every stated capability met on a list that meets them', () => {
    const claims = formatClaims(FIXTURE_CRITERIA_INPUT, CRITERIA, validateCube(balancedCube(), CRITERIA));

    expect(claims.ok, 'the balanced cube was reported as missing something').toBe(true);
    expect(claims.claims.every((claim) => claim.status === 'met')).toBe(true);
    expect(claims.unclaimed, 'a finding landed outside every claim').toEqual([]);
    expect(claims.claims.map((claim) => `${claim.capability}:${claim.subject}`)).toEqual([
      'size:',
      'draft-capacity:',
      'curve-band:MV 0-2',
      'curve-band:MV 3+',
      'archetype-support:azorius control',
      'archetype-support:rakdos aggro',
      'archetype-support:mono-green stompy',
    ]);
  });

  it('carries the distance in the claim, in the unit the claim is stated in', () => {
    const claims = formatClaims(FIXTURE_CRITERIA_INPUT, CRITERIA, validateCube(lopsidedCube(), CRITERIA));

    expect(claims.ok).toBe(false);
    const size = claims.claims.find((claim) => claim.capability === 'size');
    expect(size?.status).toBe('missed');
    expect(size?.unit).toBe('cards');
    expect(size?.distance, 'the size claim did not say how far off it was').toBe(
      (size?.measured ?? 0) - (size?.required ?? 0),
    );
    expect(size?.distance).toBeLessThan(0);
    for (const claim of claims.claims) {
      if (claim.status === 'unmeasured') continue;
      expect(claim.measured, `${claim.capability} was settled with no measurement`).not.toBeNull();
    }
  });

  it('keeps a finding no stated capability accounts for rather than dropping it', () => {
    // The fixture tags a white card for mono-green stompy, which is an
    // `archetype-color` finding: a construction fault rather than a stated
    // capability, so nothing claims it and it has to stay visible.
    const claims = formatClaims(FIXTURE_CRITERIA_INPUT, CRITERIA, validateCube(lopsidedCube(), CRITERIA));

    expect(claims.unclaimed.map((finding) => finding.code)).toContain('archetype-color');
    expect(claims.ok, 'an unclaimed blocking finding was reported as fine').toBe(false);
  });

  it('keeps a card no stated band judges visible for the same reason', () => {
    // mtg-iu4b. A curve stated `MV 1-2` and `MV 4+` claims those two bands and
    // nothing about a three-drop, so the three-drop's finding belongs to no
    // claim and takes the same route out as a mis-tagged card: unclaimed and
    // blocking, never a claims block that reads met on both bands.
    const stated: CubeCriteriaInput = {
      ...FIXTURE_CRITERIA_INPUT,
      curve: [
        { from: 1, to: 2, minCards: 20, maxCards: 30 },
        { from: 4, to: null, minCards: 20, maxCards: 30 },
      ],
    };
    const criteria = CubeCriteriaSchema.parse(stated);
    const entries = balancedCube().map((entry, index) =>
      index === 5 ? { ...entry, card: { ...entry.card, manaValue: 3 } } : entry,
    );
    const claims = formatClaims(stated, criteria, validateCube(entries, criteria));

    expect(
      claims.claims
        .filter((claim) => claim.capability === 'curve-band')
        .every((claim) => claim.status === 'met'),
    ).toBe(true);
    expect(claims.unclaimed.map((finding) => finding.code)).toContain('curve-uncovered');
    expect(claims.ok, 'a cube judging one of its cards by nothing was reported as fine').toBe(false);
  });
});

describe('a default is not a statement', () => {
  it('claims nothing for the dials the fixture left to the schema', () => {
    const claims = formatClaims(FIXTURE_CRITERIA_INPUT, CRITERIA, validateCube(balancedCube(), CRITERIA));

    expect(CRITERIA.singleton, 'the schema stopped defaulting singleton').toBe(true);
    expect(CRITERIA.colorBalanceTolerance).toBeGreaterThan(0);
    expect(claims.claims.map((claim) => claim.capability)).not.toContain('copies');
    expect(claims.claims.map((claim) => claim.capability)).not.toContain('color-balance');
  });

  it('claims them once they are stated, with one claim per measured color', () => {
    const stated: CubeCriteriaInput = {
      ...FIXTURE_CRITERIA_INPUT,
      singleton: true,
      colorBalanceTolerance: 0.1,
    };
    const criteria = CubeCriteriaSchema.parse(stated);
    const claims = formatClaims(stated, criteria, validateCube(balancedCube(), criteria));

    expect(
      claims.claims.filter((claim) => claim.capability === 'color-balance').map((claim) => claim.subject),
    ).toEqual(['W', 'U', 'B', 'R', 'G']);
    const copies = claims.claims.find((claim) => claim.capability === 'copies');
    expect(copies?.unit).toBe('copies');
    expect(copies?.status).toBe('met');
  });

  it('never claims an availability minimum the archetype did not state', () => {
    const criteria = fixtureCriteria();
    const claims = formatClaims(
      FIXTURE_CRITERIA_INPUT,
      criteria,
      validateCube(
        balancedCube(),
        criteria,
        drafted({ 'azorius control': 1, 'rakdos aggro': 1, 'mono-green stompy': 1 }),
      ),
    );

    expect(criteria.archetypes.every((archetype) => archetype.minAvailability === undefined)).toBe(true);
    expect(claims.claims.map((claim) => claim.capability)).not.toContain('archetype-availability');
    expect(claims.draftProvenance, 'the shares were measured but their seed was not carried').toEqual({
      seed: 'test/claims',
      drafts: 2,
      seatDrafts: 4,
      botPolicy: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
    });
  });
});

describe('the drafted half says what it cannot say', () => {
  const stateMinimum = (): CubeCriteriaInput => ({
    ...FIXTURE_CRITERIA_INPUT,
    archetypes:
      FIXTURE_CRITERIA_INPUT.archetypes?.map((archetype) => ({ ...archetype, minAvailability: 0.5 })) ?? [],
  });

  it('reports an unmeasured availability with the runtime reason and no share', () => {
    const stated = stateMinimum();
    const criteria = CubeCriteriaSchema.parse(stated);
    const validation = validateCube(balancedCube(), criteria, {
      kind: 'unmeasured',
      reason: 'this cube is cut from the card store, and the draft runtime drafts DSL cards',
    });
    const claims = formatClaims(stated, criteria, validation);

    const availability = claims.claims.filter((claim) => claim.capability === 'archetype-availability');
    expect(availability).toHaveLength(3);
    for (const claim of availability) {
      expect(claim.status).toBe('unmeasured');
      expect(claim.measured, 'an unmeasured claim reported a share anyway').toBeNull();
      expect(claim.distance).toBeNull();
      expect(claim.detail).toContain('drafts DSL cards');
    }
    expect(claims.ok, 'unmeasured was treated as missed').toBe(true);
    expect(claims.draftProvenance).toBeNull();
    expect(claims.limits.kind).toBe('not-drafted');
    expect(claims.limits.limits.map((limit) => limit.id)).toEqual(['dsl-cards-only', 'distinct-ids-only']);
  });

  it('shows the deal and bot limits beside every share it did measure', () => {
    const stated = stateMinimum();
    const criteria = CubeCriteriaSchema.parse(stated);
    const claims = formatClaims(
      stated,
      criteria,
      validateCube(
        balancedCube(),
        criteria,
        drafted({ 'azorius control': 1, 'rakdos aggro': 1, 'mono-green stompy': 0.25 }),
      ),
    );

    expect(claims.limits.kind).toBe('shares-measured');
    expect(claims.limits.limits.map((limit) => limit.id)).toEqual([
      'independent-packs',
      'rarity-collation',
      'native-deck-conditioned-bot',
    ]);
    const short = claims.claims.find(
      (claim) => claim.capability === 'archetype-availability' && claim.subject === 'mono-green stompy',
    );
    expect(short?.status, 'a share a quarter of the stated minimum passed').not.toBe('met');
    expect(short?.required).toBe(0.5);
  });

  it("abstains in the deal's own units when the pod cannot deal the archetype at all", () => {
    const stated = stateMinimum();
    const criteria = CubeCriteriaSchema.parse(stated);
    const availability = drafted({ 'azorius control': 1, 'rakdos aggro': 1, 'mono-green stompy': 0 });
    const starved: AvailabilityMeasured = {
      ...availability,
      archetypes: availability.archetypes.map((entry) =>
        entry.name === 'mono-green stompy' ? { ...entry, dealtCastable: 4 } : entry,
      ),
    };
    const claims = formatClaims(stated, criteria, validateCube(balancedCube(), criteria, starved));

    const short = claims.claims.find(
      (claim) => claim.capability === 'archetype-availability' && claim.subject === 'mono-green stompy',
    );
    expect(short?.status).toBe('abstained');
    expect(short?.unit, 'the abstention was reported in the share it is not about').toBe('cards');
    expect(short?.measured).toBe(4);
    expect(short?.required).toBe(starved.spellsRequired);
    expect(claims.ok, 'an abstention failed the format').toBe(true);
  });

  it('says the list was never drafted rather than inventing a reason', () => {
    const stated = stateMinimum();
    const criteria = CubeCriteriaSchema.parse(stated);
    const claims = formatClaims(stated, criteria, validateCube(balancedCube(), criteria));

    expect(claims.limits.kind).toBe('not-attempted');
    expect(claims.limits.limits).toEqual([]);
    const availability = claims.claims.filter((claim) => claim.capability === 'archetype-availability');
    expect(availability.every((claim) => claim.status === 'unmeasured')).toBe(true);
    expect(availability[0]?.detail).toContain('without a draft being asked for');
  });
});
