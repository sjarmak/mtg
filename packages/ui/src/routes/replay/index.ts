/**
 * The replay viewer route (bead `mtg-bc2.20`).
 *
 * Watch a bot game from the kernel's event log: step forward and back (or with
 * the arrow keys), jump to a turn, play and pause at a chosen speed (or with the
 * space bar), and read every bot decision beside the legal
 * options the kernel enumerated for it. The board is drawn from a recorded
 * snapshot, never from a re-simulation, so the view is a pure function of the
 * log file and the two URL parameters.
 *
 * Both of the seams this module used to name as open are closed, and one of the
 * two was described wrongly, which is worth keeping written down:
 *
 *  - **The recorder is in `packages/ui/tools/record-replay.ts`**, not in
 *    `@mtg/sim`. Moving it there was called a file move plus an export; it is
 *    not, because the recorder writes through the schemas in `log-schema.ts`,
 *    those schemas are browser code, and `@mtg/ui` already depends on
 *    `@mtg/sim`. That file's own doc comment carries the whole argument and the
 *    bead for the one move that would actually work.
 *  - **Mounting** is `packages/ui/src/index.ts` plus the `replay` slot of an
 *    `App`'s `views`, and `dev/LabApp.ts` is the worked example. The log is
 *    staged by `tools/stage-replay.ts` on the way to opening the lab.
 */
export { ReplayViewer } from './ReplayViewer';
export type { ReplayState, ReplayViewerProps } from './ReplayViewer';

export { EventLogError, readEventLog } from './read-log';
export type { EventLog, ReplayGameLog, ReplayObject, ReplaySeat, ReplayStep } from './read-log';

export {
  ActionSchema,
  DecisionSchema,
  EVENT_LOG_SCHEMA_VERSION,
  EventSchema,
  GameRecordSchema,
  HeaderRecordSchema,
  LogRecordSchema,
  SnapshotSchema,
  StepRecordSchema,
  STEP_NAMES,
} from './log-schema';
export type {
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
  StepRecord,
} from './log-schema';

export {
  describeAction,
  describeDecision,
  describeEvent,
  describeResult,
  describeTarget,
  namesFor,
  optionLabels,
  stepWords,
} from './narrate';
export type { ReplayNames } from './narrate';

export { boardFrame, boardNotes } from './frame';
export type { BoardNote } from './frame';

export { usePlaybackKeys } from './playback-keys';
export type { PlaybackKeysInput } from './playback-keys';

export {
  DEFAULT_SPEED_ID,
  LANDMARK_BEATS,
  PLAYBACK_SPEEDS,
  clampSeq,
  dwellMillis,
  seqForTurn,
  speedById,
  turnsOf,
} from './steps';
export type { PlaybackSpeed, ReplayTurn, TurnFacts } from './steps';

export { DecisionPanel, actionSummary } from './DecisionPanel';
export type { DecisionPanelProps } from './DecisionPanel';
export { EventPanel } from './EventPanel';
export type { EventPanelProps } from './EventPanel';
export { Transport } from './Transport';
export type { TransportProps } from './Transport';
export { TurnRail } from './TurnRail';
export type { TurnRailProps } from './TurnRail';
