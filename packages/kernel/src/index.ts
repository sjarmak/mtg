/**
 * `@mtg/kernel` — the event-sourced rules kernel.
 *
 * The whole engine is one pure function, `reduce(state, action)`, plus the
 * query surface agents need to choose an action. State is immutable, forking is
 * O(1), and the RNG lives inside the state, so a seed plus a choice sequence
 * replays byte-identically.
 */

export type { PlayerId, ObjectId } from './ids';
export { abilityObjectId, objectId, PLAYER_IDS, opponentOf } from './ids';

export type { RngState } from './rng';
export { createRng, nextBelow, nextFloat, nextUint32, shuffle } from './rng';

export type {
  Attack,
  AwaitKind,
  Block,
  CombatState,
  CombatDefender,
  GameConfig,
  GameEndReason,
  GameObject,
  GameResult,
  GameState,
  ManaColor,
  ManaPool,
  Phase,
  PlayerState,
  AbilityOnStack,
  RegisteredCostModifier,
  StackEntry,
  SourceCharacteristics,
  Step,
  Target,
  TriggerContext,
  TurnState,
  ZoneId,
} from './state';
export {
  EMPTY_COMBAT,
  EMPTY_MANA_POOL,
  isDraw,
  isGameOver,
  isMainPhase,
  MANA_COLORS,
  PHASE_OF,
  STEPS,
} from './state';

export type { DamageTarget, DestroyReason, GameEvent, GameEventType, LifeChangeReason } from './events';
export { eventsOfType, serializeEvents } from './events';

export type {
  Action,
  ActionType,
  AttackDeclaration,
  BlockDeclaration,
  BlockerOrdering,
  DeclarationAction,
} from './actions';
export { asDeclaration, IllegalActionError } from './actions';

export type { ReduceResult } from './reduce';
export { reduce, reduceAll, settle } from './reduce';

// CR 301.5 / 702.6 attachment: what an Equipment is attached to, and the
// continuous effect being attached registers. There is no attachment-aware
// branch in the layer walk; `attach.ts` says why.
export {
  attachmentOf,
  hasAuraModification,
  illegalAttachments,
  isLegalAuraHost,
  isLegalHost,
} from './attach';

export type { BlockCandidates, Decision } from './legal';
export { asksInSteps, legalActions, pendingDecision, satisfyMustBeBlocked, validateAction } from './legal';

export { driveDeclaration, lastDeclarationOption } from './drive-declaration';

// What each target slot of an object may be aimed at: one enumeration for a
// spell being cast, an ability being activated and a trigger being put on the
// stack, because the rules differ about when the choice is made and about
// nothing else.
export {
  everySlotHasAChoice,
  targetChoicesFor,
  targetChoicesForActivation,
  targetChoicesForEffects,
} from './target-choices';
export { satisfiesTargetRestriction } from './target-restrictions';
// The filter half of the same question (mtg-6y4g). Exported beside the
// restriction because a caller that wants to know whether a target is legal
// wants both, and `isAttacking`/`isBlocking` come with them because the combat
// dimension is the one a filter cannot answer off characteristics alone.
export {
  isAttacking,
  isBlocking,
  satisfiesTargetFilter,
  spellSatisfiesFilter,
  targetObjectFilter,
} from './target-filter';

export type { Enumerated } from './enumerate';
export {
  cartesian,
  combinations,
  DEFAULT_ENUMERATION_CAP,
  distinctPermutations,
  permutations,
  subsets,
} from './enumerate';

// CR 613 continuous effects: the data model, the layer walk, and the 613.8
// dependency pass. `continuous.ts` is what a caller builds; `layers.ts` is what
// the kernel reads; nothing writes a derived characteristic onto an object.
export type {
  AbilityChangeEffect,
  BattlefieldCount,
  ColorChangeEffect,
  ContinuousEffect,
  CopyEffect,
  ControlEffect,
  CounterKind,
  Counters,
  EffectDuration,
  EffectLayer,
  GraveyardCardTypesCount,
  Layer,
  ObjectFilter,
  PtCount,
  PtDefiningEffect,
  PtModEffect,
  PtSetEffect,
  PtSwitchEffect,
  TextChangeEffect,
  TypeChangeEffect,
} from './continuous';
export {
  addCounters,
  annihilateCounters,
  ANY_PERMANENT,
  counterCount,
  counterKeywords,
  counterStatDelta,
  hasCounters,
  isCharacteristicDefining,
  NO_COUNTERS,
  objectFilter,
  onlyObject,
  setCounterCount,
} from './continuous';

export type {
  CharacteristicMap,
  Characteristics,
  EffectApplication,
  LayerContext,
  LayerDerivation,
} from './layers';
export {
  affectedByEffect,
  characteristicsOf,
  conditionHolds,
  controlledBy,
  controllerOf,
  deriveLayers,
  derivedCharacteristics,
  effectsApplyingTo,
  hasCardType,
  hasGrantableKeyword,
  hasKeyword,
  hasKeywordAbility,
  hasSubtype,
  isCreatureCharacteristics,
  isCreatureObject,
  keywordAbilitiesOf,
  LAYER_ORDER,
  matchesFilter,
  powerOf,
  printedCharacteristics,
  selectMatching,
  startingLoyaltyOf,
  toughnessOf,
} from './layers';

export { dependencyGraph, orderLayer, timestampOrder } from './dependency';

// A second, weaker selector for the zones CR 611.2c does not reach: printed
// values only, no layer walk. `ObjectFilter` (`continuous.ts`) stays the
// battlefield/stack-only, layers-aware path; this is graveyard, hand and
// library's answer to the same question, and today only the graveyard arm is
// wired up (`zone-filter.ts`'s own docblock says why).
export type { PrintedFilter } from './zone-filter';
export { ANY_CARD, graveyardMembers, printedFilter, selectPrinted } from './zone-filter';

// The group a one-shot effect scope names. Exported alone out of `effects.ts`,
// which is otherwise the kernel's business: a policy that wants to know what a
// sweep would hit has to ask the same function the resolution asks, or it is
// scoring a different spell.
export { objectsInEffectScope, scopedGroup } from './effects';

// CR 113 printed abilities, in two shapes that share nothing but the word.
// A static ability compiles to continuous effects and to nothing else, so it
// has no subsystem — only the compiler and the two points that register and
// drop its output. A triggered ability holds no state at all: `triggers.ts`
// reads the printed card when an event meets its condition and puts an object
// on the stack.
export type { StaticRegistration } from './abilities';
export {
  abilityAt,
  activatedAbilityAt,
  effectsRegisteredBy,
  registerStatics,
  staticEffectsFor,
} from './abilities';
export type { PendingTrigger } from './triggers';
export { collectTriggers, putTriggersOnStack } from './triggers';

// CR 603.3d's targets and CR 603.3b's "you may": the two decisions a triggered
// ability can owe, derived from the stack rather than recorded on it.
export type { TriggerOnStack } from './trigger-choice';
export {
  optionalTriggerOnTop,
  removeTriggersWithoutTargets,
  triggerAwaitingTargets,
  triggerHasLegalTargets,
  triggerOf,
  triggerOnStack,
  triggerTargetChoices,
} from './trigger-choice';

// CR 601.2c's "you may" on a spell — `trigger-choice.ts`'s pattern widened
// from a triggered ability's controller to whichever player the card names.
export type { SpellOnStack } from './may-choice';
export { mayChooser, spellAwaitingMay } from './may-choice';
export type { TolledSpellOnStack } from './unless-choice';
export { spellAwaitingUnless, unlessPayer } from './unless-choice';

// CR 614/615/616 replacement and prevention effects.
export type {
  DamageRecipient,
  ReplaceableEvent,
  ReplaceableEventKind,
  ReplacementEffect,
  ReplacementModification,
  ReplacementTrigger,
} from './replacement-effects';
export { subjectOf, triggerMatches } from './replacement-effects';

export type { ReplacementChooser, ReplacementOutcome } from './replacement';
export {
  affectedPlayerFor,
  applyReplacements,
  chooseInOrder,
  earliestTimestamp,
  replaceEvent,
} from './replacement';

export type { PaymentPlan } from './mana';
export {
  addMana,
  availableMana,
  canPay,
  landProduces,
  payFromPool,
  planPayment,
  poolTotal,
  producibleColors,
} from './mana';

export type { CostModifierRegistration } from './cost';
export { costModifiersRegisteredBy, effectiveManaCost, maxPayableX, registerCostModifiers } from './cost';

export type { BlockAssignment } from './combat';
export {
  assignAttackerDamage,
  attackersNeedingOrder,
  canBlock,
  combatNeedsFirstStrikeStep,
  combatDefenders,
  dealCombatDamage,
  eligibleAttackers,
  eligibleBlockers,
  groupBlocks,
  hasCombatModification,
  isBlocked,
  isLegalCombatDefender,
  lethalDamageFor,
  validateBlocks,
} from './combat';

export type { DamageInstance } from './damage';
export { applyDamage, gainLife, markedDamage } from './damage';
export { loseLife, setLife } from './life';
export type { StaticReplacementRegistration } from './static-replacements';
export {
  registerStaticReplacements,
  staticReplacementsFor,
  staticReplacementsRegisteredBy,
} from './static-replacements';
export { createRegenerationShield, destroyPermanent, sacrificePermanent } from './destruction';
export { canBeTargetedBy, isProtectedFrom } from './keyword-abilities';

export type { LegendCollision } from './sba';
export { checkStateBasedActions, endGameWith, keepLegend, pendingLegendCollision } from './sba';

export { advanceStep, cleanupTurnEffects, enterStep, givePriority, nextStepAfter } from './turn';

export {
  battlefieldObjects,
  createToken,
  creaturesControlledBy,
  creaturesOnBattlefield,
  drawCard,
  drawCards,
  exileGraveyard,
  getObject,
  isOnBattlefield,
  landsControlledBy,
  millCards,
  moveObject,
  putOnLibrary,
  revealTopCards,
  shuffleGraveyardIntoLibrary,
  shuffleLibrary,
  tapObject,
  tryObject,
  untapObject,
  updateObject,
} from './zones';

export { copySpellOnStack, pushAbility, resolveAnswered, resolveTop, topOfStack } from './stack';

export { MAX_CHOSEN_X } from '@mtg/dsl';

export type { Trace } from './trace';
export { beginTrace, emit, playerOf, updatePlayer, withState } from './trace';

export type { DeckList, GameSetup } from './setup';
export { createGame, DEFAULT_CONFIG } from './setup';

// CR 103.4, the London mulligan: the one decision asked before turn 1.
// `mulligan.ts` owns the whole phase, including when it ends.
export { canMulligan, cardsToBottom, nextMulliganPlayer } from './mulligan';

export type { ScenarioPermanent, ScenarioSpec } from './scenario';
export { advanceToStep, scenario } from './scenario';

export type { Snapshot } from './fork';
export { deepCopy, fork, restore, snapshot, stateFingerprint } from './fork';

// CR 400.2 one layer up: what a seat may see of a position. A concealed state
// is a value to look at and never one to reduce — `visibility.ts` argues why
// concealment belongs here rather than in the viewer that used to do it, and
// `test/visibility.test.ts` reads the tree to keep it off the replay path.
export {
  concealedFrom,
  HIDDEN_ZONES,
  isHiddenZone,
  publiclyIdentified,
  seatEvent,
  seatEvents,
  seatState,
} from './visibility';

export type { AgentView, PlayerAgent } from './agent';
export { functionAgent, randomAgent, scoringAgent, scriptedAgent } from './agent';
export { simpleAgent } from './simple-agent';

export type { GameRun, PlayOptions } from './game';
export { playGame, playOut } from './game';

export type { Choice, GameSession, Seat, SessionOptions, SessionView } from './session';
export {
  ActionNotEnumeratedError,
  advance,
  botSeat,
  canUndo,
  choose,
  chooseAction,
  createSession,
  humanSeat,
  humanSeats,
  replaySession,
  seatName,
  undo,
  UndoRefusedError,
  undoTo,
  yieldPriority,
} from './session';

// Where undo stops. A boundary is read off the event log rather than off the
// position, so like a stop set it is interface policy and never `GameState`;
// `undo.ts` names the six events that close one and argues each.
export type { CommitReason, Commitment } from './undo';
export { commitmentAfter, commitPoint, commits } from './undo';

// Two actions are one move. `chooseAction` needs it to find a constructed
// action's index; a UI that wants to know whether the move it is assembling is
// already on offer needs the same answer, and a second comparison would be a
// second opinion about what a move is.
export { actionKey, canonicalAction, indexOfAction, sameAction } from './action-identity';

// The other half of that answer, for the one action whose spelling is a fact
// about the board rather than about the action. `canonicalAction` folds the
// lists the rules treat as sets; two blockers being one slot in a damage
// assignment order needs the position to decide, so a surface that builds an
// ordering and wants the index the kernel would record has to settle it first —
// which is exactly `chooseAction`'s own first step. `damage-order.ts` argues it.
export { settledAction } from './damage-order';

// Which priorities a human seat is asked about. Interface policy, not game
// state: it rides in `SessionOptions`, never in `GameState`, and an auto-passed
// priority is recorded as the choice it is. `autopass.ts` carries the argument.
export type { AutoPassSettings, StopSet, TurnSide, YieldBoundary } from './autopass';
export {
  settledChoice,
  canRespond,
  DEFAULT_AUTO_PASS,
  DEFAULT_STOPS,
  FULL_CONTROL,
  hasStop,
  holdsOwnTopOfStack,
  isStopped,
  opposingStack,
  passIndex,
  reachedBoundary,
  sideFor,
  STOPPABLE_STEPS,
  stopWantsAQuestion,
  toggleStop,
  unstoppedPassChoice,
  withFullControl,
  withPassUnstopped,
} from './autopass';

// Where the settle loop pauses so a person can see a combat happen. A pause, not
// a stop: it asks nothing and records nothing, so it is invisible to the choice
// log and to `stateFingerprint`. `beats.ts` carries the argument and why the
// obvious fix — a stop on the damage step — could not be one.
export type { Beat, BeatKind, BeatSet, CombatBeat, Departure, DepartureZone } from './beats';
export { ALL_BEATS, beatIn, COMBAT_BEATS, DEFAULT_BEATS, NO_BEATS, stepShowsBeat } from './beats';

// The kernel as one backend behind `@mtg/engine`'s neutral contract (ADR-0001
// §9). An adapter and nothing more: every question goes through `createSession`,
// `choose` and `replaySession`, so there is one enforcement path whichever door
// a game was played through. `backend.ts` names the three things it deliberately
// does not carry across — the constructed-action door, beats, and stops.
export type { ContentResolver, KernelBackendOptions } from './backend';
export { KERNEL_BACKEND_ID, kernelBackend } from './backend';
