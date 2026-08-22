/**
 * The analysis surface: the screen that answers "is this set any good".
 *
 * Not re-exported from `@mtg/ui`'s barrel — that file belongs to the shell
 * package and this route is a tenant in it. Import from
 * `@mtg/ui/src/routes/analysis` (or relatively, inside this package) until the
 * shell adopts it.
 */

export { ANALYSIS_CSS } from './styles';

export {
  NOT_ENOUGH_EVIDENCE,
  NoEvidence,
  SampleNote,
  census,
  duplicateTone,
  evidenceFor,
  integer,
  percent,
  sampleNote,
  sampleSize,
} from './evidence';
export type { Evidence, EvidenceProps, NoEvidenceProps, SampleSize } from './evidence';

export {
  AnalysisStyles,
  BAR_RADIUS,
  ChartFigure,
  DataTable,
  Legend,
  MAX_BAR_THICKNESS,
  Meter,
  Plot,
  Stat,
  axisTicks,
  barPathH,
  barPathV,
  gridLine,
  mark,
} from './chart';
export type {
  ChartFigureProps,
  DataTableProps,
  LegendEntry,
  MarkTone,
  MeterProps,
  PlotProps,
  StatProps,
  TableRow,
} from './chart';

export type {
  AnalysisRun,
  CardPerformance,
  CardPerformanceBlock,
  ColorPairRecord,
  ColorPairReport,
  ColorTarget,
  CurveTarget,
  Decisiveness,
  GameLength,
  GateStatus,
  HealthBands,
  LengthSummary,
  NumericBand,
  PreconMatchupBlock,
  PreconMatchupCell,
  PreconMatchupDeck,
  PreconMatchupStatus,
  RarityTarget,
  RunGate,
  RunHealth,
  RunSetRef,
  SampledValue,
  SetDocument,
  SkeletonTargets,
  WinRateInterval,
} from './model';
export { GATE_STATUSES } from './model';

export {
  AnalysisDataError,
  parseAnalysisRun,
  parseSetDocument,
  readAnalysisRun,
  readSetDocument,
} from './read';

export { COMPOSITION_TOLERANCE, CompositionPanel, composeSet, fitCurve } from './composition';
export type { Composition, CompositionPanelProps, CompositionRow } from './composition';

export { ArchetypePanel, pairEvidence, pairIdentities } from './archetypes';
export type { ArchetypePanelProps, PairEvidence } from './archetypes';

export { GameShapePanel } from './game-shape';
export type { GameShapePanelProps } from './game-shape';

export { CardPerformancePanel, OUTLIER_SIGMA, RARITY_ANY, cardRows } from './card-performance';
export type { CardPanelProps, CardRow } from './card-performance';

export { PreconMatchupPanel } from './precon-matchups';
export type { PreconMatchupPanelProps } from './precon-matchups';

export { CalibrationEvidencePanel, CalibrationPanel, RetuneEvidencePanel } from './calibration';
export type {
  CalibrationEvidencePanelProps,
  CalibrationPanelProps,
  RetuneEvidencePanelProps,
} from './calibration';
export {
  CalibrationDataError,
  EXPECTED_CALIBRATION_HARNESS_VERSION,
  EXPECTED_CALIBRATION_PROFILE_DIGEST,
  EXPECTED_CALIBRATION_PROFILE_VERSION,
  EXPECTED_REFERENCE_PROFILE_VERSION,
  classifyCalibration,
  classifyRetune,
  readCalibrationArtifact,
  readRetuneArtifact,
} from './calibration-read';
export { REFERENCE_CODES, REFERENCE_CONTEXT_METRICS } from './calibration-model';
export type {
  CalibrationArtifact,
  CalibrationState,
  CardCalibrationFinding,
  CardFindingStatus,
  ReferenceCalibrationProfile,
  ReferenceCode,
  RetuneArtifact,
  RetuneState,
} from './calibration-model';

export { RevisionDiffPanel, diffRuns, formatDelta, formatObserved } from './diff';
export type { DiffPanelProps, DiffRow, MetricMovement, MetricPresence } from './diff';

export {
  ANALYSIS_SECTIONS,
  AnalysisSurface,
  DEFAULT_SECTION,
  SECTION_LABELS,
  analysisView,
  sectionFromRoute,
} from './AnalysisView';
export type {
  AnalysisRunView,
  AnalysisRunsState,
  AnalysisSection,
  AnalysisSurfaceProps,
} from './AnalysisView';
