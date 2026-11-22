import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { CurveStep } from './build';
import { curveLabel } from './columns';

export const MANA_CURVE_LABEL = 'Mana curve';

export function curveStrip(steps: readonly CurveStep[]): ReactElement | null {
  if (steps.length === 0) return null;
  const tallest = steps.reduce((most, step) => Math.max(most, step.cards), 0);
  return createElement(
    'ul',
    { className: 'mtg-curve', role: 'list', 'aria-label': MANA_CURVE_LABEL },
    ...steps.map((step) =>
      createElement(
        'li',
        {
          key: String(step.manaValue),
          className: 'mtg-curve__step',
          'aria-label': curveLabel(step.manaValue, step.cards),
        },
        createElement('span', { className: 'mtg-curve__count', 'aria-hidden': true }, String(step.cards)),
        createElement(
          'span',
          { className: 'mtg-curve__bar', 'aria-hidden': true },
          createElement('span', {
            className: 'mtg-curve__stem',
            style: { height: `${String(tallest === 0 ? 0 : Math.round((step.cards / tallest) * 100))}%` },
          }),
        ),
        createElement(
          'span',
          { className: 'mtg-curve__value', 'aria-hidden': true },
          `MV ${String(step.manaValue)}`,
        ),
      ),
    ),
  );
}
