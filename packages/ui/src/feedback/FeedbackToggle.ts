/**
 * The switch in the shell bar that turns the feedback helper on and off.
 *
 * `mtg-fvuyq.1`. A pressed button rather than a checkbox, because it sits in
 * the bar beside the mode tabs and the bar's vocabulary is buttons. It is the
 * one part of the helper drawn while the helper is off: something has to be.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

export const FEEDBACK_TOGGLE_LABEL = 'Feedback helper';

export interface FeedbackToggleProps {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
}

export function FeedbackToggle(props: FeedbackToggleProps): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-feedback-toggle',
      'aria-pressed': props.enabled ? 'true' : 'false',
      'aria-label': FEEDBACK_TOGGLE_LABEL,
      title: props.enabled
        ? 'Feedback helper is on: a Report button floats over every page'
        : 'Turn on the feedback helper to report a UI/UX issue from any page',
      onClick: (): void => {
        props.onChange(!props.enabled);
      },
    },
    props.enabled ? 'Feedback on' : 'Feedback',
  );
}
