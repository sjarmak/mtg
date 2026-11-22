/**
 * The Analysis tab's `evidence` section: every staged ledger and recorded game
 * about the selected set, format or cube, with how strong each piece is.
 *
 * Strength is the column that matters and the one the table refuses to
 * flatten. A games row says how many trials were scheduled and how many
 * finished; a statistics row says it carries a summary and no rows; a judgment
 * row says it is model-authored and prints no game count at all, because a
 * model's review of a deck is not evidence that the deck won anything. The
 * shape in `./evidence-record.ts` makes that a type rather than a convention.
 *
 * Four states, drawn as themselves the way the run sections do: loading,
 * absent (which names both commands that stage the file), failed (the reader's
 * own sentence) and ready. Ready is scoped to the page's selected subject
 * through the one join key, and says so; with nothing selected it lists every
 * record and says that too, since a list that quietly widened its scope would
 * read as evidence about whatever set the header happens to name.
 *
 * The skipped and truncated lists print the scanner's own `why`, verbatim. A
 * ledger the scanner refused is a fact about the ledger and the repair is in
 * the sentence; a trials file over the byte budget names the flag that lifts
 * it. Neither is hidden behind a count.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderCopy } from '../../copy';
import { DataTable } from './chart';
import type { TableRow } from './chart';
import { FAMILY_LABELS, recordsFor } from './evidence-record';
import type { EvidenceRecord, EvidenceSnapshot, EvidenceState, EvidenceStrength } from './evidence-record';

export const EVIDENCE_SECTION_LABEL = 'Evidence';

/** The direct command, for the absent state and the truncated rows. */
export const STAGE_EVIDENCE_COMMAND = 'npx tsx packages/ui/tools/stage-evidence.ts';

export interface EvidencePanelProps {
  readonly state: EvidenceState;
  /** The selected subject's join key, or null when the page has no selection. */
  readonly subjectKey: string | null;
}

const COLUMNS = ['Subject', 'Family', 'Matchup', 'Strength', 'Games', 'Produced', 'Path'] as const;

function empty(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The calendar day of an ISO timestamp, which is what a ledger's age reads as. */
export function producedDay(produced: string | null): string {
  if (produced === null) return 'not stated';
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(produced);
  return day?.[1] ?? produced;
}

function stated(value: boolean | null): string {
  return value === null ? 'not stated' : value ? 'yes' : 'no';
}

/** The strength column: one word, and for a judgment the word that qualifies it. */
export function strengthLabel(evidence: EvidenceStrength): string {
  switch (evidence.strength) {
    case 'games':
      return 'games';
    case 'statistics':
      return 'statistics';
    case 'judgment':
      return 'judgment (model-authored)';
  }
}

/** The games column, which is a count only when the evidence is games. */
export function gamesLabel(evidence: EvidenceStrength): string {
  switch (evidence.strength) {
    case 'games': {
      const head = `${String(evidence.trials.completed)} of ${String(evidence.trials.attempted)} finished`;
      if (evidence.arms === null) return head;
      const { baseline, candidate } = evidence.arms;
      return (
        `${head} (baseline ${String(baseline.completed)}/${String(baseline.attempted)}, ` +
        `candidate ${String(candidate.completed)}/${String(candidate.attempted)})`
      );
    }
    case 'statistics':
      return 'summary only, no game rows';
    case 'judgment':
      return 'no game count';
  }
}

function subjectLabel(record: EvidenceRecord): string {
  const { subject } = record;
  const code = subject.code === null || subject.code === subject.id ? '' : ` (${subject.code})`;
  return `${subject.id}${code}`;
}

function row(record: EvidenceRecord, index: number): TableRow {
  const status =
    record.evidence.strength === 'games' && record.evidence.status !== null ? record.evidence.status : null;
  return {
    key: `${record.path}#${String(index)}`,
    cells: [
      subjectLabel(record),
      FAMILY_LABELS[record.family],
      record.matchup ?? 'not stated',
      status === null ? strengthLabel(record.evidence) : `${strengthLabel(record.evidence)}, ${status}`,
      gamesLabel(record.evidence),
      producedDay(record.produced),
      record.path,
    ],
  };
}

/** One sentence per judgment record, since its provenance is the whole of what it offers. */
function judgmentNotes(records: readonly EvidenceRecord[]): ReactElement | null {
  const notes = records.flatMap((record) =>
    record.evidence.strength === 'judgment'
      ? [
          createElement(
            'li',
            { key: record.path },
            `${record.path}: written by ${record.evidence.origin}; independent human evidence ` +
              `${stated(record.evidence.independentHumanEvidence)}; adoption eligible ` +
              `${stated(record.evidence.adoptionEligible)}.`,
          ),
        ]
      : [],
  );
  if (notes.length === 0) return null;
  return createElement(
    'div',
    { className: 'mtg-panel', 'aria-label': 'Model-authored evidence' },
    createElement('h3', { className: 'mtg-panel__title' }, 'Model-authored, not played'),
    createElement('ul', { className: 'mtg-panel__body' }, ...notes),
  );
}

function refusals(snapshot: EvidenceSnapshot): ReactElement | null {
  const truncated = snapshot.truncated.map((entry) =>
    createElement(
      'li',
      { key: `t:${entry.path}` },
      renderCopy(
        `${entry.path}: ${megabytes(entry.bytes)} is over this run's ${megabytes(entry.budget)} budget. ` +
          `Run \`${STAGE_EVIDENCE_COMMAND} --budget ${String(entry.bytes)}\` to include it.`,
      ),
    ),
  );
  const skipped = snapshot.skipped.map((entry) =>
    createElement('li', { key: `s:${entry.path}` }, renderCopy(`${entry.path}: ${entry.why}`)),
  );
  if (truncated.length === 0 && skipped.length === 0) return null;
  return createElement(
    'div',
    { className: 'mtg-panel', 'aria-label': 'Ledgers not read' },
    createElement('h3', { className: 'mtg-panel__title' }, 'Not read'),
    createElement('ul', { className: 'mtg-panel__body' }, ...truncated, ...skipped),
  );
}

function scopeSentence(snapshot: EvidenceSnapshot, subjectKey: string | null, shown: number): string {
  const total = snapshot.records.length;
  if (subjectKey === null) {
    return `No set is selected, so this lists every staged record: ${String(total)} in all.`;
  }
  if (shown === 0) {
    return `Nothing staged is about ${subjectKey}. ${String(total)} records are about other subjects.`;
  }
  return `${String(shown)} of ${String(total)} staged records are about ${subjectKey}.`;
}

function ready(snapshot: EvidenceSnapshot, subjectKey: string | null): ReactNode[] {
  const records = recordsFor(snapshot, subjectKey);
  const scope = createElement(
    'p',
    { className: 'mtg-panel__note' },
    `${scopeSentence(snapshot, subjectKey, records.length)} Scanned ${producedDay(snapshot.scannedAt)} over ${snapshot.outRoot}.`,
  );
  if (snapshot.records.length === 0) {
    return [
      scope,
      empty(
        'Nothing staged',
        `The scan found no ledger under \`out/\` and no recorded game under \`data/gameplay/\`. ` +
          `Play or measure something, then run \`npm run play\` again.`,
      ),
      refusals(snapshot),
    ];
  }
  const table =
    records.length === 0
      ? null
      : createElement(DataTable, {
          columns: [...COLUMNS],
          rows: records.map(row),
          numericFrom: COLUMNS.length,
        });
  return [scope, table, judgmentNotes(records), refusals(snapshot)];
}

export function EvidencePanel(props: EvidencePanelProps): ReactElement {
  const { state } = props;
  const body: ReactNode[] = (() => {
    switch (state.status) {
      case 'loading':
        return [empty('Reading the staged evidence', 'One moment.')];
      case 'absent':
        return [
          empty(
            'Nothing staged',
            `Run \`npm run play\` to scan the ledgers under \`out/\` and the recorded games under ` +
              `\`data/gameplay/\` into the page, or run \`${STAGE_EVIDENCE_COMMAND}\` on its own.`,
          ),
        ];
      case 'failed':
        return [empty('That evidence snapshot could not be read', state.message)];
      case 'ready':
        return ready(state.snapshot, props.subjectKey);
    }
  })();
  return createElement(
    'div',
    { className: 'mtg-analysis', 'aria-label': EVIDENCE_SECTION_LABEL },
    createElement('h2', { className: 'mtg-panel__title' }, EVIDENCE_SECTION_LABEL),
    ...body,
  );
}
