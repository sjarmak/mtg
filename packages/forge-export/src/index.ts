/**
 * `@mtg/forge-export` — DSL -> Forge card scripts, plus the conformance boot
 * gate that plays a generated set in a real Forge.
 *
 * Forge is GPL-3.0 and is never vendored or linked into TypeScript: this
 * package emits text files it understands and drives its jar as a subprocess.
 * The separately executed Java companion is GPL-linked in its own JVM and is
 * kept at the single path enforced by the engine-boundary gate.
 */

export { TRANSPILE_REJECTION_CODES, TranspileError, formatRejections, rejection } from './rejection';
export type { TranspileRejection, TranspileRejectionCode } from './rejection';

export {
  FORGE_BASIC_LAND_RARITY_CODE,
  FORGE_BASIC_LAND_TYPES,
  FORGE_CARD_TYPES,
  FORGE_COLOR_PROPERTIES,
  FORGE_COLOR_WORDS,
  FORGE_COMBAT_ROLES,
  FORGE_COUNTER_TYPES,
  FORGE_KEYWORDS,
  FORGE_RARITY_CODES,
  FORGE_STATIC_AFFECTED,
  FORGE_VALID_TARGETS,
  forgeFilteredTargets,
  forgeRestrictedTarget,
  forgeTargetRestriction,
  unmappedFilterField,
} from './vocabulary-map';

export { transpileAbility } from './ability-script';
export type { AbilityScriptResult } from './ability-script';

export {
  escapeNewlines,
  isScriptSafe,
  renderSpellAbility,
  renderStaticAbility,
  renderSubAbility,
} from './script-text';
export type { ForgeAbility, ForgeParam } from './script-text';

export {
  forgeCardFileName,
  forgeTokenDisplayName,
  forgeTokenScriptName,
  slugify,
  tokenColorPrefix,
} from './naming';

export { FORGE_EFFECTS, isForgeEffectRefusal, transpileEffect } from './effect-script';
export type { EffectScriptResult, ForgeEffectMapping, ForgeEffectScript } from './effect-script';

export { forgeManaCost, forgeTypeLine, transpileCardScript, transpileTokenScript } from './card-script';
export type { CardScriptBody, CardScriptResult } from './card-script';

export { forgeRarityCode, renderEdition } from './edition';
export type { ForgeEditionOptions } from './edition';

export { isStockCard, transpileCard, transpileSet } from './transpile';
export type {
  ForgeCardScript,
  ForgeFile,
  ForgeSetExport,
  TranspileCardResult,
  TranspileSetResult,
} from './transpile';

export { coverageDecks, deckFileName, deckSize, renderDeck } from './deck';
export { createInstalledForgeBotRunner } from './bot-benchmark';
export type { InstalledBotResult } from './bot-benchmark';
export { createInstalledForgeDraftRankingReader, parseForgeDraftRankingOutput } from './draft-rankings';
export type { ForgeDraftRankingReader } from './draft-rankings';
export type { BotRunInput, BotBenchmarkReport } from './bot-benchmark-protocol';
export type { DeckEntry, ForgeDeck } from './deck';

export { writeDecks, writeForgeFile, writeForgeSet } from './write-set';

export {
  defaultForgeHome,
  ensureForgeProfile,
  findForgeInstall,
  forgeMissingReason,
  materializeForgeProfile,
} from './install';
export type { ForgeInstall, ForgeInstallOptions } from './install';

export { forgeCommandArgs, runForge } from './run';
export type { ForgeRunOptions, ForgeRunResult } from './run';

export {
  describeStartupFailure,
  diagnoseStartupFailure,
  parseSimOutput,
  problemCardNames,
} from './sim-output';
export type { ForgeStartupFailure, SimGameResult, SimOutput } from './sim-output';

export { bootGate } from './boot-gate';
export type { BootGameReport, BootGateOptions, BootGateResult, BootGateStatus } from './boot-gate';

export {
  AUDITED_FORGE_CARD_NAMES,
  forgeObservedAdmittedBackend,
  forgeObservedBackend,
  forgeObservedDiagnosticBackend,
} from './observed/backend';
export type {
  ForgeCustomSetResolver,
  ForgeGeneratedObjectPolicy,
  ForgeObservedBackendOptions,
} from './observed/backend';
export {
  compileInstalledForgeBridge,
  installedForgeAdmittedBackend,
  installedForgeBackend,
  installedForgeDiagnosticBackend,
} from './observed/installed';
export type {
  CompiledInstalledForgeBridge,
  CompileInstalledForgeBridgeOptions,
  InstalledForgeBackendOptions,
} from './observed/installed';
export {
  FORGE_BRIDGE_LINE_PREFIX,
  FORGE_BRIDGE_PROTOCOL_VERSION,
  FORGE_GAME_TYPES,
  FORGE_STOCK_AI_FORMATS,
} from './observed/protocol';
export { botProbeCoverage, botProbeVariants } from './bot-probe-coverage';
export { measureForgeRuntime } from './observed/runtime-identity';
export { createForgeRuntimeSnapshot } from './observed/runtime-snapshot';
export type { ForgeRuntimeSnapshot } from './observed/runtime-snapshot';
export type { ForgeRuntimeIdentity, ForgeRuntimeIdentityOptions } from './observed/runtime-identity';
export {
  forgeObservedCoveragePolicyV8,
  forgeObservedLegalBaselinePolicy,
  FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY,
  policyControlledObservedBackend,
  strongestForgeObservedPolicy,
} from './observed/policy';
export { runForgeObservedPolicyGame } from './observed/policy-evidence';
export type {
  ForgeGameplayEvidenceRequest,
  ForgeObservedGameCheckpoint,
  ForgeObservedGameMeasurement,
  ForgeObservedGameReport,
  ForgeObservedPolicyGameOptions,
} from './observed/policy-evidence';
export type {
  ForgeObservedDecisionPolicy,
  ForgeObservedPolicyChoice,
  ForgeObservedPolicyIdentity,
  ForgeObservedPolicyPosition,
} from './observed/policy';
export { FORGE_UNBOUNDED_NUMBER_MAXIMUM, reviewedForgeActions } from './observed/reviewed-actions';
export type { ForgeReviewedAction } from './observed/reviewed-actions';
export { chooseObservedDiagnosticMove, runObservedDiagnosticSession } from './observed/diagnostic-driver';
export type {
  ObservedDiagnosticChoice,
  ObservedDiagnosticDecision,
  ObservedDiagnosticSessionReport,
} from './observed/diagnostic-driver';
export { ForgeScenarioStateSchema } from './observed/scenario-state';
export type { ForgeScenarioState } from './observed/scenario-state';
