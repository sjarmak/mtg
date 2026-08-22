/**
 * Archetype viability, in four steps: plan the ten pairs, reserve the slots they
 * need, tag those slots, then assert the printed set kept the bargain.
 */
export {
  ARCHETYPE_PAIRS,
  archetypeKey,
  planArchetypes,
  plansForColor,
  plansHostedBy,
  SIGNPOSTS_PER_COLOR,
  signpostHosts,
} from './pairs';
export type { ArchetypePlan, ColorPair } from './pairs';

export {
  ANSWER_EFFECTS,
  BATTLEFIELD_INERT_EFFECTS,
  cardContribution,
  exclusiveTo,
  isInertEffect,
  playableIn,
  slotContribution,
} from './contribution';
export type { Contribution } from './contribution';

export {
  assessArchetypes,
  assessPair,
  DEFAULT_ARCHETYPE_FLOORS,
  formatViability,
  inDeck,
  pairCapacity,
  WARNING_SHORTFALLS,
} from './viability';
export type { ArchetypeFloors, PairViability, ShortfallKind, ViabilityShortfall } from './viability';

export { inertCapPerColor, isInertRole, reserveAnswers, reserveArchetypes } from './reserve';
export type { AnswerReservation, ArchetypeReservation, SupportReservation } from './reserve';

export { assignArchetypes } from './assign';
export type { ArchetypeAssignmentInput, AssignmentResult, MechanicsFor } from './assign';
