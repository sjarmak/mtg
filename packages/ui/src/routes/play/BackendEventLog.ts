import { createElement, useState } from 'react';
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import type { EngineEvent } from '@mtg/engine';
import { DENSITY_GROUP_LABEL, DENSITY_LABELS } from '../../log/GameLog';
import type { LogDensity } from '../../log/group';
import { seatVerb } from '../../seat';

const BACKEND_LOG_DENSITIES: readonly LogDensity[] = ['story', 'detail', 'everything'];
const BACKEND_LOG_LIMITS: Readonly<Record<Exclude<LogDensity, 'everything'>, number>> = {
  story: 20,
  detail: 100,
};

export interface BackendEventLogProps {
  readonly events: readonly EngineEvent[];
  readonly localSeat: string;
  readonly openingRoll: string | null;
}

function viewerEventText(text: string, localSeat: string): string {
  const thirdPersonPrefix = `${localSeat} has`;
  if (text !== thirdPersonPrefix && !text.startsWith(`${thirdPersonPrefix} `)) return text;
  const agreedVerb = seatVerb(localSeat, 'has', 'have');
  return agreedVerb === 'has' ? text : `${localSeat} ${agreedVerb}${text.slice(thirdPersonPrefix.length)}`;
}

function eventLines(props: BackendEventLogProps, events: readonly EngineEvent[]): readonly ReactElement[] {
  const lead =
    props.openingRoll === null
      ? []
      : [
          createElement(
            'li',
            { key: 'opening-roll', className: 'mtg-log__line' },
            createElement('span', { className: 'mtg-log__num' }, '·'),
            createElement('span', { className: 'mtg-log__text' }, props.openingRoll),
          ),
        ];
  return [
    ...lead,
    ...events.map((event) =>
      createElement(
        'li',
        { key: event.seq, className: 'mtg-log__line' },
        createElement('span', { className: 'mtg-log__num' }, String(event.seq + 1)),
        createElement('span', { className: 'mtg-log__text' }, viewerEventText(event.text, props.localSeat)),
      ),
    ),
  ];
}

function densityControls(
  density: LogDensity,
  setDensity: Dispatch<SetStateAction<LogDensity>>,
  hidden: number,
): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-log__foot' },
    createElement(
      'div',
      { className: 'mtg-log__levels', role: 'group', 'aria-label': DENSITY_GROUP_LABEL },
      ...BACKEND_LOG_DENSITIES.map((level) =>
        createElement(
          'button',
          {
            key: level,
            type: 'button',
            className: 'mtg-btn mtg-log__density',
            'aria-pressed': density === level,
            onClick: (): void => setDensity(level),
          },
          DENSITY_LABELS[level],
        ),
      ),
    ),
    createElement(
      'span',
      { className: 'mtg-log__hidden' },
      hidden === 0 ? 'nothing hidden' : `${String(hidden)} hidden`,
    ),
  );
}

export function BackendEventLog(props: BackendEventLogProps): ReactElement {
  const [density, setDensity] = useState<LogDensity>('story');
  const shownEvents =
    density === 'everything' ? props.events : props.events.slice(-BACKEND_LOG_LIMITS[density]);
  const lines = eventLines(props, shownEvents);
  return createElement(
    'div',
    { className: 'mtg-log', 'data-density': density },
    lines.length === 0
      ? createElement('p', { className: 'mtg-page-note' }, 'No events yet')
      : createElement('ol', { className: 'mtg-log__lines' }, ...lines),
    densityControls(density, setDensity, props.events.length - shownEvents.length),
  );
}
