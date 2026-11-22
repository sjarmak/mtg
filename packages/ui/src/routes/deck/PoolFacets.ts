/**
 * The color facets over a pool, and the count of what they leave showing.
 *
 * Both builders narrow a pool and both narrow it by color first, so the row of
 * six buttons is written once (`mtg-aqxi.4`). What differs is everything
 * around it: the Constructed pool is every playable card and carries a search
 * box and a set facet beside these, while the sealed pool is seventy-two cards
 * and carries nothing else — `./pool-filter.ts` argues why searching that is
 * not worth a control.
 *
 * The buttons are `aria-pressed` toggles rather than a listbox, for the reason
 * `../../panel/ContextRail.ts` gives about its own: a filter is not a
 * navigation, and a set of independent toggles is what a person operating one
 * color at a time is actually doing.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { symbolElement } from '../../card/SymbolText';
import { DEFAULT_SYMBOL_SET } from '../../card/symbols';
import { COLOR_FACET_NAMES, COLOR_FACETS, isWholePool, toggleColor, WHOLE_POOL } from './pool-filter';
import type { ColorFacet, PoolFilter } from './pool-filter';

/** Names the control that puts a narrowed pool back, so a reading can find it. */
export const CLEAR_FILTER_LABEL = 'Show every card';

export interface PoolFacetsProps {
  readonly filter: PoolFilter;
  readonly onFilter: (filter: PoolFilter) => void;
}

/** The six toggles, one per color plus colorless. */
export function poolFacetButtons(props: PoolFacetsProps): readonly ReactElement[] {
  const { filter, onFilter } = props;
  return COLOR_FACETS.map((facet: ColorFacet) => {
    const symbol = symbolElement(`pool-facet-${facet}`, facet, DEFAULT_SYMBOL_SET);
    if (symbol === null) throw new Error(`PoolFacets: symbol registry has no {${facet}}`);
    return createElement(
      'button',
      {
        key: facet,
        type: 'button',
        className: 'mtg-btn',
        'aria-pressed': filter.colors.includes(facet),
        'aria-label': COLOR_FACET_NAMES[facet],
        onClick: (): void => {
          onFilter(toggleColor(filter, facet));
        },
      },
      symbol,
    );
  });
}

/**
 * The control that puts the whole pool back.
 *
 * Always drawn, dark while the pool is whole, rather than appearing once
 * something is narrowed: a control that comes and goes moves everything beside
 * it, and this row is a row of small targets on a phone.
 */
export function clearFilterButton(props: PoolFacetsProps): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      disabled: isWholePool(props.filter),
      onClick: (): void => {
        props.onFilter(WHOLE_POOL);
      },
    },
    CLEAR_FILTER_LABEL,
  );
}
