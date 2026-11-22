/**
 * The free run: this brief, generated from recorded fixtures.
 *
 * `mtg-yddw.5`. What it costs is nothing, and that is structural rather than
 * configured. `@mtg/setgen`'s `design/run.ts` builds its provider with
 * `createFixtureProvider({ record: false })` and there is no branch in it that
 * can reach a paid one; a server started without a runner answers 404 here. So
 * there is no budget field on this panel and no confirmation before the press —
 * both would imply a version of this button that spends money, and none exists.
 *
 * A paid run is a command at a terminal, typed by a person, with `--max-usd` on
 * it. The panel names that command in exactly one case: when the failure is a
 * fixture this checkout has never recorded, which is the one failure recording
 * would fix.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { RunAnswer } from './client';
import { panel } from './fields';

export const RUN_TITLE = 'Run it against recorded answers';

const RUN_EXPLAIN =
  'Replays the generation from fixtures already on disk. It calls no model and spends nothing, so it says whether this brief runs — not whether the cards are good.';

export const RUN_LABEL = 'Run the brief';

export const RUNNING_LABEL = 'Running…';

export const NOT_RUN_NOTE = 'Not run yet.';

/**
 * What is still keeping the brief from running, counted where the button is.
 *
 * `mtg-dcxg.3`. The count used to sit in the verdict panel as "7 fields are
 * refused, marked above", said over a form with nothing marked. It belongs to
 * this button: it is the number of fields between a person and the one control
 * they cannot press yet.
 */
export function outstandingNote(fields: number): string {
  return fields === 1
    ? 'One field still needs an answer before this can run.'
    : `${String(fields)} fields still need an answer before this can run.`;
}

export const RECORD_COMMAND =
  'npx tsx packages/setgen/src/cli.ts --brief <brief.json> --record --max-usd <n>';

export function generatedNote(cards: number, enforceable: boolean): string {
  const count = `${String(cards)} cards came back.`;
  return enforceable
    ? `${count} Every one of them passes the deterministic gates, so the set is runnable.`
    : `${count} At least one fails a deterministic gate, so the set is not runnable as it stands.`;
}

export function unrecordedNote(reason: string): string {
  return `${reason}. That is a fixture this checkout has never recorded rather than a brief the pipeline refused; recording one is a paid run at a terminal: ${RECORD_COMMAND}`;
}

export interface RunPanelProps {
  readonly answer: RunAnswer | null;
  readonly running: boolean;
  readonly onRun: () => void;
  /** False while the brief is not legal: there is nothing to run yet. */
  readonly canRun: boolean;
  /** How many fields the server refused, whether or not they are marked yet. */
  readonly outstanding: number;
}

function sentence(answer: RunAnswer): string {
  switch (answer.kind) {
    case 'generated':
      return generatedNote(answer.cards, answer.enforceable);
    case 'invalid':
      return 'The brief is refused, so nothing was run.';
    case 'refused':
      return answer.unrecorded ? unrecordedNote(answer.reason) : answer.reason;
    default:
      return answer.reason;
  }
}

export function RunPanel(props: RunPanelProps): ReactElement {
  const { answer, running, onRun, canRun, outstanding } = props;
  return panel(
    RUN_TITLE,
    RUN_EXPLAIN,
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'data-variant': 'primary',
          disabled: running || !canRun,
          onClick: onRun,
        },
        running ? RUNNING_LABEL : RUN_LABEL,
      ),
    ),
    canRun || outstanding === 0
      ? null
      : createElement('p', { className: 'mtg-design__hint' }, outstandingNote(outstanding)),
    createElement(
      'p',
      {
        className: 'mtg-design__verdict',
        'data-state': answer === null ? 'none' : answer.kind,
        role: 'status',
      },
      answer === null ? NOT_RUN_NOTE : sentence(answer),
    ),
  );
}
