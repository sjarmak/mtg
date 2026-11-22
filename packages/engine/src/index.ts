/**
 * `@mtg/engine` — the backend-neutral session contract.
 *
 * One interface that `@mtg/kernel` and a foreign rules engine can both sit
 * behind, so a play surface does not know which it is talking to. ADR-0001 §9
 * is the decision this implements and carries the argument for why the lab needs
 * a second runtime at all; `determinism.ts` carries the argument for the shape,
 * which is the part worth reading before using any of this.
 *
 * **This package depends on nothing.** Not on `@mtg/kernel`, not on `@mtg/dsl`,
 * not on a third-party library. A contract that imports one of its
 * implementations is that implementation's description, and the next backend
 * finds out the expensive way. The kernel's adapter lives in `@mtg/kernel`,
 * which imports this; the arrow points one way and stays that way.
 *
 * Three things shipped here are not types. `conformance.ts` holds every backend
 * to the seam. `labels.ts` is the one rule about a *surface* that turned out to
 * be a function of the projection, so every backend gets it without knowing it
 * exists. `stub.ts` is a toy backend on the observed arm, which exists so
 * `checkBackend` has a second subject and so the claim above is checked rather
 * than asserted.
 */

export type {
  CardOrigin,
  ContentRef,
  DeckSlot,
  DeckRef,
  GameVariant,
  MatchResult,
  MatchRules,
  PerSeat,
  SeatController,
  SeatId,
  SeatSpec,
  SessionSpec,
} from './table';
export {
  COMMANDER_RULES,
  MOMIR_RULES,
  MIN_SEATS,
  STANDARD_RULES,
  isSeatId,
  matchRulesRefusals,
  perSeat,
  rulesOf,
  seatIdsOf,
  seatSpecOf,
} from './table';

export type { ObjectCharacteristics, ObjectView, SeatView, TableView, TurnView } from './projection';
export { PROJECTION_VERSION, seatViewOf } from './projection';

export type {
  DecisionInput,
  MoveId,
  MoveOption,
  MoveTarget,
  PendingDecision,
  TextDecisionInput,
} from './decision';
export { textSubmission, textValueOf } from './decision';

// Two legal moves must not read the same (`mtg-cee`). The half of that rule the
// projection can carry, with the residue marked on the label rather than left
// silent — `labels.ts` argues which half is which and why it is not a
// discriminant.
export type { MoveLabel } from './labels';
export { labelDecision } from './labels';

export type { EngineEvent, EngineReveal } from './events';

export type {
  ObjectMove,
  PlayAttackers,
  PlayDefender,
  PlayAutomaticMove,
  PlayAutomaticMoveReason,
  PlayCardOrder,
  PlayCombatDamageAssignment,
  PlayCombatDamageRecipient,
  PlayInteraction,
  PlayCardSelection,
  PlayCardSelectionZone,
  PlayManaOutput,
  PlayManaPool,
  PlayObjectActionCategory,
  PlayPromptRole,
  StandardTurnStep,
} from './play';
export {
  PLAY_AUTOMATIC_MOVE_REASONS,
  PLAY_CARD_SELECTION_ZONES,
  PLAY_MANA_OUTPUTS,
  PLAY_OBJECT_ACTION_CATEGORIES,
  PLAY_PROMPT_ROLES,
  STANDARD_TURN_STEPS,
} from './play';

export type {
  ContentUnsupportedError,
  OpenResult,
  SessionError,
  SessionErrorKind,
  SubmitResult,
} from './errors';
export { describeSessionError } from './errors';

// The split, and the whole reason this package is not one file. Determinism is
// a discriminant rather than a capability flag, because a flag can be forgotten
// and a missing member cannot.
export type { BackendCapabilities, Determinism, SessionRecord, TranscriptFrame } from './determinism';

export type {
  BackendBase,
  EngineSession,
  GameBackend,
  ObservedBackend,
  ObservedSession,
  RecordedBackend,
  RecordedSession,
  SessionBase,
  SessionStatus,
} from './session';
export { isRecorded, isRecordedSession } from './session';

// Selection is explicit policy over the neutral contract: one route, one
// backend, and no search-based fallback.
export type { BackendRoutes, BackendSelection, BackendSelectionError } from './selection';
export { routeBackend } from './selection';

// Per-seat projection: a member that can be absent rather than a boolean beside
// a method, for the reason `seats.ts` argues. A surface that must not leak says
// `ProjectingSession` in its signature.
export type { ProjectingSession, SeatProjection } from './seats';
export { projectsPerSeat } from './seats';

export type { ConformanceOptions, Finding } from './conformance';
export { checkBackend } from './conformance';

// The payload search on its own, so a backend package can ask it about one
// position it built by hand. `checkBackend` walks a whole game and takes what it
// is dealt; a backend that wants to prove a *named* position — a card bounced
// back into a hand, a reveal replayed at every later position — has to be able
// to hand it that position and nothing else.
export type { PositionMemo, SeatAudit } from './hidden-information';
export { auditSeatPayloads } from './hidden-information';

export type { ScriptOptions } from './stub';
export { scriptBackend } from './stub';
