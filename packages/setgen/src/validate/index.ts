/**
 * Deterministic set validation: the whole gate, in one call.
 *
 * Order matters for readability of the report: the skeleton first (`fillable.ts`
 * is the one check that reads no card, and a slot that permits no card explains
 * every card-level finding under it), then per-slot legality (a card that is not
 * a legal DSL card cannot meaningfully be judged on curve), then per-slot
 * conformance and color pie, then everything that only exists across the set.
 * Nothing here makes a semantic judgment — power level, flavor and cohesion
 * belong to the critique pass (ZFC).
 */
import type { Card, Violation } from '@mtg/dsl';
import type { Allocation } from '../allocate';
import type { Slot } from '../slot';
import type { Entry } from './composition';
import {
  checkCreatureShare,
  checkCurve,
  checkDuplicateNames,
  checkMechanicCoverage,
  checkMechanicKeywordUnprinted,
  checkRarityTotals,
  checkRequiredCards,
  checkSetUniqueness,
  checkStatedRoles,
  checkTokenNames,
} from './composition';
import { checkCardViolations, checkSlotConformance, checkUnfilled } from './conformance';
import { checkSlotFillability } from './fillable';
import { checkMechanicsPrinted, checkSacrificeSupply, checkTokenDemand } from './mechanics';
import { checkCardRate, checkStatFloor } from './rate';
import { checkBlankCards, checkDesignRepeats } from './template';
import type { PairViability } from '../archetype/index';
import { archetypeReports, checkArchetypeViability } from './archetype';
import type { SetFinding } from './findings';
import { errors, failingSlotIds } from './findings';
import type { NwoResult } from './nwo';
import { checkNewWorldOrder } from './nwo';
import type { TertiaryUsage } from './pie';
import { checkCardPie, checkTertiaryBudget, tertiaryUsage } from './pie';

export * from './findings';
export * from './nwo';
export * from './pie';
export {
  checkCreatureShare,
  checkCurve,
  checkDuplicateNames,
  checkMechanicCoverage,
  checkMechanicKeywordUnprinted,
  checkRarityTotals,
  checkRequiredCards,
  checkSetUniqueness,
  checkStatedRoles,
  checkTokenNames,
  planFor,
} from './composition';
export type { Entry } from './composition';
export { checkCardViolations, checkSlotConformance, checkUnfilled } from './conformance';
export { checkSlotFillability, unfillableSlots } from './fillable';
export {
  checkMechanicsPrinted,
  checkSacrificeSupply,
  checkTokenDemand,
  partCountersCreatedBy,
  subtypesCreatedBy,
  unprintedMechanics,
  unspentTokens,
} from './mechanics';
export type { UnprintedMechanic, UnspentToken } from './mechanics';
export {
  TEMPLATE_CYCLE_BUDGET,
  checkBlankCards,
  checkDesignRepeats,
  designTemplate,
  isBlankCard,
} from './template';
// Two gates that report and do not block: they are exported, tested, and run by
// hand against committed sets, and deliberately absent from
// `validateGeneratedSet` below.
//
// Wiring them was tried on 2026-08-17 and reverted the same hour, which is worth
// recording because the reason is not "the findings were wrong". Both real sets
// are clean under them. What is not clean is the *recorded* Tideglass run:
// adding an error-severity finding to the validator puts its slots into the
// regeneration loop, the loop asks the model for a replacement card, and the
// fixture provider has no recording of that request. `recorded-set.test.ts`,
// `critic/pool.test.ts` and the whole `@mtg/slice` end-to-end then fail with
// `FixtureMissingError`, and the only way to make them pass again is a paid
// generation run. So a new error-severity gate cannot be wired into
// `validateGeneratedSet` in isolation; it has to land with a re-recording, and
// that is a spend rather than a refactor.
//
// If they are wired later, they are not equal in weight. `OFF_SIGNATURE` and
// `FUNCTIONAL_REPRINT_SPREAD` are errors — the first reports a card off the
// brief's own stated color signature, the second the shape that printed one
// removal effect at eight different prices. `FUNCTIONAL_REPRINT_GLUT` stays a
// warning permanently: how many times a set may print one effect varies by
// effect and by set, so the count belongs in a report a designer reads.
export {
  DEFAULT_REPRINT_POLICY,
  checkFunctionalReprints,
  effectSignature,
  reprintFindings,
  reprintGroups,
} from './reprint';
export type { ReprintGroup, ReprintPolicy } from './reprint';
export { checkColorSignature, offSignatureSubjects, signatureFindings } from './signature';
export type { OffSignature } from './signature';
export {
  RATE_CEILING,
  RATE_CEILING_BOMB,
  STAT_FLOOR,
  cardRate,
  checkCardRate,
  checkStatFloor,
  statFloor,
} from './rate';
export { archetypeReports, checkArchetypeViability, pairCapacity } from './archetype';
export type { ArchetypeCheckInput } from './archetype';

export interface ValidationInput {
  readonly allocation: Allocation;
  /** Cards that assembled cleanly, keyed by slot id. */
  readonly cards: ReadonlyMap<string, Card>;
  /** Why a slot has no card: the violations its last candidate produced. */
  readonly rejected?: ReadonlyMap<string, readonly Violation[]>;
  readonly tertiaryBudget: number;
}

export interface SetValidation {
  readonly findings: readonly SetFinding[];
  readonly entries: readonly Entry[];
  readonly nwo: NwoResult;
  readonly tertiary: readonly TertiaryUsage[];
  /** Per-color-pair structural report; ten rows, one per archetype. */
  readonly archetypes: readonly PairViability[];
  /** Slots to regenerate; empty means the set passed every deterministic gate. */
  readonly failingSlotIds: readonly string[];
  readonly ok: boolean;
}

export function validateGeneratedSet(input: ValidationInput): SetValidation {
  const { allocation, cards, tertiaryBudget } = input;
  const rejected = input.rejected ?? new Map<string, readonly Violation[]>();

  const entries: Entry[] = [];
  // First, and about the skeleton rather than about any card: a slot that permits
  // no card at all explains every card-level finding under it, and reading it
  // after them reads as a set of bad cards rather than as a bad allocation.
  const findings: SetFinding[] = [...checkSlotFillability(allocation.slots)];
  const tertiary: TertiaryUsage[] = [];

  for (const slot of allocation.slots) {
    const card = cards.get(slot.id);
    if (card === undefined) {
      findings.push(...unfilledFindings(slot, rejected.get(slot.id)));
      continue;
    }
    entries.push({ slot, card });
    findings.push(...checkSlotConformance(slot, card), ...checkCardPie(slot, card));
    tertiary.push(...tertiaryUsage(slot, card));
  }

  const nwo = checkNewWorldOrder(entries, allocation.profile.nwoRedFlagBudget);
  findings.push(
    ...checkTertiaryBudget(tertiary, tertiaryBudget),
    ...nwo.findings,
    ...checkCurve(entries, allocation.profile),
    ...checkCreatureShare(entries, allocation.profile),
    ...checkRarityTotals(entries, allocation.profile),
    ...checkDuplicateNames(entries),
    ...checkSetUniqueness(entries),
    ...checkTokenNames(entries),
    ...checkDesignRepeats(entries, allocation.profile.rarityRules),
    ...checkBlankCards(entries, allocation.profile.rarityRules),
    ...checkCardRate(entries, allocation.profile.rarityRules),
    ...checkStatFloor(entries),
    ...checkMechanicCoverage(entries, allocation.brief.mechanics),
    ...checkMechanicKeywordUnprinted(entries, allocation.slots, allocation.brief.mechanics),
    ...checkMechanicsPrinted(entries, allocation.brief.mechanics),
    ...checkRequiredCards(entries, allocation.slots, allocation.brief.requiredCards),
    ...checkStatedRoles(entries, allocation.slots, allocation.brief.spellRoles),
    ...checkSacrificeSupply(entries),
    ...checkTokenDemand(entries),
    ...checkArchetypeViability({
      entries,
      plans: allocation.archetypes,
      profile: allocation.profile,
    }),
  );

  return {
    findings,
    entries,
    nwo,
    tertiary,
    archetypes: archetypeReports(entries, allocation.archetypes),
    failingSlotIds: failingSlotIds(findings),
    ok: errors(findings).length === 0,
  };
}

function unfilledFindings(slot: Slot, violations: readonly Violation[] | undefined): SetFinding[] {
  if (violations === undefined || violations.length === 0) return [checkUnfilled(slot)];
  return checkCardViolations(slot, violations);
}
