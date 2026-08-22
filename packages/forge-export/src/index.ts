/**
 * `@mtg/forge-export` — DSL -> Forge card scripts, plus the conformance boot
 * gate that plays a generated set in a real Forge.
 *
 * Forge is GPL-3.0 and is never vendored, linked or imported: this package
 * emits text files it understands and drives its jar as a subprocess. Nothing
 * here derives from Forge's source.
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

export { FORGE_EFFECTS, transpileEffect } from './effect-script';
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
export type { DeckEntry, ForgeDeck } from './deck';

export { writeDecks, writeForgeFile, writeForgeSet } from './write-set';

export { defaultForgeHome, ensureForgeProfile, findForgeInstall, forgeMissingReason } from './install';
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
