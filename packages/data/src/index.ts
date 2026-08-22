/**
 * `@mtg/data` — the lab's local card-data store.
 *
 * Streams Scryfall's gzipped-JSONL bulk files and MTGJSON's vocabulary files
 * into a better-sqlite3 store that keeps every upstream record verbatim next to
 * the columns the lab queries, tracks provenance per row, and resumes cleanly
 * after an interrupted ingest. Generated lab cards share the same tables under
 * `source = 'lab'`.
 *
 * Sources, licenses and the attribution envelope: `ATTRIBUTION` below and
 * `docs/research/prior-art-data-sources.md`.
 */

export {
  ACCEPT_HEADER,
  ATTRIBUTION,
  BULK_KINDS,
  CARD_BULK_KINDS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CACHE_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_REJECT_LOG_LIMIT,
  MTGJSON_BASE,
  SCRYFALL_BULK_ENDPOINT,
  SOURCES,
  USER_AGENT,
} from './config';
export type { BulkKind, Source } from './config';

export {
  DownloadIntegrityError,
  HttpError,
  InvalidInputError,
  RemoteShapeError,
  SchemaVersionError,
  describeError,
} from './errors';

export { createHttpClient } from './http/client';
export type { HttpClient, HttpClientOptions } from './http/client';
export { createLimiter, minIntervalFor } from './http/rate-limiter';
export type { Limiter } from './http/rate-limiter';

export { isGzipFile, readJsonlLines } from './stream/jsonl';
export type { JsonlLine, ReadJsonlOptions } from './stream/jsonl';

export { cacheFileName, fetchBulkCatalog, selectDescriptor, toDescriptor } from './scryfall/catalog';
export type { BulkDescriptor } from './scryfall/catalog';
export { downloadBulkFile } from './scryfall/download';
export type { DownloadOptions, DownloadProgress, DownloadResult } from './scryfall/download';
export {
  BulkCatalogSchema,
  BulkEntrySchema,
  BulkKindSchema,
  CardFaceSchema,
  ScryfallCardSchema,
  ScryfallRulingSchema,
  issueSummary,
} from './scryfall/schemas';
export type {
  BulkCatalog,
  BulkEntry,
  CardFace,
  ColorLetter,
  ScryfallCard,
  ScryfallRuling,
} from './scryfall/schemas';
export {
  canonicalColors,
  rulingId,
  toOracleCardRow,
  toPrintingRow as toPrintingRowInput,
  toRulingRow as toRulingRowInput,
} from './scryfall/mappers';
export type { MapContext, OracleCardRowInput, PrintingRowInput, RulingRowInput } from './scryfall/mappers';

export { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './store/schema';
export { closeStore, getMeta, openStore, setMeta, systemClock } from './store/store';
export type { Clock, DataStore, OpenStoreOptions } from './store/store';
export { createWriters } from './store/writers';
export type { RejectRowInput, Writers } from './store/writers';
export {
  checkpointRun,
  completeRun,
  countRejects,
  getRun,
  listRejects,
  listRuns,
  startRun,
} from './store/runs';
export type { IngestRun, RejectRecord, RunStatus } from './store/runs';
export { LabCardInputSchema, deleteLabCard, upsertLabCard } from './store/lab-cards';
export type { LabCard, LabCardInput } from './store/lab-cards';

export { ingestBulkFile } from './ingest/ingest-file';
export type { IngestFileOptions, IngestProgress, IngestResult, IngestStatus } from './ingest/ingest-file';
export { ingestFromScryfall } from './ingest/ingest-scryfall';
export type { ScryfallIngestOptions, ScryfallIngestOutcome } from './ingest/ingest-scryfall';

export {
  findCardsByColorIdentity,
  findCardsByName,
  findCardsBySet,
  getCardByOracleId,
  getPrintings,
  getRulings,
  normalizeColorIdentity,
  resolveCardRef,
  storeStats,
} from './query/queries';
export type {
  CardQueryOptions,
  CardRefResolution,
  ColorMatchMode,
  ColorQueryOptions,
  NameQueryOptions,
  StoreStats,
} from './query/queries';
export { parseRaw, toCardRow, toPrintingRow, toRulingRow } from './query/rows';
export type { CardRow, PrintingRow, RulingRow } from './query/rows';

export {
  CardTypesFileSchema,
  EnumValuesFileSchema,
  KeywordsFileSchema,
  VOCABULARY_KINDS,
} from './vocabulary/schemas';
export type { CardTypesFile, EnumValuesFile, KeywordsFile, VocabularyKind } from './vocabulary/schemas';
export {
  fetchVocabularyFiles,
  ingestVocabulary,
  loadVocabulary,
  saveVocabularyFiles,
  vocabularyStatus,
} from './vocabulary/ingest';
export type { VocabularyIngestOptions, VocabularyIngestResult } from './vocabulary/ingest';
export {
  buildVocabulary,
  enumValuesFor,
  isKnownCardType,
  isKnownKeyword,
  isKnownSubtype,
  isKnownSupertype,
  normalizeVocabTerm,
  unknownKeywords,
} from './vocabulary/vocabulary';
export type { MtgVocabulary, VocabularyFiles } from './vocabulary/vocabulary';

export { REFERENCE_SET_CODES, REFERENCE_SET_SOURCES } from './reference/manifest';
export type { ReferenceSetCode, ReferenceSetSource } from './reference/manifest';
export {
  buildReferenceCorpus,
  fetchReferenceSetSources,
  parseReferenceSetSource,
  writeReferenceCorpus,
} from './reference/import';
export type {
  FetchReferenceSetOptions,
  ReferenceSourceBytes,
  WriteReferenceCorpusOptions,
} from './reference/import';
export {
  DraftBoosterSchema,
  MtgjsonCardSchema,
  MtgjsonSetFileSchema,
  MtgjsonTokenSchema,
  ReferenceCardRoleSchema,
  ReferenceCardSchema,
  ReferenceCorpusSchema,
  ReferenceSetSchema,
  ReferenceTokenSchema,
} from './reference/schemas';
export { REFERENCE_CORPUS_PATH, loadReferenceCorpus } from './reference/corpus';
export type {
  MtgjsonSetFile,
  ReferenceCard,
  ReferenceCardRole,
  ReferenceCorpus,
  ReferenceSet,
  ReferenceToken,
} from './reference/schemas';
export {
  REFERENCE_PROFILE_PATH,
  REFERENCE_PROFILE_VERSION,
  TARGET_BAND_POLICY_VERSION,
  ReferenceProfileArtifactSchema,
  buildPrimaryCoreEnvelope,
  buildReferenceProfileArtifact,
  deriveCardSetProfile,
  deriveReferenceSetProfile,
  loadReferenceProfileArtifact,
  profileScalarDiff,
} from './reference/profiles';
export type {
  ComparableScalar,
  MetricPopulation,
  PrimaryCoreEnvelope,
  PrimaryCoreEnvelopeMetric,
  ProfileRole,
  ProfileScalarDiff,
  RateMetric,
  ReferenceProfileArtifact,
  ScalarUnit,
  StaticProfileCard,
  StaticSetProfile,
  TargetBandTolerance,
} from './reference/profiles';
export {
  CALIBRATION_HARNESS_VERSION,
  CALIBRATION_PROFILE_VERSION,
  REFERENCE_PROFILE_SHA256,
  CalibrationProfileSchema,
  buildCalibrationProfile,
  loadCalibrationProfile,
  verifyCalibrationProfile,
} from './reference/calibration';
export type {
  CalibrationAxis,
  CalibrationProfile,
  CalibrationTarget,
  CalibrationTargetKind,
  LoadCalibrationProfileOptions,
} from './reference/calibration';
export {
  EXECUTABLE_COVERAGE_INSTRUMENT_VERSION,
  EXECUTABLE_REFERENCE_SCHEMA_VERSION,
  ExecutableCoverageEvidenceSchema,
  ExecutableCoverageOutcomeSchema,
  ExecutableCoverageRowSchema,
  ExecutableReferenceError,
  ExecutableReferenceSetSchema,
  buildExecutableReferenceSet,
  referencePositionFingerprint,
} from './reference/executable';
export type {
  ExecutableCoverageEvidence,
  ExecutableCoverageOutcome,
  ExecutableCoverageRow,
  ExecutableReferenceErrorCode,
  ExecutableReferenceSet,
} from './reference/executable';
export {
  PARTIAL_EXECUTABLE_REFERENCE_SCHEMA_VERSION,
  DroppedPositionSchema,
  PartialExecutableReferenceSetSchema,
  SLOT_CONCENTRATION_THRESHOLD,
  ReducedBoosterSchema,
  ReducedCollationSchema,
  ReducedSheetSchema,
  ReducedSlotColorLossSchema,
  ReducedSlotConcentrationSchema,
  ReducedSlotFindingSchema,
  ReferenceCensusSchema,
  ReducedShortSlotSchema,
  UnfillableBoosterSchema,
  buildPartialExecutableReferenceSet,
} from './reference/partial';
export type {
  DroppedPosition,
  PartialExecutableReferenceSet,
  ReducedBooster,
  ReducedCollation,
  ReducedSheet,
  ReducedSlotColorLoss,
  ReducedSlotConcentration,
  ReducedSlotFinding,
  ReferenceCensus,
  ReducedShortSlot,
  UnfillableBooster,
} from './reference/partial';

export {
  REDUCED_REFERENCE_SET_DOCUMENT_VERSION,
  PlayableBoosterSchema,
  PlayableCollationSchema,
  PlayableSheetSchema,
  ReducedDropRecordSchema,
  ReducedPositionRefusalSchema,
  ReducedReferenceSetDocumentSchema,
  reducedReferenceSetDocument,
} from './reference/playable';
export type {
  PlayableBooster,
  PlayableCollation,
  PlayableSheet,
  ReducedDropRecord,
  ReducedPositionRefusal,
  ReducedReferenceSetDocument,
} from './reference/playable';
