import { bandLabel, cubeCopyLimit, draftCapacity } from './criteria';
import type { CubeCriteria, CubeCriteriaInput } from './criteria';
import type { CubeAvailability } from './availability';
import type { CubeFinding, CubeFindingCode, CubeValidation } from './validate';
import { measuredColors } from './validate';

/**
 * A stated capability, measured.
 *
 * This module answers one question — *does the format do what it claims* — and
 * it answers it by projection rather than by measuring anything itself. The
 * arithmetic is `validateCube`'s and the drafting is `measureAvailability`'s;
 * what is added here is the half those two do not carry: which comparisons the
 * designer actually **asked for**, as opposed to which ones the schema supplied
 * a default for.
 *
 * That distinction is the whole point. `CubeCriteriaSchema` defaults `size`,
 * `singleton`, `seats`, `cardsPerSeat` and `colorBalanceTolerance`, so a
 * validated `CubeCriteria` cannot tell a stated 540 from a default 540, and a
 * claims block built from it would report five capabilities to a designer who
 * stated one. So the input to `formatClaims` is the **pre-default input**, and
 * a key that is absent there produces no claim. It is the same rule
 * `availability.ts` states for `minAvailability` — measured and reported, never
 * failed, when nobody chose the number — applied to every dial rather than one.
 *
 * A finding that belongs to no stated claim is not dropped: it lands in
 * `unclaimed`, because a claims block that quietly loses a blocking finding
 * reads as a pass.
 */

/** Units a claim is compared in, so a surface can format without parsing prose. */
export type ClaimUnit = 'cards' | 'copies' | 'share';

export type ClaimStatus =
  /** Measured, and the stated number was met. */
  | 'met'
  /** Measured, and missed by `distance`. */
  | 'missed'
  /**
   * Measured and missed, but the miss is a fact about the pod rather than the
   * format — `validateCube`'s `archetype-availability-abstained`, which it
   * prints without failing the cube. Kept distinct from `missed` for the same
   * reason `isBlocking` keeps it distinct, and from `unmeasured` because both
   * numbers exist.
   */
  | 'abstained'
  /** The runtime could not check it. `detail` is the reason, never a share. */
  | 'unmeasured';

export interface Claim {
  /** The finding vocabulary, so one component renders a claim and a finding. */
  readonly capability: CubeFindingCode;
  /** Color letter, band label, archetype name, or empty for the whole list. */
  readonly subject: string;
  /** The capability in the format's own numbers, before anything was measured. */
  readonly statement: string;
  readonly status: ClaimStatus;
  /** `null` only when `status` is `unmeasured`. */
  readonly measured: number | null;
  readonly required: number;
  /** `measured - required`, in `unit`. `null` when unmeasured. */
  readonly distance: number | null;
  readonly unit: ClaimUnit;
  /** The finding's own words, or the reason nothing was measured. */
  readonly detail: string;
}

export type ClaimLimitId =
  | 'independent-packs'
  | 'rarity-collation'
  | 'native-deck-conditioned-bot'
  | 'dsl-cards-only'
  | 'distinct-ids-only';

export interface ClaimLimit {
  readonly id: ClaimLimitId;
  readonly what: string;
}

/**
 * What the drafted half of this block can and cannot say.
 *
 * `kind` is read off the availability's own shape and never off its reason
 * string: `measured` means cards were dealt, so the three limits on the deal
 * and the bot bear on every share; `unmeasured` means the runtime refused, so
 * the two limits that are grounds for a refusal are the ones a reader needs
 * beside `reason`; `not-attempted` is a caller that only wanted the arithmetic.
 */
export interface ClaimLimits {
  readonly kind: 'shares-measured' | 'not-drafted' | 'not-attempted';
  readonly limits: readonly ClaimLimit[];
}

export interface FormatClaims {
  readonly claims: readonly Claim[];
  /**
   * Findings no stated capability accounts for, and no dial's default either:
   * a construction fault, such as a card tagged for colors it cannot be cast
   * in. Blocking, and never silently dropped.
   */
  readonly unclaimed: readonly CubeFinding[];
  /**
   * Differences measured against a number the schema supplied rather than the
   * designer. Shown, never failed on — the rule `availability.ts` states for an
   * unstated `minAvailability`, applied to every dial that has a default. A
   * cube that never said what size it wanted is not missing its size.
   */
  readonly reported: readonly CubeFinding[];
  readonly limits: ClaimLimits;
  /** Provenance of every `share`, or `null` when nothing was drafted. */
  readonly draftProvenance: {
    readonly seed: string;
    readonly drafts: number;
    readonly seatDrafts: number;
    readonly botPolicy: string;
  } | null;
  /** No stated capability was missed by a blocking distance. */
  readonly ok: boolean;
}

const DEAL_LIMITS: readonly ClaimLimit[] = [
  {
    id: 'independent-packs',
    what:
      'each pack is drawn independently from the sheet, so one card can be dealt to several seats in one draft. ' +
      'A real list is dealt once, so every share here is optimistic, most for the cards the bots want most',
  },
  {
    id: 'rarity-collation',
    what:
      'packs are collated by DSL rarity, because the sheet builder partitions on it. Nothing is unreachable — the ' +
      "recipe answers with the list's own rarity mix — but the deal is stratified rather than uniform",
  },
  {
    id: 'native-deck-conditioned-bot',
    what:
      'the native pick loop maximizes projected deck value from the visible pool and typed card evaluation. ' +
      'A share is a statement about that versioned bot policy, not about eight people',
  },
];

const REFUSAL_LIMITS: readonly ClaimLimit[] = [
  {
    id: 'dsl-cards-only',
    what:
      'the draft runtime drafts DSL cards. A list cut from the real card store holds printings whose rules text ' +
      'the kernel cannot run, so it is measured but not drafted',
  },
  {
    id: 'distinct-ids-only',
    what:
      'a card is its id to the runtime, which deals a list of distinct cards, so a list holding one card twice is ' +
      'measured but not drafted and the card is named',
  },
];

export interface FormatClaimsOptions {
  /**
   * Why nothing decided which cards serve which archetype, when nothing did.
   *
   * Which cards serve an archetype is the one judgment this package sends to a
   * model, and the model is optional: a run with no key must still reach a
   * verdict. So an untagged list does not report an archetype with zero
   * playable cards — that is a measurement of the missing half, not of the
   * format. Every archetype claim becomes `unmeasured` carrying this reason,
   * and the archetype findings the validator produced against empty tags are
   * consumed rather than blocking or landing in `unclaimed`, because they are
   * restatements of the same absence.
   */
  readonly untaggedReason?: string;
}

/** Findings that are about the tagging rather than about the list. */
const TAGGED_CODES: readonly CubeFindingCode[] = [
  'archetype-support',
  'archetype-color',
  'archetype-availability',
  'archetype-availability-abstained',
];

/**
 * Projects a validated cube onto the capabilities its designer stated.
 *
 * `stated` is the raw criteria **before** `CubeCriteriaSchema` applied its
 * defaults; `criteria` is the same object after. Passing the parsed object as
 * both is not a shortcut, it is the bug this signature exists to prevent.
 */
export function formatClaims(
  stated: CubeCriteriaInput,
  criteria: CubeCriteria,
  validation: CubeValidation,
  options: FormatClaimsOptions = {},
): FormatClaims {
  const { measurement, availability, findings } = validation;
  const claims: Claim[] = [];
  const spent = new Set<CubeFinding>();

  const take = (code: CubeFindingCode, subject: string): CubeFinding | undefined => {
    const found = findings.find((finding) => finding.code === code && finding.subject === subject);
    if (found !== undefined) spent.add(found);
    return found;
  };

  /** Codes whose comparison exists only because the schema filled a dial in. */
  const defaulted: CubeFinding[] = [];
  const unstated = (code: CubeFindingCode): void => {
    for (const finding of findings) {
      if (finding.code === code && !spent.has(finding)) {
        spent.add(finding);
        defaulted.push(finding);
      }
    }
  };

  if (stated.size !== undefined) {
    claims.push(
      settled(
        'size',
        '',
        `the list holds ${String(criteria.size)} cards`,
        'cards',
        measurement.size,
        criteria.size,
        take('size', ''),
      ),
    );
  } else unstated('size');

  if (stated.seats !== undefined || stated.cardsPerSeat !== undefined) {
    const capacity = draftCapacity(criteria);
    claims.push(
      settled(
        'draft-capacity',
        '',
        `${String(criteria.seats)} seats draft ${String(criteria.cardsPerSeat)} cards each`,
        'cards',
        measurement.size,
        capacity,
        take('draft-capacity', ''),
      ),
    );
  } else unstated('draft-capacity');

  if (stated.singleton !== undefined) {
    const limit = cubeCopyLimit(criteria);
    const worst = findings
      .filter((finding) => finding.code === 'copies')
      .sort((a, b) => b.measured - a.measured)[0];
    if (worst !== undefined) spent.add(worst);
    claims.push(
      settled(
        'copies',
        worst?.subject ?? '',
        criteria.singleton ? 'no card appears twice' : `no card appears more than ${String(limit)} times`,
        'copies',
        worst?.measured ?? limit,
        limit,
        worst,
      ),
    );
  } else unstated('copies');

  if (stated.colorBalanceTolerance !== undefined) {
    const colors = measuredColors(criteria);
    // Counted in cards rather than in the share the tolerance is written in,
    // because the finding is: `validateCube` reports which edge of the band was
    // crossed and how many cards away it is, and a claim that restated that in
    // shares would carry one unit in the pass case and another in the miss.
    const slots = colors.reduce(
      (sum, color) => sum + (measurement.colors.find((measured) => measured.color === color)?.cards ?? 0),
      0,
    );
    const even = slots / colors.length;
    for (const color of colors) {
      const cards = measurement.colors.find((measured) => measured.color === color)?.cards ?? 0;
      claims.push(
        settled(
          'color-balance',
          color,
          `${color} holds within ${String(criteria.colorBalanceTolerance)} of an even ${String(colors.length)}-color share of ${String(slots)} colored slots`,
          'cards',
          cards,
          even,
          take('color-balance', color),
        ),
      );
    }
  } else unstated('color-balance');

  for (const band of criteria.curve) {
    const label = bandLabel(band);
    const cards = measurement.curve
      .filter((point) => point.manaValue >= band.from && (band.to === null || point.manaValue <= band.to))
      .reduce((sum, point) => sum + point.cards, 0);
    claims.push(
      settled(
        'curve-band',
        label,
        `${label} holds between ${String(band.minCards)} and ${String(band.maxCards)} cards`,
        'cards',
        cards,
        band.minCards,
        take('curve-band', label),
      ),
    );
  }

  const untagged = options.untaggedReason;
  if (untagged !== undefined) {
    for (const finding of findings) {
      if (TAGGED_CODES.includes(finding.code)) spent.add(finding);
    }
  }

  for (const archetype of criteria.archetypes) {
    if (untagged !== undefined) {
      claims.push(
        unmeasuredClaim(
          'archetype-support',
          archetype.name,
          `${archetype.name} has ${String(archetype.minPlayable)} playable cards in ${archetype.colors.join('')}`,
          archetype.minPlayable,
          'cards',
          untagged,
        ),
      );
      if (archetype.minAvailability !== undefined) {
        claims.push(
          unmeasuredClaim(
            'archetype-availability',
            archetype.name,
            `${archetype.name} is assemblable by ${percentish(archetype.minAvailability)} of drafting seats`,
            archetype.minAvailability,
            'share',
            untagged,
          ),
        );
      }
      continue;
    }
    const measured = measurement.archetypes.find((entry) => entry.name === archetype.name);
    claims.push(
      settled(
        'archetype-support',
        archetype.name,
        `${archetype.name} has ${String(archetype.minPlayable)} playable cards in ${archetype.colors.join('')}`,
        'cards',
        measured?.playable ?? 0,
        archetype.minPlayable,
        take('archetype-support', archetype.name),
      ),
    );

    const minShare = archetype.minAvailability;
    if (minShare === undefined) continue;
    const statement = `${archetype.name} is assemblable by ${percentish(minShare)} of drafting seats`;
    if (availability === null || availability.kind === 'unmeasured') {
      claims.push(
        unmeasuredClaim(
          'archetype-availability',
          archetype.name,
          statement,
          minShare,
          'share',
          availability === null
            ? 'the list was measured without a draft being asked for'
            : availability.reason,
        ),
      );
      continue;
    }
    const drafted = availability.archetypes.find((entry) => entry.name === archetype.name);
    const abstained = take('archetype-availability-abstained', archetype.name);
    const missed = take('archetype-availability', archetype.name);
    // Not `settled`: that helper adopts the finding's own two numbers, and this
    // is the one capability whose finding is counted in another unit. The miss
    // is in seat-drafts because a count ranks and sums beside the other
    // findings, and the abstention is in castable spells because that is the
    // comparison it is actually reporting. The claim was stated as a share, so
    // a share is what it keeps — except when abstaining, where the share is not
    // the number being argued about and saying so is the whole point.
    if (abstained !== undefined) {
      claims.push({
        capability: 'archetype-availability',
        subject: archetype.name,
        statement,
        status: 'abstained',
        measured: abstained.measured,
        required: abstained.required,
        distance: abstained.measured - abstained.required,
        unit: 'cards',
        detail: abstained.detail,
      });
      continue;
    }
    const share = drafted?.share ?? 0;
    claims.push({
      capability: 'archetype-availability',
      subject: archetype.name,
      statement,
      status: missed === undefined ? 'met' : 'missed',
      measured: share,
      required: minShare,
      distance: share - minShare,
      unit: 'share',
      detail: missed?.detail ?? `${statement}, and it does`,
    });
  }

  return {
    claims,
    unclaimed: findings.filter((finding) => !spent.has(finding)),
    reported: defaulted,
    limits: limitsFor(availability),
    draftProvenance:
      availability !== null && availability.kind === 'measured'
        ? {
            seed: availability.seed,
            drafts: availability.drafts,
            seatDrafts: availability.seatDrafts,
            botPolicy: availability.botPolicy,
          }
        : null,
    ok:
      claims.every((claim) => claim.status !== 'missed') &&
      !findings.some((finding) => unclaimedBlocks(finding, spent)),
  };
}

function unclaimedBlocks(finding: CubeFinding, spent: ReadonlySet<CubeFinding>): boolean {
  return !spent.has(finding) && finding.code !== 'archetype-availability-abstained';
}

function limitsFor(availability: CubeAvailability | null): ClaimLimits {
  if (availability === null) return { kind: 'not-attempted', limits: [] };
  if (availability.kind === 'measured') return { kind: 'shares-measured', limits: DEAL_LIMITS };
  return { kind: 'not-drafted', limits: REFUSAL_LIMITS };
}

/** A capability nothing checked. The reason is carried; a number never is. */
function unmeasuredClaim(
  capability: CubeFindingCode,
  subject: string,
  statement: string,
  required: number,
  unit: ClaimUnit,
  detail: string,
): Claim {
  return {
    capability,
    subject,
    statement,
    status: 'unmeasured',
    measured: null,
    required,
    distance: null,
    unit,
    detail,
  };
}

/**
 * A claim both of whose numbers exist: met unless a finding says otherwise.
 *
 * When there is a finding, **its** two numbers win over the ones computed here.
 * `validateCube` already decided which edge of a stated range was missed — the
 * top of a curve band, the far side of a color tolerance — and recomputing the
 * comparison against the bottom of the range would report a distance with the
 * wrong sign for exactly the claims that failed.
 */
function settled(
  capability: CubeFindingCode,
  subject: string,
  statement: string,
  unit: ClaimUnit,
  measured: number,
  required: number,
  finding: CubeFinding | undefined,
): Claim {
  const against =
    finding === undefined
      ? { measured, required }
      : { measured: finding.measured, required: finding.required };
  return {
    capability,
    subject,
    statement,
    status: finding === undefined ? 'met' : 'missed',
    measured: against.measured,
    required: against.required,
    distance: against.measured - against.required,
    unit,
    detail: finding?.detail ?? `${statement}, and it does`,
  };
}

/** `0.25` → `25%`, without pretending to more precision than was stated. */
function percentish(share: number): string {
  return `${String(Math.round(share * 1000) / 10)}%`;
}
