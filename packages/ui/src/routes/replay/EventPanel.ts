/**
 * What the reducer did, in English.
 *
 * One line per kernel event, in emission order, plus the board notes the card
 * face cannot carry (a creature whose derived power and toughness differ from
 * its printed ones). A step that produced no events says so — that is a real
 * and common outcome (a passed priority into an empty stack) and hiding it
 * would make the transport feel broken.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { describeEvent } from './narrate';
import type { ReplayNames } from './narrate';
import type { BoardNote } from './frame';
import type { LogEvent } from './log-schema';

export interface EventPanelProps {
  readonly events: readonly LogEvent[];
  readonly notes: readonly BoardNote[];
  readonly names: ReplayNames;
}

export function EventPanel(props: EventPanelProps): ReactElement {
  const lines: ReactNode[] =
    props.events.length === 0
      ? [
          createElement(
            'p',
            { key: 'none', className: 'mtg-zone__empty' },
            'this step changed nothing on the board',
          ),
        ]
      : [
          createElement(
            'ol',
            { key: 'events', className: 'mtg-pile' },
            ...props.events.map((event, index) =>
              createElement(
                'li',
                { key: `${index}`, className: 'mtg-pile__row' },
                createElement('span', { className: 'mtg-num' }, String(index + 1)),
                createElement('span', null, describeEvent(event, props.names)),
              ),
            ),
          ),
        ];

  const notes = props.notes.map((note) =>
    createElement('p', { key: note.key, className: 'mtg-hint' }, note.text),
  );

  return createElement(
    'section',
    { className: 'mtg-panel', 'aria-label': 'What happened' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'What happened'),
      createElement(
        'span',
        { className: 'mtg-panel__note' },
        `${props.events.length} event${props.events.length === 1 ? '' : 's'}`,
      ),
    ),
    createElement('div', { className: 'mtg-panel__body' }, ...lines, ...notes),
  );
}
