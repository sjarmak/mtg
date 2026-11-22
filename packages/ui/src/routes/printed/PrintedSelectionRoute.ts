/**
 * The one place a printed selection is narrowed by kind.
 *
 * A Limited format opens packs and a constructed one lists decks, and the two
 * pages share nothing but the loading shell, so the tab hands the selection
 * here and this picks the route. Every tab renders it the same way and says
 * which page it is (`./page.ts`); the route reads the seed and the deck off the
 * hash and nothing else.
 */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import type { GameBackend } from '@mtg/engine';
import type { UiRoute } from '../../app/router';
import { observedSeatLink } from '../play/ObservedSeat';
import { DEFAULT_TABLE_BASE } from '../PlayRoute';
import type { PrintedPage } from './page';
import { PrintedFormatRoute } from './PrintedFormatRoute';
import { PrintedPreconRoute } from './PrintedPreconRoute';
import type { PreconLanPlay } from './lan-precon';
import type { PrintedSelectionState } from './use-printed-format';
import type { GatewayReadiness } from '../../net/gateway-readiness';

interface Props {
  readonly state: PrintedSelectionState;
  readonly title: string;
  readonly sourceCode: string | undefined;
  readonly page: PrintedPage;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  readonly backend?: GameBackend;
  /** Passed to a constructed format's decks, which seat a table in their own state. */
  readonly onPlayingChange?: (playing: boolean) => void;
  /** The LAN press a constructed format's decks draw beside the Forge one (`./lan-precon.ts`). */
  readonly lanPlay?: PreconLanPlay;
  readonly gatewayReadiness?: GatewayReadiness;
}

export function PrintedSelectionRoute(props: Props): ReactElement {
  const { state, onPlayingChange, lanPlay, gatewayReadiness, ...shared } = props;
  const observed = observedSeatLink(props.route.params, DEFAULT_TABLE_BASE);
  const rest = { ...shared, ...(observed === undefined ? {} : { observed }) };
  if (state.status !== 'ready') return h(PrintedFormatRoute, { ...rest, state });
  if (state.value.kind === 'constructed') {
    return h(PrintedPreconRoute, {
      ...rest,
      loaded: state.value.loaded,
      ...(onPlayingChange === undefined ? {} : { onPlayingChange }),
      ...(lanPlay === undefined ? {} : { lanPlay }),
      ...(gatewayReadiness === undefined ? {} : { gatewayReadiness }),
    });
  }
  if (props.page === 'constructed' && state.value.constructed !== undefined) {
    return h(PrintedPreconRoute, {
      ...rest,
      loaded: state.value.constructed,
      ...(onPlayingChange === undefined ? {} : { onPlayingChange }),
      ...(gatewayReadiness === undefined ? {} : { gatewayReadiness }),
    });
  }
  return h(PrintedFormatRoute, { ...rest, state: { status: 'ready', value: state.value.loaded } });
}
