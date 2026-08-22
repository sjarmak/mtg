/**
 * The calibration join contract against 17lands — declared here, exercised
 * without the dataset.
 *
 * The metrics report's load-bearing design decision (§2.4, §9): "our self-play
 * log exporter should emit a superset of these columns under the same names so
 * calibration is a join, not a mapping layer". `@mtg/sim`'s exporter does that.
 * This module states what the join actually needs, checks the half of it we own
 * against a real emitted row, and writes down — precisely — the three places
 * where the two schemas mean different things by the same name. A join that
 * ignores those produces numbers that are wrong by exactly a factor of two, and
 * nothing in either schema would flag it.
 *
 * Nothing here downloads anything. Ingesting the human side is `spells`' job
 * (MIT, verdict **adopt**, §9); this file is the contract that ingestion has to
 * satisfy, plus the versioned correction table the protocol produces (§8 step
 * 6), which is empty because no calibration run has happened yet. It stays
 * empty until one does: a fabricated correction is worse than no correction.
 */
import type { ReplayRow, SimGameLog, Side } from '@mtg/sim';
import {
  expectedReplayColumns,
  replayRow,
  REPLAY_GAME_COLUMNS,
  REPLAY_TOTAL_FIELDS,
  SIM_LOG_SCHEMA_VERSION,
  TURN_OWNER_FIELDS,
  TURN_SIDE_EOT_FIELDS,
  TURN_SIDE_FIELDS,
} from '@mtg/sim';

/** Verified working URL pattern for the public CC BY 4.0 dumps (§2.1). */
export const SEVENTEEN_LANDS_URL_PATTERN =
  'https://17lands-public.s3.amazonaws.com/analysis_data/{draft_data|game_data|replay_data}/' +
  '{draft|game|replay}_data_public.{SET}.{EventType}.csv.gz';

/** Required by the CC BY 4.0 license and by their usage guidelines (§2.2). */
export const SEVENTEEN_LANDS_ATTRIBUTION =
  'Human baseline data from 17Lands (https://www.17lands.com/public_datasets), CC BY 4.0. ' +
  '17Lands does not endorse this analysis. Note the capital L.';

/** Event types verified present for modern sets (§2.3). */
export const SEVENTEEN_LANDS_EVENT_TYPES = [
  'PremierDraft',
  'TradDraft',
  'Sealed',
  'TradSealed',
  'QuickDraft',
] as const;

/**
 * Sets verified to carry all three data types, so all of them can serve as
 * calibration sets (§2.3 probe table, §8 step 0 recommendation).
 */
export const CALIBRATION_CANDIDATE_SETS = ['DSK', 'FDN', 'DFT', 'TDM', 'FIN', 'EOE', 'TLA', 'ECL'] as const;

/** A name both schemas use but do not mean the same thing by. */
export interface JoinCaveat {
  readonly id: string;
  readonly columns: readonly string[];
  /** What a naive join would get wrong. */
  readonly issue: string;
  /** What to do about it before joining. */
  readonly transform: string;
}

/**
 * The real mismatches. Every one of them was found by reading both schemas, not
 * by assuming they line up.
 *
 * Two entries are here because a column *left* the structurally-zero list rather
 * than joined it, and both keep their own entry instead of disappearing: a
 * reader who was told once to exclude a column needs to be told it is measured
 * now, and told what is still different about it.
 */
export const JOIN_CAVEATS: readonly JoinCaveat[] = [
  {
    id: 'turn-index-base',
    columns: ['{owner}_turn_{N}_*'],
    issue:
      "17lands indexes each player's own turns, so user_turn_3 is the user's third turn. Our exporter " +
      "writes the kernel's global player-turn counter, so one side occupies the odd indices and the " +
      "other the even ones. Joining on the raw index compares a player's third turn to their " +
      "opponent's second.",
    transform:
      'Re-index per owner before joining: the Nth record with owner=X becomes X_turn_N. ' +
      '`ownTurns`/`ownTurn` in this package already read logs that way.',
  },
  {
    id: 'num-turns-unit',
    columns: ['num_turns'],
    issue:
      "17lands' num_turns counts each player's own turns (their average game length is ~8.8), while " +
      'ours counts global player turns (~17.6 for the same game). A direct comparison is out by 2x.',
    transform:
      'Convert with `roundsFromPlayerTurns` (ceil(playerTurns / 2)) before comparing to 17lands ' +
      'num_turns or to the /data/play_draw histogram. Every length band in this package is stated in ' +
      'those converted rounds for that reason.',
  },
  {
    id: 'structurally-zero',
    columns: ['{side}_total_cards_tutored', 'rank', 'opp_rank'],
    issue:
      'These columns exist in both schemas but this pipeline cannot produce them: no tutor primitive ' +
      'and no ladder rank. They are emitted as zero or empty string so the join stays total, which ' +
      'means a mean taken across joined rows silently mixes real zeros with structural ones.',
    transform: 'Exclude these columns from any pooled statistic, or filter to source=17lands.',
  },
  {
    id: 'mulligans',
    columns: ['num_mulligans', 'opp_num_mulligans'],
    issue:
      'These two used to sit in structurally-zero and no longer do. CR 103.4 is a decision the kernel ' +
      'asks before turn 1 and the bots answer, so both columns count what a seat actually did and a ' +
      'zero means a kept opening hand. What still differs is the policy behind the number rather than ' +
      'the number: the tier-1 bots keep on a land count inside a stated band and stop at a stated ' +
      'ceiling of mulligans (@mtg/sim MulliganPolicyConfig), while a human reads the whole hand and ' +
      'the matchup. So the rate is a measurement of that profile, and mtgds puts a single mulligan at ' +
      'about -14.4 points of win rate (§3.3 item 7) — a bot run whose mulligan rate is far from the ' +
      'human one still carries part of that offset into a win-rate comparison, in whichever direction ' +
      'the rates differ.',
    transform:
      'Compare the mulligan rate itself before comparing win rates: join on it, or bucket both sides ' +
      'by num_mulligans and compare within a bucket. The profile is the lever if the rates are far ' +
      'apart, and it is data rather than code, so a run can state the band it played under.',
  },
  {
    id: 'activated-abilities',
    columns: ['{owner}_turn_{N}_{side}_abilities'],
    issue:
      'This column used to sit in structurally-zero and no longer does. CR 602 activated abilities ' +
      'are printable and the bots pay for them, so the exporter counts one per activation and a zero ' +
      "here means the seat activated nothing. Two edges still differ. Ours excludes a land's " +
      'intrinsic mana ability, which uses no stack (CR 605.1) and is not counted by 17lands either; ' +
      'and a generated set whose cards print no activated ability reports zero across every row, ' +
      'which is a real zero about a format rather than a gap in the exporter.',
    transform:
      'Compare it only across sets that print activated abilities, and read a whole-run zero as a ' +
      'statement about the set rather than about the schema. `abilityActivated` in the kernel event ' +
      'log is the source of the count, so a run can be audited against its own events. Do not add ' +
      '`{owner}_turn_{N}_{side}_sim_triggers` into it before joining: CR 603 triggered abilities are ' +
      'counted separately in a column of ours precisely because 17lands has no counterpart to join ' +
      'that half against.',
  },
];

export interface JoinContract {
  readonly simSchemaVersion: string;
  /** Columns that identify a row on our side. */
  readonly keyColumns: readonly string[];
  /** Game-level columns both schemas carry under the same names. */
  readonly sharedGameColumns: readonly string[];
  /** Per-side total field names, emitted as `{side}_total_{field}`. */
  readonly sharedTotalFields: readonly string[];
  /** Per-turn field families, emitted under 17lands' own layout. */
  readonly sharedTurnOwnerFields: readonly string[];
  readonly sharedTurnSideFields: readonly string[];
  readonly sharedTurnEotFields: readonly string[];
  readonly urlPattern: string;
  readonly attribution: string;
  readonly caveats: readonly JoinCaveat[];
}

/**
 * Drops the fields that are ours from a family the exporter shares with
 * 17lands.
 *
 * The wide layout writes `{owner}_turn_{N}_{side}_{field}`, so a column of ours
 * inside one of those families carries its `sim_` marker on the field rather
 * than at the front of the column name — `sim_triggers` is the first. Listing
 * it as shared would send a reader looking for a column 17lands has never
 * published.
 */
function sharedOnly(fields: readonly string[]): readonly string[] {
  return fields.filter((field) => !field.startsWith('sim_'));
}

export function joinContract(): JoinContract {
  return {
    simSchemaVersion: SIM_LOG_SCHEMA_VERSION,
    keyColumns: ['sim_run_seed', 'sim_game_seed', 'sim_game_index'],
    sharedGameColumns: [...REPLAY_GAME_COLUMNS],
    sharedTotalFields: sharedOnly(REPLAY_TOTAL_FIELDS),
    sharedTurnOwnerFields: sharedOnly(TURN_OWNER_FIELDS),
    sharedTurnSideFields: sharedOnly(TURN_SIDE_FIELDS),
    sharedTurnEotFields: sharedOnly(TURN_SIDE_EOT_FIELDS),
    urlPattern: SEVENTEEN_LANDS_URL_PATTERN,
    attribution: SEVENTEEN_LANDS_ATTRIBUTION,
    caveats: JOIN_CAVEATS,
  };
}

export interface JoinCompatibility {
  readonly ok: boolean;
  /** Contract columns the emitted row did not carry. */
  readonly missing: readonly string[];
  /** Columns the row carried that the contract does not name and that are not marked ours. */
  readonly unexpected: readonly string[];
  /** Our own columns, which the human side will never have. */
  readonly simOnly: readonly string[];
  readonly columns: number;
}

/**
 * Is this column ours rather than 17lands'?
 *
 * Game-level columns of ours lead with the marker (`sim_run_seed`). A per-turn
 * one cannot: the wide layout spends the front of the name on the owner, the
 * turn and the side, so the marker lands on the field (`user_turn_3_oppo_
 * sim_triggers`). Both are ours and neither will ever appear in a 17lands CSV,
 * so both belong in `simOnly` and neither is `unexpected`.
 */
function isSimColumn(column: string): boolean {
  return column.startsWith('sim_') || column.includes('_sim_');
}

/**
 * Checks the half of the join we control: that a real exported row still
 * carries every column the contract promises 17lands' schema. Runs on any
 * `SimGameLog`, needs no dataset, and fails loudly if the exporter is changed
 * without the contract following it.
 */
export function verifyJoinCompatibility(log: SimGameLog): JoinCompatibility {
  const row: ReplayRow = replayRow(log);
  const present = new Set(Object.keys(row));
  const expected = expectedReplayColumns(log.turns);
  const missing = expected.filter((column) => !present.has(column));
  const expectedSet = new Set(expected);
  const simOnly = [...present].filter(isSimColumn).sort();
  const unexpected = [...present].filter((column) => !expectedSet.has(column) && !isSimColumn(column)).sort();
  return {
    ok: missing.length === 0 && unexpected.length === 0,
    missing,
    unexpected,
    simOnly,
    columns: present.size,
  };
}

/** The 17lands column name for a re-indexed own-turn coordinate (see `turn-index-base`). */
export function seventeenLandsTurnColumn(owner: Side, ordinal: number, field: string): string {
  return `${owner}_turn_${ordinal}_${field}`;
}

/**
 * One frozen bot-vs-human offset, per metrics report §8 step 6: "Per metric:
 * expected bot-vs-human offset (additive or multiplicative), tolerance band,
 * and the engine+bot version hash it was measured under."
 */
export interface CorrectionEntry {
  readonly metric: string;
  readonly kind: 'additive' | 'multiplicative';
  readonly offset: number;
  readonly tolerance: number;
  /** Engine + bot identity the offset was measured under; never reuse across versions. */
  readonly measuredUnder: string;
  /** Calibration sets it was fitted on; a sign flip between them demotes the metric. */
  readonly sets: readonly string[];
}

export interface CorrectionTable {
  readonly version: string;
  readonly measuredAt: string | null;
  readonly entries: readonly CorrectionEntry[];
}

/**
 * No calibration run has happened. Phase 1 has no real set implemented in the
 * DSL, which is step 2 of the protocol, so there is nothing to fit against.
 */
export const EMPTY_CORRECTION_TABLE: CorrectionTable = {
  version: 'uncalibrated',
  measuredAt: null,
  entries: [],
};

export function correctionFor(table: CorrectionTable, metric: string): CorrectionEntry | undefined {
  return table.entries.find((entry) => entry.metric === metric);
}

/**
 * Applies a correction to a bot-measured value, yielding the human-equivalent
 * estimate. An unknown metric returns the value unchanged — corrections are
 * opt-in per metric, and a missing one means "not calibrated", not "zero".
 */
export function applyCorrection(table: CorrectionTable, metric: string, value: number): number {
  const entry = correctionFor(table, metric);
  if (entry === undefined) return value;
  return entry.kind === 'additive' ? value + entry.offset : value * entry.offset;
}

/** The contract as markdown, for pasting into a calibration ticket or a doc. */
export function formatJoinContract(contract: JoinContract = joinContract()): string {
  const lines = [
    '# 17lands join contract',
    '',
    `Sim log schema: \`${contract.simSchemaVersion}\``,
    '',
    contract.attribution,
    '',
    '## Source',
    '',
    '```',
    contract.urlPattern,
    '```',
    '',
    `Event types: ${SEVENTEEN_LANDS_EVENT_TYPES.join(', ')}.`,
    `Sets with all three data types verified present: ${CALIBRATION_CANDIDATE_SETS.join(', ')}.`,
    '',
    '## Keys',
    '',
    contract.keyColumns.map((column) => `- \`${column}\``).join('\n'),
    '',
    '## Shared columns',
    '',
    `- game level (${contract.sharedGameColumns.length}): ${contract.sharedGameColumns.join(', ')}`,
    `- per-side totals as \`{side}_total_{field}\` (${contract.sharedTotalFields.length}): ${contract.sharedTotalFields.join(', ')}`,
    `- per-turn owner fields as \`{owner}_turn_{N}_{field}\` (${contract.sharedTurnOwnerFields.length}): ${contract.sharedTurnOwnerFields.join(', ')}`,
    `- per-turn side fields as \`{owner}_turn_{N}_{side}_{field}\` (${contract.sharedTurnSideFields.length}): ${contract.sharedTurnSideFields.join(', ')}`,
    `- end-of-turn state as \`{owner}_turn_{N}_eot_{side}_{field}\` (${contract.sharedTurnEotFields.length}): ${contract.sharedTurnEotFields.join(', ')}`,
    '',
    '## Caveats — do not join without these',
    '',
  ];
  for (const caveat of contract.caveats) {
    lines.push(
      `### ${caveat.id}`,
      '',
      `Columns: ${caveat.columns.map((column) => `\`${column}\``).join(', ')}`,
      '',
      `Issue: ${caveat.issue}`,
      '',
      `Transform: ${caveat.transform}`,
      '',
    );
  }
  return lines.join('\n');
}
