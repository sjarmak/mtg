/**
 * What each section of the lab draws, worked out off the route.
 *
 * `mtg-a982g.1`. `./LabApp.ts` is the one file that knows every source the lab
 * can stage, and it is sixteen hundred lines of that knowledge. What a section
 * needs from the route is arithmetic over the hash: which opponent the link
 * names, whether a draft has left the chooser and owns the page, and which page
 * a printed selection is on. That arithmetic lives here so the app file stops
 * growing, and so a test can ask it without mounting the lab.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { GameBackend } from '@mtg/engine';
import type { UiRoute, UiRouter } from '../app/router';
import { AGAINST_PARAM, VS_PARAM, opponentOf } from '../routes/play/availability';
import type { Opponent, PlayFormat } from '../routes/play/availability';
import { OBSERVED_TOKEN_PREFIX } from '../routes/play/ObservedSeat';
import { PrintedSelectionRoute } from '../routes/printed/PrintedSelectionRoute';
import type { PrintedPage } from '../routes/printed/page';
import type { PreconLanPlay } from '../routes/printed/lan-precon';
import type { GatewayReadiness } from '../net/gateway-readiness';
import type { PrintedSelectionState } from '../routes/printed/use-printed-format';

/** The Play section the route is on; any other mode reads as the default. */
export function playSub(route: UiRoute): PlayFormat {
  return route.mode === 'play' ? route.sub : 'constructed';
}

export interface PlayOpponentProps {
  readonly sub: PlayFormat;
  readonly opponent: Opponent;
  readonly onOpponent: (opponent: Opponent) => void;
}

/**
 * Which section this is and which column is open, read off the hash and
 * written back to it (`../routes/play/availability.ts` owns the reading).
 *
 * The bot is the default and is written away rather than in, so a link to the
 * ordinary chooser stays `#/play/<sub>` with nothing after it.
 */
export function playOpponentProps(router: UiRouter): PlayOpponentProps {
  return {
    sub: playSub(router.route),
    opponent: opponentOf(router.route.params),
    onOpponent: (opponent: Opponent): void => {
      router.setParams({ [VS_PARAM]: opponent === 'bot' ? '' : opponent });
    },
  };
}

/**
 * The params a dealt seat writes: its own token, and nothing the local game
 * left behind. A table has its own decks and its own shuffle, so a leftover
 * `?deck=` or `?seed=` would name neither; the other address goes too, because
 * a page cannot be at a table and in a room at once.
 */
export function seatParams(kind: 'table' | 'room', token: string): Readonly<Record<string, string>> {
  return { table: '', room: '', [kind]: token, deck: '', [AGAINST_PARAM]: '', seed: '' };
}

/**
 * Whether the route has left its landing and owns the whole page.
 *
 * `mtg-a982g.5`. Every Play section draws the same landing -- the set's name,
 * the sets it could play, the two opponents, the one press
 * (`../routes/play/PlayLanding.ts`) -- until something is dealt, and then the
 * thing dealt is the page. Three states say so, and all three are in the hash:
 * a seat at a table or in a room, and a seed, which names one exact draft or
 * one exact pool. A game that is state rather than a param says so itself
 * (`../routes/play/PlayChooser.ts` reports `playing`).
 */
export function routeTakesThePage(route: UiRoute): boolean {
  if (route.mode !== 'play') return false;
  if (routeSeats(route)) return true;
  const { params } = route;
  return (route.sub === 'draft' || route.sub === 'sealed') && params['seed'] !== undefined;
}

/**
 * Whether the route is a seat at a table or in a room on a server.
 *
 * Split out of the rule above because it decides something more than layout:
 * a seat is dealt by whichever lab opened the room and it deals the kernel's
 * cards, so `../routes/PlayRoute.ts` owns that page whatever this tab's
 * section is showing. A printed format and the cube know nothing about seats,
 * and a link to a room that resolved to one of them would answer a seat with a
 * sealed offer.
 */
export function routeSeats(route: UiRoute): boolean {
  if (route.mode !== 'play') return false;
  const { params } = route;
  return (params['table'] ?? '') !== '' || (params['room'] ?? '') !== '';
}

/**
 * Whether the seat in the hash is one at a Forge table over the network.
 *
 * `routeSeats` above sends a seat to `../routes/PlayRoute.ts` because a kernel
 * table deals the kernel's cards. A Forge table deals a printed format's or the
 * cube's, and a seat at one builds its deck on that source's own page, so the
 * token says which route owns it: the observed arm mints `obs-`
 * (`../routes/play/ObservedSeat.ts`) and nothing else does.
 */
export function routeSeatsObserved(route: UiRoute): boolean {
  return route.mode === 'play' && (route.params['table'] ?? '').startsWith(OBSERVED_TOKEN_PREFIX);
}

export interface PrintedSelection {
  readonly state: PrintedSelectionState;
  readonly title: string;
  readonly sourceCode: string | undefined;
}

/** One printed selection, on the page the section is. */
export function printedSelection(
  printed: PrintedSelection,
  page: PrintedPage,
  router: UiRouter,
  backend: GameBackend,
  onPlayingChange?: (playing: boolean) => void,
  lanPlay?: PreconLanPlay,
  gatewayReadiness?: GatewayReadiness,
): ReactElement {
  return createElement(PrintedSelectionRoute, {
    state: printed.state,
    title: printed.title,
    sourceCode: printed.sourceCode,
    page,
    route: router.route,
    onSetParams: router.setParams,
    backend,
    ...(onPlayingChange === undefined ? {} : { onPlayingChange }),
    ...(lanPlay === undefined ? {} : { lanPlay }),
    ...(gatewayReadiness === undefined ? {} : { gatewayReadiness }),
  });
}
