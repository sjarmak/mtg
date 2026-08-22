/**
 * The bot's decision, with everything the kernel offered.
 *
 * This panel is the reason the replay viewer exists as a debugging surface. The
 * kernel enumerates legal options at every choice point; printing the list next
 * to the option the bot took is what makes a bad heuristic (chose the wrong one
 * of four) distinguishable from an engine bug (the right one was never offered)
 * without attaching a debugger.
 *
 * Two honesty rules are enforced here. A truncated option list says so and
 * names the true count. A decision whose chosen action is *not* in the list —
 * the tier-1 bots construct their own attack and block declarations rather than
 * sampling the enumeration — says that too, rather than quietly starring
 * nothing.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describeAction, describeDecision, optionLabels } from './narrate';
import type { ReplayNames } from './narrate';
import type { LogAction, LogDecision } from './log-schema';

export interface DecisionPanelProps {
  readonly decision: LogDecision | null;
  readonly names: ReplayNames;
  /** Shown when the step carries no decision, e.g. the opening frame. */
  readonly emptyText: string;
}

function optionRow(label: string, index: number, chosen: boolean): ReactElement {
  return createElement(
    'tr',
    { key: `${index}`, 'data-option': String(index), 'data-chosen': chosen },
    createElement(
      'td',
      null,
      chosen
        ? createElement('span', { className: 'mtg-badge', 'data-tone': 'positive' }, 'chose')
        : createElement('span', { className: 'mtg-num' }, String(index + 1)),
    ),
    createElement('td', null, label),
  );
}

function optionTable(decision: LogDecision, names: ReplayNames): ReactElement {
  const labels = optionLabels(decision.options, names);
  return createElement(
    'div',
    { className: 'mtg-scroll' },
    createElement(
      'table',
      { className: 'mtg-table' },
      createElement(
        'thead',
        null,
        createElement('tr', null, createElement('th', null, ''), createElement('th', null, 'legal option')),
      ),
      createElement(
        'tbody',
        null,
        ...labels.map((label, index) => optionRow(label, index, decision.chosen === index)),
      ),
    ),
  );
}

function notes(decision: LogDecision): readonly string[] {
  const out: string[] = [];
  if (decision.truncated) {
    out.push(
      `Showing ${decision.options.length} of ${decision.optionCount} enumerated options; the log keeps a prefix plus the one taken.`,
    );
  }
  if (!decision.complete) {
    out.push('The kernel hit its enumeration cap here, so this list is a sample of the legal space.');
  }
  if (decision.chosen === null) {
    out.push('The bot constructed this declaration itself rather than picking an enumerated option.');
  }
  return out;
}

export function DecisionPanel(props: DecisionPanelProps): ReactElement {
  const { decision, names } = props;
  const body: ReactNode[] =
    decision === null
      ? [
          createElement(
            'div',
            { key: 'empty', className: 'mtg-empty' },
            createElement('span', { className: 'mtg-empty__title' }, 'No decision on this step'),
            createElement('span', { className: 'mtg-empty__body' }, props.emptyText),
          ),
        ]
      : [
          createElement('p', { key: 'ask', className: 'mtg-hint' }, describeDecision(decision, names)),
          optionTable(decision, names),
          ...notes(decision).map((note, index) =>
            createElement('p', { key: `note-${index}`, className: 'mtg-hint' }, note),
          ),
        ];

  return createElement(
    'section',
    // `mtg-prompt` as well as `mtg-panel`, because this is the ask column's
    // block on this route the way the move list is on the played one
    // (`ReplayViewer.ts`): the compact head, the floored and internally
    // scrolling body and the cut-edge shadows are all declared once against
    // that class in `styles/views.ts`, and a second set of rules for the same
    // job in the same column is the pair that drifts.
    { className: 'mtg-panel mtg-prompt', 'aria-label': 'Decision' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'Decision'),
      createElement(
        'span',
        { className: 'mtg-panel__note' },
        decision === null ? 'setup' : `${decision.optionCount} legal options`,
      ),
    ),
    createElement('div', { className: 'mtg-panel__body' }, ...body),
  );
}

/**
 * The action taken, as a badge-sized phrase. Read off the step's own action
 * rather than the chosen index, because a bot-constructed declaration has no
 * index into the enumerated list.
 */
export function actionSummary(action: LogAction | null, names: ReplayNames): string {
  return action === null ? '—' : describeAction(action, names);
}
