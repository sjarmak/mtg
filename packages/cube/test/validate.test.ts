/**
 * The assertion this package exists to make: a lopsided cube fails, and it says
 * by how much.
 *
 * "Balanced archetype availability" is the bead's acceptance language, and the
 * half of it that can be settled without a draft engine is settled here — over a
 * finished list, deterministically, with no store and no model. A validator that
 * returned `true` for everything would pass the first block and fail the second;
 * one that returned `false` for everything would do the reverse.
 */
import { describe, expect, it } from 'vitest';
import type { AvailabilityMeasured } from '../src/availability';
import {
  balancedCube,
  fixtureCard,
  fixtureCriteria,
  fixtureEntry,
  lopsidedCube,
} from './support/fixture-cube';
import { measureCube, measuredColors, validateCube } from '../src/validate';

const CRITERIA = fixtureCriteria();

/**
 * A measurement built by hand rather than by drafting, so a case can hold
 * `dealtCastable` and `spellsRequired` to the exact values the abstention
 * compares — `dealtCastable < spellsRequired` and nothing else — without a
 * fixture's other axes (color depth, curve, pod size) moving the numbers as a
 * side effect of moving the one this tests.
 */
function measuredAvailability(
  archetype: Partial<AvailabilityMeasured['archetypes'][number]> & { readonly name: string },
): AvailabilityMeasured {
  return {
    kind: 'measured',
    seed: 'test/hand-built',
    drafts: 2,
    seats: 4,
    packs: 3,
    cardsPerSeat: 45,
    seatDrafts: 8,
    spellsRequired: 23,
    archetypes: [
      { assembled: 1, share: 0.125, minShare: 0.9, castable: 68, dealtCastable: 30, ...archetype },
    ],
  };
}

describe('a cube that meets its stated criteria', () => {
  it('passes with nothing to report', () => {
    const result = validateCube(balancedCube(), CRITERIA);
    expect(result.findings).toStrictEqual([]);
    expect(result.ok).toBe(true);
  });

  it('measures the color split, the curve and each archetype anyway', () => {
    const measurement = measureCube(balancedCube(), CRITERIA);
    expect(measurement.size).toBe(50);
    expect(measurement.colors.map((entry) => entry.cards)).toStrictEqual([10, 10, 10, 10, 10]);
    for (const color of measurement.colors) expect(color.share).toBeCloseTo(0.2, 10);
    expect(measurement.curve).toStrictEqual([
      { manaValue: 2, cards: 25 },
      { manaValue: 4, cards: 25 },
    ]);
    expect(measurement.archetypes).toStrictEqual([
      { name: 'azorius control', playable: 20, required: 10 },
      { name: 'rakdos aggro', playable: 20, required: 10 },
      { name: 'mono-green stompy', playable: 10, required: 10 },
    ]);
  });
});

describe('a cube that does not', () => {
  const result = validateCube(lopsidedCube(), CRITERIA);
  const codes = result.findings.map((finding) => finding.code);
  const find = (code: string, subject: string) =>
    result.findings.find((finding) => finding.code === code && finding.subject === subject);

  it('fails', () => {
    expect(result.ok).toBe(false);
  });

  it('names every axis it broke, once each', () => {
    expect(codes.filter((code) => code === 'size')).toHaveLength(1);
    expect(codes.filter((code) => code === 'draft-capacity')).toHaveLength(1);
    expect(codes.filter((code) => code === 'color-balance')).toHaveLength(3);
    expect(codes.filter((code) => code === 'curve-band')).toHaveLength(2);
    expect(codes.filter((code) => code === 'archetype-support')).toHaveLength(2);
    expect(codes.filter((code) => code === 'archetype-color')).toHaveLength(1);
  });

  it('reports the offending numbers rather than a boolean', () => {
    expect(find('size', '')).toMatchObject({ measured: 48, required: 50 });
    // Two seats at 25 cards each is 50 cards a pod cannot draw from 48.
    expect(find('draft-capacity', '')).toMatchObject({ measured: 48, required: 50 });
    expect(find('color-balance', 'W')).toMatchObject({ measured: 24 });
    expect(find('color-balance', 'U')).toMatchObject({ measured: 2 });
    expect(find('color-balance', 'G')).toMatchObject({ measured: 2 });
    expect(find('curve-band', 'MV 0-2')).toMatchObject({ measured: 48, required: 30 });
    expect(find('curve-band', 'MV 3+')).toMatchObject({ measured: 0, required: 20 });
    // Two, not three: the white card tagged `rakdos aggro` cannot be cast in
    // {B,R}, so it is not playable there and is not counted as support for it.
    expect(find('archetype-support', 'rakdos aggro')).toMatchObject({ measured: 2, required: 10 });
    expect(find('archetype-support', 'mono-green stompy')).toMatchObject({ measured: 2, required: 10 });
  });

  it('says it in prose a designer can act on', () => {
    expect(find('color-balance', 'U')?.detail).toContain('2 of 48');
    expect(find('color-balance', 'U')?.detail).toContain('20.0% ± 5.0%');
    expect(find('curve-band', 'MV 3+')?.detail).toContain('holds 0 cards against a minimum of 20');
    expect(find('archetype-support', 'rakdos aggro')?.detail).toContain('2 playable cards against 10');
    expect(find('archetype-color', 'rakdos aggro')?.detail).toContain('lopsided W 1');
  });

  it('does not fault the colors it got right', () => {
    expect(find('color-balance', 'B')).toBeUndefined();
    expect(find('color-balance', 'R')).toBeUndefined();
    expect(find('archetype-support', 'azorius control')).toBeUndefined();
  });
});

describe('an unstated criterion', () => {
  it('is measured but never failed', () => {
    // A cube with no curve bands and no archetypes still reports both; the
    // curve is a designed dial, so an unstated one is not a violated one.
    const bare = fixtureCriteria({ curve: [], archetypes: [] });
    const result = validateCube(lopsidedCube(), bare);
    expect(result.findings.map((finding) => finding.code)).not.toContain('curve-band');
    expect(result.findings.map((finding) => finding.code)).not.toContain('archetype-support');
    expect(result.measurement.curve).toStrictEqual([{ manaValue: 1, cards: 48 }]);
  });
});

describe('a cube whose archetypes cover part of the pie', () => {
  /**
   * Boros {WR} against dimir {UB}: four colors stated, green stated nowhere.
   * The live run that filed mtg-bc2.124 was told green held 0 of 50 colored
   * slots against a wanted 20%, which is true about the list and useless about
   * the cube — the archetype gate would reject every green card proposed for
   * it, so green is absent by design and not by accident.
   */
  const FOUR_COLORS = fixtureCriteria({
    size: 48,
    curve: [],
    archetypes: [
      { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 12 },
      { name: 'dimir control', colors: ['U', 'B'], minPlayable: 12 },
    ],
  });

  /** `count` mono-colored cards, tagged with the archetype that can cast them. */
  const runOf = (color: string, count: number, archetype?: string) =>
    Array.from({ length: count }, (_unused, index) =>
      fixtureEntry(
        fixtureCard({
          name: `${color} quarter ${String(index + 1)}`,
          manaCost: `{${color}}`,
          manaValue: 2,
          colorIdentity: color,
        }),
        archetype === undefined ? [] : [archetype],
      ),
    );

  /** Twelve cards in each stated color: an even quarter each, green nowhere. */
  const evenFourths = () => [
    ...runOf('W', 12, 'boros aggro'),
    ...runOf('R', 12, 'boros aggro'),
    ...runOf('U', 12, 'dimir control'),
    ...runOf('B', 12, 'dimir control'),
  ];

  it('measures balance across the colors the archetypes span', () => {
    expect(measuredColors(FOUR_COLORS)).toStrictEqual(['W', 'U', 'B', 'R']);
    expect(measuredColors(fixtureCriteria({ archetypes: [] }))).toStrictEqual(['W', 'U', 'B', 'R', 'G']);
  });

  it('passes a cube split evenly across its four colors, and says nothing about green', () => {
    // An even share of four colors is a quarter. Measured against a fifth, each
    // of these four is 5 points high and green is 20 points low: five findings
    // on a cube that is exactly what its designer asked for.
    const findings = validateCube(evenFourths(), FOUR_COLORS).findings;
    expect(findings.filter((finding) => finding.code === 'color-balance')).toStrictEqual([]);
  });

  it('divides by the slots in the stated colors, not by every colored slot', () => {
    // The decision the shipped numbers rest on: both halves of the share are
    // scoped, so the measured shares still sum to one. A denominator over the
    // whole pie would report the same four black cards as 4 of 44 (9.1%) short
    // of 9 — three numbers wrong out of three, on a cube whose green cards are
    // exactly what makes the two denominators differ.
    const offUnion = [
      ...runOf('W', 12, 'boros aggro'),
      ...runOf('U', 12, 'dimir control'),
      ...runOf('R', 12, 'boros aggro'),
      ...runOf('B', 4, 'dimir control'),
      // Untagged, so nothing but the denominator can notice them.
      ...runOf('G', 4),
    ];
    const findings = validateCube(offUnion, FOUR_COLORS).findings.filter(
      (finding) => finding.code === 'color-balance',
    );

    expect(findings.map((finding) => finding.subject)).toStrictEqual(['B']);
    expect(findings[0]?.detail).toContain("4 of 40 slots in the archetypes' colors {WUBR}");
    expect(findings[0]?.detail).toContain('(10.0%)');
    expect(findings[0]?.required).toBe(8);
  });

  it('still fails a lopsided one, against the quarter and in the words of the quarter', () => {
    const lopsided = [
      ...runOf('W', 24, 'boros aggro'),
      ...runOf('U', 12, 'dimir control'),
      ...runOf('B', 12, 'dimir control'),
    ];
    const findings = validateCube(lopsided, FOUR_COLORS).findings.filter(
      (finding) => finding.code === 'color-balance',
    );

    // Twenty-four white and no red: white is half a pie that wants a quarter,
    // and red is a stated color holding none of it.
    expect(findings.map((finding) => finding.subject)).toStrictEqual(['W', 'R']);
    expect(findings[0]?.detail).toContain("24 of 48 slots in the archetypes' colors {WUBR}");
    expect(findings[0]?.detail).toContain('outside 25.0% ± 5.0%');
    expect(findings[0]?.detail).toContain('it wants at most 14');
  });
});

describe('the copy limit', () => {
  it('fails a singleton cube that holds a card twice', () => {
    const doubled = [...balancedCube().slice(0, 49), ...balancedCube().slice(0, 1)];
    const result = validateCube(doubled, CRITERIA);
    expect(result.findings.find((finding) => finding.code === 'copies')).toMatchObject({
      measured: 2,
      required: 1,
    });
  });

  it('allows four of a card when the cube is not singleton', () => {
    const criteria = fixtureCriteria({ singleton: false });
    const doubled = [...balancedCube().slice(0, 49), ...balancedCube().slice(0, 1)];
    expect(validateCube(doubled, criteria).findings.map((finding) => finding.code)).not.toContain('copies');
  });
});

describe('a missed minimum the pod itself could not have reached', () => {
  /**
   * `balancedCube()` against `CRITERIA` reports nothing on its own — the
   * "passes with nothing to report" case above is the proof — so every
   * finding in these cases comes from the hand-built availability and from
   * nothing else, which is what lets `ok` be read as a direct statement about
   * the abstention rather than about some other axis of the fixture.
   */
  it('abstains rather than fails when the deal is short of what a deck needs', () => {
    const availability = measuredAvailability({ name: 'azorius control', dealtCastable: 18 });
    const result = validateCube(balancedCube(), CRITERIA, availability);

    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding?.code).toBe('archetype-availability-abstained');
    expect(finding?.subject).toBe('azorius control');
    // The deal and the requirement, not the seat-draft count a fail carries:
    // the whole point is that this finding is about the pod, not the draft.
    expect(finding?.measured).toBe(18);
    expect(finding?.required).toBe(23);
    expect(finding?.detail).toContain('18.0 castable spells');
    expect(finding?.detail).toContain('needs 23');
    // Never both: an abstained miss does not also carry the failing code.
    expect(result.findings.map((f) => f.code)).not.toContain('archetype-availability');
    // The whole point: reported, and does not fail the cube.
    expect(result.ok).toBe(true);
  });

  it('still fails a missed minimum when the deal clears what a deck needs', () => {
    const availability = measuredAvailability({ name: 'azorius control', dealtCastable: 36 });
    const result = validateCube(balancedCube(), CRITERIA, availability);

    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding?.code).toBe('archetype-availability');
    expect(finding?.detail).toContain('it wants at least');
    expect(result.ok).toBe(false);
  });

  it('is exact at the boundary: a deal equal to the requirement still fails', () => {
    // The rule is `dealtCastable < spellsRequired`, so a deal that lands
    // exactly on the requirement is not short of it and must not abstain.
    const availability = measuredAvailability({ name: 'azorius control', dealtCastable: 23 });
    const result = validateCube(balancedCube(), CRITERIA, availability);

    expect(result.findings.map((f) => f.code)).toStrictEqual(['archetype-availability']);
    expect(result.ok).toBe(false);
  });

  it('never abstains an archetype that already cleared its stated minimum', () => {
    // Assembled reached the minimum despite a shallow deal — real evidence,
    // and not the case this finding exists to excuse.
    const availability = measuredAvailability({
      name: 'azorius control',
      assembled: 8,
      minShare: 0.5,
      dealtCastable: 5,
    });
    const result = validateCube(balancedCube(), CRITERIA, availability);

    expect(result.findings).toStrictEqual([]);
    expect(result.ok).toBe(true);
  });
});
