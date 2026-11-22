/** Legacy catalog loading states over the shared printed-card gallery. */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import type { UiRoute } from '../../app/router';
import type { LegacyCubeCatalogState } from './LegacyCubeRoute';
import { PrintedCardsGallery } from '../printed/PrintedCardsGallery';
export { matchesPrintedCard as matchesCubeCard } from '../printed/PrintedCardsGallery';

export const CUBE_SET_NAME = 'MTGO Legacy Cube';
const DESCRIPTION = 'August 2021 · Full 600-card cube · Printed cards';
interface Props {
  readonly catalog: LegacyCubeCatalogState;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
}

export function CubeCardsRoute(props: Props): ReactElement {
  if (props.catalog.status === 'ready') {
    return h(PrintedCardsGallery, {
      cards: props.catalog.catalog.cards,
      title: CUBE_SET_NAME,
      description: DESCRIPTION,
      route: props.route,
      onSetParams: props.onSetParams,
    });
  }
  const message =
    props.catalog.status === 'failed'
      ? props.catalog.message
      : props.catalog.status === 'loading'
        ? 'Reading Legacy Cube cards…'
        : 'Legacy Cube is not staged.';
  return h(
    'div',
    null,
    h('div', { className: 'mtg-page-head' }, h('h1', null, CUBE_SET_NAME), h('p', null, DESCRIPTION)),
    h('p', { role: 'status' }, message),
  );
}
