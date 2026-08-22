/**
 * `@mtg/ui` — the shared web foundation.
 *
 * One Vite + React app with peer modes, not separate apps. The playable board,
 * native draft, card renderer, replay viewer and analysis dashboard are *views*
 * plugged into this shell;
 * everything they share — the token layer, the card face, the board and zone
 * primitives, and the replay-log reader — lives here and is exported below.
 *
 * Two conventions hold across the package:
 *
 *  1. **No color outside the tokens.** Components carry class names and
 *     `data-` attributes; `styles/tokens.ts` is the only file that names a
 *     color, and a test fails the build on a raw hex anywhere under `src/`.
 *  2. **No JSX.** The workspace has one root tsconfig with no `jsx` setting and
 *     no `lib: dom`, and packages here carry no tsconfig of their own, so every
 *     component is written with `createElement` and stays inside
 *     `npm run typecheck`.
 */

export { App } from './app/App';
export type { AppProps, UiView, UiViews } from './app/App';
export { SHELL_NOTICE_LABEL, Shell } from './app/Shell';
export type { ShellProps } from './app/Shell';
export {
  DEFAULT_MODE,
  MODE_LABELS,
  UI_MODES,
  hashSource,
  parseHash,
  routeHash,
  useHashRoute,
} from './app/router';
export type { HashSource, UiMode, UiRoute, UiRouter } from './app/router';

export { renderCopy } from './copy';

export { GlobalStyles, uiStyleSheet } from './styles/index';
export {
  BOARD_SURFACE_TOKEN,
  COLOR_IDENTITIES,
  IDENTITY_LABELS,
  MAT_TOKEN_CSS,
  TOKEN_CSS,
} from './styles/tokens';
export type { ColorIdentity } from './styles/tokens';

export { Card, SCREEN_SEAL } from './card/Card';
export type { CardProps, CardSize } from './card/Card';
export {
  ART_WINDOW,
  CARD_REGIONS,
  CARD_TRIM_MM,
  COMPACT_REGIONS,
  FACE_REGIONS,
  LOYALTY_BADGE_GUTTER,
  LOYALTY_BADGE_POINTS,
  LOYALTY_BADGE_SHARE,
  LOYALTY_FIT_STEPS,
  LOYALTY_SHIELD_FLAT,
  LOYALTY_SHIELD_POINTS,
  LOYALTY_SHIELD_SHARE,
  NAME_FIT_STEPS,
  PLANESWALKER_ART_WINDOW,
  PIP_GLYPHS,
  PIP_GLYPH_FOR_COLOR,
  PIP_GLYPH_SCALE,
  PIP_GLYPH_STROKE,
  PIP_GLYPH_UNITS,
  PIP_GLYPH_VIEW_BOX,
  RARITY_SEAL_INK,
  RULES_FIT_STEPS,
  TITLE_PIP_TO_TEXT,
  artWindow,
  collectorLine,
  costPips,
  faceAttributes,
  frameTreatment,
  nameFitScale,
  nameFitStep,
  nameFitStepOf,
  outlineClipPath,
  outlinePoints,
  pipArt,
  pipToken,
  rulesBoxCost,
  rulesFitScale,
  rulesFitStep,
  rulesFitStepOf,
  rulesFitSteps,
  rulesTextBlocks,
  setSealPath,
  textBoxBlocks,
  typeFitStep,
  typeFitStepOf,
} from './card/anatomy';
export type {
  FaceRegion,
  FrameTreatment,
  Outline,
  PipArt,
  PipGlyph,
  PipSpec,
  SealRarity,
} from './card/anatomy';
export { composeTextBox, lineRuns, oracleBlocks, remindedBlocks } from './card/text-box';
export type { BoxFits, LineRuns, TextBlock } from './card/text-box';
export { ART_PENDING_LABEL, ArtSlot } from './card/ArtSlot';
export type { ArtSlotProps, CardArt } from './card/ArtSlot';
export { ManaPips } from './card/ManaPips';
export type { ManaPipsProps } from './card/ManaPips';
export {
  DEFAULT_SYMBOL_SET,
  LOCAL_SYMBOL_BASE,
  MAX_GENERIC_SYMBOL,
  PRINTED_SYMBOL_SET,
  SCRYFALL_SYMBOL_BASE,
  SYMBOL_ADVANCE_EM,
  SYMBOL_BOX_EM,
  SYMBOL_DIR,
  SYMBOL_DROP_EM,
  SYMBOL_MARGIN_EM,
  SYMBOL_SETS,
  SYMBOL_TOKENS,
  oracleChunks,
  symbolArt,
  symbolLabel,
  symbolSetFrom,
} from './card/symbols';
export type { OracleChunk, OracleSymbolChunk, OracleTextChunk, SymbolArt, SymbolSet } from './card/symbols';
export { SYMBOL_CLASS, symbolElement, symbolizeLine } from './card/SymbolText';
export { cardColorIdentity, cardColors, colorToIdentity, colorsToIdentity } from './card/identity';

export { Board } from './board/Board';
export type { BoardProps, BoardSide } from './board/Board';
export { Battlefield, permanentMarks } from './board/Battlefield';
export type { BattlefieldProps, BoardMark, BoardPermanent, MarkTone } from './board/Battlefield';
export { Hand } from './board/Hand';
export type { HandCard, HandProps } from './board/Hand';
export { Exile } from './board/Exile';
export type { ExileCard, ExileProps } from './board/Exile';
export { Graveyard } from './board/Graveyard';
export type { GraveyardCard, GraveyardProps } from './board/Graveyard';
export { StackZone } from './board/StackZone';
export type { StackItem, StackZoneProps } from './board/StackZone';
export { MANA_SYMBOLS, PlayerStatus } from './board/PlayerStatus';
export type { ManaPoolView, ManaSymbol, PlayerStatusProps } from './board/PlayerStatus';
export { SeatPod } from './board/SeatPod';
export type { SeatPodProps } from './board/SeatPod';
export { Zone } from './board/Zone';
export type { ZoneLayout, ZoneProps, ZoneTone } from './board/Zone';

export {
  END_REASONS,
  EXTRA_STRING_FIELDS,
  GAME_COLUMNS,
  REPLAY_SCHEMA_VERSION,
  SIDES,
  TOTAL_FIELDS,
  TURN_OWNER_FIELDS,
  TURN_SIDE_EOT_FIELDS,
  TURN_SIDE_FIELDS,
  eotColumn,
  otherSide,
  ownerColumn,
  sideColumn,
  totalColumn,
} from './replay/columns';
export type {
  EndReason,
  ReplaySide,
  TotalField,
  TurnOwnerField,
  TurnSideEotField,
  TurnSideField,
} from './replay/columns';
export {
  ReplayLogError,
  lifeSeries,
  matchupLabel,
  readReplayGame,
  readReplayLog,
  winningSide,
} from './replay/timeline';
export type {
  LifePoint,
  ReplayExtras,
  ReplayGame,
  ReplayHeader,
  ReplayLog,
  ReplayMetadata,
  SideTotals,
  SideTurnStats,
  TimelineTurn,
} from './replay/types';
export { matchupRows, onPlayWon, ratePercent, summarizeGames, summarizeLog } from './replay/summary';
export type { MatchupRow, ReplaySummary, Spread } from './replay/summary';

export { AnalysisRoute, MIN_MATCHUP_GAMES, NO_LOG_HINT, RunSummaryPanels } from './routes/AnalysisRoute';
export type { AnalysisLogState, AnalysisRouteProps, RunSummaryPanelsProps } from './routes/AnalysisRoute';
export { CardsRoute } from './routes/CardsRoute';
export type { CardsRouteProps } from './routes/CardsRoute';
export { DeckRoute } from './routes/DeckRoute';
export type { DeckRouteProps, DeckState } from './routes/DeckRoute';
export { DraftRoute, encodePickLog } from './routes/DraftRoute';
export type { DraftRouteParams, DraftRouteProps, DraftSetState } from './routes/DraftRoute';
export { DeckTile, identityOf } from './routes/deck/DeckTile';
export type { DeckTileProps } from './routes/deck/DeckTile';
export { ManaBasePanel, percent } from './routes/deck/ManaBasePanel';
export type { ManaBasePanelProps } from './routes/deck/ManaBasePanel';
export { DECK_ARTIFACT_VERSION, DeckArtifactSchema, readDeckArtifact } from './lab/deck-artifact';
export type {
  DeckArt,
  DeckArtifact,
  DeckArtifactCheck,
  DeckArtifactColor,
  DeckArtifactEntry,
  DeckArtifactResult,
} from './lab/deck-artifact';
export {
  ART_MANIFEST_VERSION,
  ART_MANIFEST_VERSION_SINGLE,
  artResolver,
  pickVariant,
  readArtManifest,
  readMigratedArtManifest,
  rotatesIllustrations,
  selectIllustration,
} from './lab/art-manifest';
export type { ArtManifest, ArtManifestEntry, ArtManifestResult, ArtResolver } from './lab/art-manifest';
// The curation index's reader, exported for the same reason the manifest's is:
// the art pipeline's own curation test builds a document with the producer's
// declaration and parses it with this one, which is what keeps the two copies
// of the schema from drifting apart quietly.
export { CURATION_INDEX_VERSION, readCurationIndex } from './lab/curation-index';
export type {
  CurationCandidate,
  CurationCard,
  CurationIndex,
  CurationIndexResult,
} from './lab/curation-index';
export { ReplayRoute } from './routes/ReplayRoute';
export type { ReplayRouteProps } from './routes/ReplayRoute';

// The decision-level replay: a recorded event log, stepped one kernel decision
// at a time. `routes/replay/index.ts` is the whole surface and says what the
// two logs in this package are for.
export {
  ActionSchema,
  boardFrame,
  boardNotes,
  clampSeq,
  DEFAULT_SPEED_ID,
  DecisionPanel,
  DecisionSchema,
  EVENT_LOG_SCHEMA_VERSION,
  EventLogError,
  EventPanel,
  EventSchema,
  GameRecordSchema,
  HeaderRecordSchema,
  LogRecordSchema,
  PLAYBACK_SPEEDS,
  ReplayViewer,
  SnapshotSchema,
  STEP_NAMES,
  StepRecordSchema,
  Transport,
  TurnRail,
  actionSummary,
  describeAction,
  describeDecision,
  describeEvent,
  describeResult,
  namesFor,
  optionLabels,
  readEventLog,
  seqForTurn,
  speedById,
  stepWords,
  turnsOf,
} from './routes/replay/index';
export type {
  BoardNote,
  DecisionPanelProps,
  EventLog,
  EventPanelProps,
  GameRecord,
  HeaderRecord,
  LogAction,
  LogBoardPermanent,
  LogDecision,
  LogDecisionKind,
  LogEvent,
  LogEventType,
  LogPlayerId,
  LogResult,
  LogSnapshot,
  LogStep,
  LogTarget,
  PlaybackSpeed,
  ReplayGameLog,
  ReplayNames,
  ReplayObject,
  ReplaySeat,
  ReplayState,
  ReplayStep,
  ReplayTurn,
  ReplayViewerProps,
  StepRecord,
  TransportProps,
  TurnFacts,
  TurnRailProps,
} from './routes/replay/index';
export {
  COLLATION_UNUSABLE_TITLE,
  DEFAULT_TABLE_BASE,
  EMPTY_TITLE,
  LOADING_TITLE,
  PlayRoute,
  PRECON_MISMATCH_TITLE,
  UNREADABLE_TITLE,
} from './routes/PlayRoute';
// The precon half of the play route. `PreconState` is exported for the same
// reason `PlaySetState` is: a consumer that fetches the deck lists has to say
// which of the four states it is in, and cannot hand over decks it has not read.
export type { PlayPrecons, PreconState } from './routes/PlayRoute';
export { BuilderSwitch, PRECON_TAB_LABEL, SEALED_TAB_LABEL } from './routes/play/BuilderSwitch';
export type { BuilderKind, BuilderSwitchProps } from './routes/play/BuilderSwitch';
export { PreconGame } from './routes/play/PreconGame';
export type { PreconGameProps, PreconSelection } from './routes/play/PreconGame';
export {
  chooseTheirsLabel,
  chooseYoursLabel,
  PRECON_HOTSEAT_LABEL,
  PRECON_LABEL,
  PRECON_PLAY_LABEL,
  PreconPicker,
} from './routes/play/PreconPicker';
export type { PreconPickerProps } from './routes/play/PreconPicker';
export { preconFacts, preconProblem } from './routes/play/precon-facts';
export type { PreconFacts } from './routes/play/precon-facts';
export { readReduction, reducedNoticeText } from './lab/reduced-notice';
export type { ReductionDrop, SetReduction } from './lab/reduced-notice';
export { readStagedCollation } from './lab/staged-collation';
export type { StagedCollation } from './lab/staged-collation';
export { readPreconFile } from './lab/precon-file';
export type { PreconFileResult } from './lab/precon-file';
// `PlaySetState` is half of this route's contract, not an implementation
// detail: a consumer that fetches a set has to say which of the four states it
// is in, and the point of the type is that it cannot hand over cards it does
// not have yet. `DeckState` and `ReplayState` are exported for the same reason.
export type { PlayRouteProps, PlaySetState } from './routes/PlayRoute';

// Two players on two machines. The page holds a link and a snapshot; the game
// is on the server (`@mtg/netplay`), which is what makes the concealment real
// rather than a component declining to draw what it already has.
export { CLIENT_PROTOCOL, readSnapshot, sessionViewOf } from './net/snapshot';
export type { SnapshotResult } from './net/snapshot';
export { useRemoteTable } from './net/remote-table';
export type { RemoteTableHandle } from './net/remote-table';
export {
  CONNECTING_LABEL,
  HOTSEAT_LABEL,
  LEGAL_MOVES_LABEL,
  LiveGame,
  PASS_LABEL,
  PlayView,
  RemoteGame,
  SEALED_POOL_LABEL,
  WAITING_LABEL,
  SealedBuilder,
  SealedGame,
  boardPosition,
  buildPrompt,
  chosenCards,
  clearSelection,
  dealMirrorGame,
  dealSealedGame,
  deckFor,
  describeStep,
  describeTarget,
  nameOf,
  openSealed,
  playableFromHand,
  resuggest,
  suggestSelection,
  toggle,
  usePlaySession,
} from './routes/play/index';
export type {
  DealOptions,
  DealtGame,
  LiveGameProps,
  OpponentKind,
  PlayChoice,
  PlayConfig,
  PlayPrompt,
  PlaySessionHandle,
  PlayViewProps,
  RemoteGameProps,
  SealedBuild,
  SealedBuilderProps,
  SealedGameProps,
  SeatNames,
} from './routes/play/index';

export { LabApp } from './dev/LabApp';
export type { LabAppProps } from './dev/LabApp';
export { mount } from './mount';
export type { MountTarget, MountedApp } from './mount';
