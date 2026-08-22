/**
 * The deterministic gate: what a finished cube actually is, and where that
 * differs from what was asked for.
 *
 * Everything in this file is arithmetic over a list of rows — how many cards
 * each color holds, how many sit in each mana-value band, how many carry each
 * archetype's tag, whether a tagged card can even be cast in that archetype's
 * colors. No model is consulted and no judgment is made: the judgment about
 * which cards serve an archetype was made upstream in `propose.ts` and arrives
 * here as a tag on the entry, which is what keeps "archetype coverage" a count
 * rather than the keyword scan the project's ZFC rule forbids.
 *
 * One measurement is not arithmetic over the list: archetype availability comes
 * from drafting it, and `availability.ts` runs those drafts. The findings it
 * produces are still made here, so a caller reading `validation.findings` sees
 * everything the cube was held to in one list rather than two.
 *
 * Findings carry the numbers, not a verdict. "This cube is unbalanced" tells a
 * designer nothing they can act on; "blue holds 2 of 48 colored slots (4.2%),
 * outside 20.0% ± 5.0% — it needs at least 8" tells them what to add and how
 * many. A criterion the designer never stated is measured and reported but
 * never failed.
 */
import type { CandidateCard } from '@mtg/decklab';
import { isLandCard } from '@mtg/decklab';
import type { Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { CubeAvailability } from './availability';
import type { CubeArchetype, CubeCriteria, CurveBand } from './criteria';
import { bandHolds, bandLabel, cubeCopyLimit, draftCapacity } from './criteria';

/** One card in a cube, with the archetypes something judged it to serve. */
export interface CubeEntry {
  readonly card: CandidateCard;
  /** Copies. One, unless the cube said it is not singleton. */
  readonly count: number;
  /** Names of stated archetypes this card serves. Empty is a legal answer. */
  readonly archetypes: readonly string[];
  /** Why it is here, in the words of whatever chose it. */
  readonly reason: string;
}

export type CubeFindingCode =
  /** The list is not the size the designer asked for. */
  | 'size'
  /** Too small for the pod it states: `seats × cardsPerSeat` exceeds it. */
  | 'draft-capacity'
  /** A card appears more often than the cube's copy limit allows. */
  | 'copies'
  /** One color's share of the colored slots is outside the tolerance. */
  | 'color-balance'
  /** A stated curve band holds too few or too many cards. */
  | 'curve-band'
  /** A stated archetype has fewer playable cards than it requires. */
  | 'archetype-support'
  /** A card is tagged for an archetype it cannot be cast in. */
  | 'archetype-color'
  /** Too few seats in the measured drafts could assemble a stated archetype. */
  | 'archetype-availability'
  /**
   * A stated minimum was missed, but the pod's own pack deals a seat fewer
   * castable spells than a deck needs — the seat cannot assemble the
   * archetype however well it drafts, so the miss is a fact about the pod
   * rather than the archetype. Reported, never blocking: see `isBlocking`.
   */
  | 'archetype-availability-abstained';

/**
 * One way the cube differs from the ask, with both sides of the comparison as
 * numbers so a caller can rank, sum or chart them without parsing prose.
 */
export interface CubeFinding {
  readonly code: CubeFindingCode;
  /** Color letter, band label, archetype name, or empty for the whole cube. */
  readonly subject: string;
  readonly measured: number;
  readonly required: number;
  readonly detail: string;
}

export interface ColorMeasure {
  readonly color: Color;
  readonly cards: number;
  /**
   * Share of every colored slot in the list, where a two-color card fills one
   * in each. This is a census of what was built and spans the whole pie, which
   * is not always the pie the balance *finding* is measured against — see
   * `measuredColors`. The two coincide for any cube this package constructed,
   * because a card the gate accepted is castable in some stated archetype.
   */
  readonly share: number;
}

export interface CurveMeasure {
  readonly manaValue: number;
  readonly cards: number;
}

export interface ArchetypeMeasure {
  readonly name: string;
  readonly playable: number;
  readonly required: number;
}

export interface CubeMeasurement {
  /** Cards counted with multiplicity. */
  readonly size: number;
  readonly colors: readonly ColorMeasure[];
  /** Cards with no color identity at all: artifacts, colorless lands. */
  readonly colorless: number;
  readonly lands: number;
  /** Non-land cards per mana value, ascending, only the values present. */
  readonly curve: readonly CurveMeasure[];
  readonly archetypes: readonly ArchetypeMeasure[];
}

export interface CubeValidation {
  readonly measurement: CubeMeasurement;
  /**
   * What drafting the list said, or why it was not drafted. `null` when the
   * caller measured the list without asking for a draft, which is every caller
   * that only wants the arithmetic.
   */
  readonly availability: CubeAvailability | null;
  readonly findings: readonly CubeFinding[];
  readonly ok: boolean;
}

/**
 * The colors the balance finding is measured across, and therefore what an
 * "even share" is worth.
 *
 * A cube that states archetypes has stated which colors it is drafted in, and
 * an even share of those is one over their count — a quarter across four
 * colors, not a fifth. Measuring the whole pie regardless produced the finding
 * that named this: a cube stating boros {WR} and dimir {UB} was told green held
 * 0 of 50 colored slots against a wanted 20%, which is a true statement about
 * the list and a useless one about the cube, since green is absent by design
 * and the archetype gate would reject every green card proposed for it. The
 * alternative was to keep the fifth and suppress the finding, which keeps a
 * number that is quietly wrong (mtg-bc2.124).
 *
 * A cube that states no archetypes keeps the even fifth. It has said nothing
 * about which colors it runs, so the whole pie is the only pie there is — the
 * same reason the prompt drops its tagging rule and the schema drops the tag.
 */
export function measuredColors(criteria: CubeCriteria): readonly Color[] {
  if (criteria.archetypes.length === 0) return COLORS;
  const stated = new Set(criteria.archetypes.flatMap((archetype) => archetype.colors));
  return COLORS.filter((color) => stated.has(color));
}

const COLOR_NAMES: Readonly<Record<Color, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

/** The WUBRG letters in a card's color identity. */
export function identityColors(card: CandidateCard): readonly Color[] {
  return COLORS.filter((color) => card.colorIdentity.includes(color));
}

/**
 * Whether a card can be cast in an archetype's colors.
 *
 * Color identity rather than casting cost, because a card whose activated
 * ability needs a color the deck cannot produce is a card that deck cannot
 * use. A colorless card is within every archetype.
 */
export function withinArchetype(card: CandidateCard, archetype: CubeArchetype): boolean {
  return identityColors(card).every((color) => archetype.colors.includes(color));
}

export function measureCube(entries: readonly CubeEntry[], criteria: CubeCriteria): CubeMeasurement {
  const colorCounts = new Map<Color, number>(COLORS.map((color) => [color, 0]));
  const curveCounts = new Map<number, number>();
  let colorless = 0;
  let lands = 0;
  let size = 0;

  for (const entry of entries) {
    size += entry.count;
    const colors = identityColors(entry.card);
    if (colors.length === 0) colorless += entry.count;
    for (const color of colors) colorCounts.set(color, (colorCounts.get(color) ?? 0) + entry.count);

    if (isLandCard(entry.card)) {
      lands += entry.count;
      continue;
    }
    const manaValue = entry.card.manaValue;
    curveCounts.set(manaValue, (curveCounts.get(manaValue) ?? 0) + entry.count);
  }

  const coloredSlots = [...colorCounts.values()].reduce((sum, count) => sum + count, 0);
  return {
    size,
    colors: COLORS.map((color) => {
      const cards = colorCounts.get(color) ?? 0;
      return { color, cards, share: coloredSlots === 0 ? 0 : cards / coloredSlots };
    }),
    colorless,
    lands,
    curve: [...curveCounts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([manaValue, cards]) => ({ manaValue, cards })),
    archetypes: criteria.archetypes.map((archetype) => ({
      name: archetype.name,
      playable: playableFor(entries, archetype),
      required: archetype.minPlayable,
    })),
  };
}

export function validateCube(
  entries: readonly CubeEntry[],
  criteria: CubeCriteria,
  availability: CubeAvailability | null = null,
): CubeValidation {
  const measurement = measureCube(entries, criteria);
  const findings: CubeFinding[] = [
    ...sizeFindings(measurement, criteria),
    ...copyFindings(entries, criteria),
    ...colorFindings(measurement, criteria),
    ...curveFindings(measurement, criteria),
    ...archetypeColorFindings(entries, criteria),
    ...archetypeSupportFindings(measurement),
    ...availabilityFindings(availability),
  ];
  return { measurement, availability, findings, ok: findings.every((finding) => !isBlocking(finding)) };
}

/**
 * Whether a finding is a difference the cube is held to, as opposed to a
 * measurement reported for the record.
 *
 * `archetype-availability-abstained` is the one finding that is printed
 * without failing the cube: it says a stated minimum could not be judged,
 * not that the cube missed it. Everything else in `CubeFindingCode` is a
 * miss, and stays one.
 */
function isBlocking(finding: CubeFinding): boolean {
  return finding.code !== 'archetype-availability-abstained';
}

/** Cards tagged for an archetype that its colors can actually hold. */
function playableFor(entries: readonly CubeEntry[], archetype: CubeArchetype): number {
  return entries
    .filter((entry) => entry.archetypes.includes(archetype.name) && withinArchetype(entry.card, archetype))
    .reduce((sum, entry) => sum + entry.count, 0);
}

function sizeFindings(measurement: CubeMeasurement, criteria: CubeCriteria): readonly CubeFinding[] {
  const findings: CubeFinding[] = [];
  if (measurement.size !== criteria.size) {
    findings.push({
      code: 'size',
      subject: '',
      measured: measurement.size,
      required: criteria.size,
      detail: `the cube holds ${String(measurement.size)} cards against a stated size of ${String(criteria.size)}`,
    });
  }
  const capacity = draftCapacity(criteria);
  if (measurement.size < capacity) {
    findings.push({
      code: 'draft-capacity',
      subject: '',
      measured: measurement.size,
      required: capacity,
      detail: `${String(criteria.seats)} seats at ${String(criteria.cardsPerSeat)} cards each need ${String(capacity)} cards; the cube holds ${String(measurement.size)}`,
    });
  }
  return findings;
}

function copyFindings(entries: readonly CubeEntry[], criteria: CubeCriteria): readonly CubeFinding[] {
  const limit = cubeCopyLimit(criteria);
  const copies = new Map<string, { readonly name: string; count: number }>();
  for (const entry of entries) {
    const seen = copies.get(entry.card.oracleId);
    if (seen === undefined) copies.set(entry.card.oracleId, { name: entry.card.name, count: entry.count });
    else seen.count += entry.count;
  }

  return [...copies.values()]
    .filter((seen) => seen.count > limit)
    .map((seen) => ({
      code: 'copies' as const,
      subject: seen.name,
      measured: seen.count,
      required: limit,
      detail: `${seen.name} appears ${String(seen.count)} times against a limit of ${String(limit)}`,
    }));
}

/**
 * Each measured color against an even share of the pie it is measured in.
 *
 * Both the numerator and the denominator are scoped to `measuredColors`, so the
 * shares still sum to one and "an even share" is still what the band says it
 * is. A color outside that scope is neither counted nor faulted; it is still
 * reported by `measureCube` and printed, so nothing disappears.
 */
function colorFindings(measurement: CubeMeasurement, criteria: CubeCriteria): readonly CubeFinding[] {
  const measured = measuredColors(criteria);
  const counts = measurement.colors.filter((color) => measured.includes(color.color));
  const slots = counts.reduce((sum, color) => sum + color.cards, 0);
  if (slots === 0) return [];

  const evenShare = 1 / measured.length;
  const tolerance = criteria.colorBalanceTolerance;
  const band = `${percent(evenShare)} ± ${percent(tolerance)}`;
  const scope =
    measured.length === COLORS.length
      ? 'colored slots'
      : `slots in the archetypes' colors {${measured.join('')}}`;

  return counts
    .map((color) => ({ color: color.color, cards: color.cards, share: color.cards / slots }))
    .filter((color) => Math.abs(color.share - evenShare) > tolerance)
    .map((color) => {
      const low = color.share < evenShare;
      const required = low
        ? Math.ceil((evenShare - tolerance) * slots)
        : Math.floor((evenShare + tolerance) * slots);
      return {
        code: 'color-balance' as const,
        subject: color.color,
        measured: color.cards,
        required,
        detail:
          `${COLOR_NAMES[color.color]} holds ${String(color.cards)} of ${String(slots)} ${scope} ` +
          `(${percent(color.share)}), outside ${band} — it wants ${low ? 'at least' : 'at most'} ${String(required)}`,
      };
    });
}

function curveFindings(measurement: CubeMeasurement, criteria: CubeCriteria): readonly CubeFinding[] {
  return criteria.curve.flatMap((band) => {
    const cards = cardsInBand(measurement.curve, band);
    if (cards < band.minCards) {
      return [
        {
          code: 'curve-band' as const,
          subject: bandLabel(band),
          measured: cards,
          required: band.minCards,
          detail: `${bandLabel(band)} holds ${String(cards)} cards against a minimum of ${String(band.minCards)}`,
        },
      ];
    }
    if (cards > band.maxCards) {
      return [
        {
          code: 'curve-band' as const,
          subject: bandLabel(band),
          measured: cards,
          required: band.maxCards,
          detail: `${bandLabel(band)} holds ${String(cards)} cards against a maximum of ${String(band.maxCards)}`,
        },
      ];
    }
    return [];
  });
}

function cardsInBand(curve: readonly CurveMeasure[], band: CurveBand): number {
  return curve
    .filter((point) => bandHolds(band, point.manaValue))
    .reduce((sum, point) => sum + point.cards, 0);
}

function archetypeColorFindings(
  entries: readonly CubeEntry[],
  criteria: CubeCriteria,
): readonly CubeFinding[] {
  const byName = new Map(criteria.archetypes.map((archetype) => [archetype.name, archetype]));
  return entries.flatMap((entry) =>
    entry.archetypes.flatMap((name) => {
      const archetype = byName.get(name);
      // A tag naming an archetype the criteria never stated is the proposal
      // gate's business, and it rejects it there; here it is simply not one of
      // the archetypes being measured.
      if (archetype === undefined || withinArchetype(entry.card, archetype)) return [];
      return [
        {
          code: 'archetype-color' as const,
          subject: name,
          measured: identityColors(entry.card).length,
          required: archetype.colors.length,
          detail: `${entry.card.name} is tagged ${name} but its color identity {${entry.card.colorIdentity}} is not within {${archetype.colors.join('')}}`,
        },
      ];
    }),
  );
}

function archetypeSupportFindings(measurement: CubeMeasurement): readonly CubeFinding[] {
  return measurement.archetypes
    .filter((archetype) => archetype.playable < archetype.required)
    .map((archetype) => ({
      code: 'archetype-support' as const,
      subject: archetype.name,
      measured: archetype.playable,
      required: archetype.required,
      detail: `${archetype.name} has ${String(archetype.playable)} playable cards against ${String(archetype.required)} required`,
    }));
}

/**
 * Archetypes the drafts reached less often than the cube demanded.
 *
 * A cube that stated no minimum for an archetype is never failed on it, and a
 * cube that was not drafted is never failed at all: `measured` and `required`
 * are seat-drafts either way, so this finding ranks and sums alongside the
 * counting ones rather than being a percentage nobody can add up.
 *
 * A miss where the pod's own deal is short of what a deck needs is a
 * different subject wearing the archetype's name: `dealtCastable` below
 * `spellsRequired` means the seat cannot assemble the archetype from the deal
 * at all, however good the list is, so failing the archetype would name the
 * wrong cause. That case abstains instead — `archetype-availability-abstained`,
 * carrying the deal and the requirement rather than the seat-draft count, and
 * excluded from `ok` by `isBlocking`. It only ever replaces a miss: a share
 * that already cleared the stated minimum returns nothing either way, deal or
 * no deal, because nothing there needed excusing.
 */
function availabilityFindings(availability: CubeAvailability | null): readonly CubeFinding[] {
  if (availability === null || availability.kind === 'unmeasured') return [];
  const sample = availability.seatDrafts;
  return availability.archetypes.flatMap((archetype): readonly CubeFinding[] => {
    if (archetype.minShare === null) return [];
    const required = Math.ceil(archetype.minShare * sample);
    if (archetype.assembled >= required) return [];
    if (archetype.dealtCastable < availability.spellsRequired) {
      return [
        {
          code: 'archetype-availability-abstained' as const,
          subject: archetype.name,
          measured: archetype.dealtCastable,
          required: availability.spellsRequired,
          detail:
            `${archetype.name} was assembled by ${String(archetype.assembled)} of ${String(sample)} seat-drafts ` +
            `(${percent(archetype.share)}) against a stated minimum of ${percent(archetype.minShare)}, but not ` +
            `failed on it: this pod deals a seat ${archetype.dealtCastable.toFixed(1)} castable spells before a ` +
            `pick, and a deck needs ${String(availability.spellsRequired)} — the seat cannot assemble the ` +
            'archetype from that deal however well it drafts',
        },
      ];
    }
    return [
      {
        code: 'archetype-availability' as const,
        subject: archetype.name,
        measured: archetype.assembled,
        required,
        detail:
          `${archetype.name} was assembled by ${String(archetype.assembled)} of ${String(sample)} seat-drafts ` +
          `(${percent(archetype.share)}), against a stated minimum of ${percent(archetype.minShare)} — it wants at least ${String(required)}`,
      },
    ];
  });
}

/** `0.25` as `"25.0%"`. Exported so the proposal prompt can quote the same band it is gated against. */
export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
