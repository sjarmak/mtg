/**
 * Archetype viability as a set-level gate.
 *
 * The reservation pass makes the ten pairs playable in the *plan*; this asserts
 * the printed set kept the bargain. The two run the same arithmetic
 * (`archetype/viability.ts`) over the same shape, so a failure here always means
 * a card deviated from the slot it was designed for — a removal slot that
 * printed the tap half of its role, a modal slot that chose the cantrip mode —
 * and that is exactly the kind of failure targeted regeneration can fix.
 *
 * Every finding names slots the retry loop can act on. A curve gap blames the
 * slots whose own mana-value window covers the starved bucket, because those are
 * the only cards that could legally move there.
 */
import type { CurveBucket } from '@mtg/deckbuild';
import { curveBucket } from '@mtg/deckbuild';
import type { SkeletonLiteProfile } from '@mtg/design-data';
import type { ArchetypeFloors, ArchetypePlan, PairViability, ViabilityShortfall } from '../archetype/index';
import {
  assessArchetypes,
  cardContribution,
  DEFAULT_ARCHETYPE_FLOORS,
  pairCapacity,
  WARNING_SHORTFALLS,
} from '../archetype/index';

export { pairCapacity };
import type { Entry } from './composition';
import type { FindingCode, SetFinding } from './findings';
import { finding } from './findings';

const CODE_FOR: Readonly<Record<ViabilityShortfall['kind'], FindingCode>> = {
  depth: 'ARCHETYPE_THIN',
  undifferentiated: 'ARCHETYPE_UNDIFFERENTIATED',
  creatures: 'ARCHETYPE_NO_BODIES',
  removal: 'ARCHETYPE_NO_ANSWERS',
  removalThin: 'ARCHETYPE_THIN_ANSWERS',
  inert: 'ARCHETYPE_INERT_GLUT',
  signpost: 'ARCHETYPE_NO_SIGNPOST',
  signpostShared: 'ARCHETYPE_SIGNPOST_SHARED',
  signpostPayoff: 'ARCHETYPE_SIGNPOST_OFF_PLAN',
  curveEmpty: 'ARCHETYPE_CURVE_HOLE',
  curveGap: 'ARCHETYPE_CURVE_GAP',
};

function inPair(entry: Entry, plan: ArchetypePlan): boolean {
  return entry.card.colors.every((color) => plan.colors.includes(color));
}

/** Slots that could legally have printed at `bucket` but did not. */
function movableTo(entries: readonly Entry[], plan: ArchetypePlan, bucket: CurveBucket): string[] {
  return entries
    .filter(
      (entry) =>
        inPair(entry, plan) &&
        curveBucket(entry.slot.manaValueMin) <= bucket &&
        curveBucket(entry.slot.manaValueMax) >= bucket,
    )
    .map((entry) => entry.slot.id);
}

function blameFor(
  shortfall: ViabilityShortfall,
  report: PairViability,
  entries: readonly Entry[],
  plan: ArchetypePlan,
): readonly string[] {
  switch (shortfall.kind) {
    case 'inert':
      return report.inertSlotIds;
    // The reserved slot, not the signpost list: a card that failed the color
    // test is gone from the latter, and it is still the card whose vocabulary a
    // retry can repair.
    case 'signpost':
    case 'signpostPayoff':
      return report.reservedSignpostSlotIds;
    case 'removal':
    case 'removalThin':
      // The slots that were allowed to print an answer and did not.
      return entries
        .filter(
          (entry) =>
            inPair(entry, plan) &&
            entry.slot.cardKind !== 'creature' &&
            entry.slot.effectKinds.some((kind) => kind === 'destroyPermanent' || kind === 'dealDamage'),
        )
        .map((entry) => entry.slot.id);
    case 'curveEmpty':
    case 'curveGap':
      return shortfall.bucket === undefined ? [] : movableTo(entries, plan, shortfall.bucket);
    // Facts about the pool rather than about a card. No slot is to blame for a
    // pool being too shallow or too short of bodies, and no slot can be
    // regenerated into the gold card a pair with nothing of its own is missing.
    case 'depth':
    case 'creatures':
    case 'undifferentiated':
    case 'signpostShared':
      return [];
    default:
      return [];
  }
}

export interface ArchetypeCheckInput {
  readonly entries: readonly Entry[];
  readonly plans: readonly ArchetypePlan[];
  readonly profile: SkeletonLiteProfile;
  readonly floors?: ArchetypeFloors;
}

export function checkArchetypeViability(input: ArchetypeCheckInput): SetFinding[] {
  const { entries, plans, profile } = input;
  const floors = input.floors ?? DEFAULT_ARCHETYPE_FLOORS;
  const capacity = pairCapacity(profile);
  if (capacity < floors.playables) {
    // Under the metrics package's discipline: a set too small to build ten
    // Limited decks from abstains and says so, rather than failing ten times.
    return [
      finding(
        'ARCHETYPE_UNDERSIZED',
        'warning',
        `a ${profile.setSize}-card set gives a colour pair at most ${capacity} playables, under the ${floors.playables} a Limited deck needs; per-pair viability is not judged`,
      ),
    ];
  }
  const reports = archetypeReports(entries, plans, floors);
  return reports.flatMap((report) => {
    const plan = plans.find((item) => item.pair === report.pair);
    if (plan === undefined) return [];
    return report.shortfalls.map((shortfall) =>
      finding(
        CODE_FOR[shortfall.kind],
        WARNING_SHORTFALLS.has(shortfall.kind) ? 'warning' : 'error',
        `archetype ${report.pair}: ${shortfall.detail}`,
        blameFor(shortfall, report, entries, plan),
      ),
    );
  });
}

/** The per-pair structural report, for the generation report and for tests. */
export function archetypeReports(
  entries: readonly Entry[],
  plans: readonly ArchetypePlan[],
  floors: ArchetypeFloors = DEFAULT_ARCHETYPE_FLOORS,
): readonly PairViability[] {
  const contributions = entries.map((entry) => cardContribution(entry.slot, entry.card));
  return assessArchetypes(contributions, plans, floors);
}
