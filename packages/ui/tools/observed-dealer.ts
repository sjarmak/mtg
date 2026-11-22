/**
 * The dealer behind a Forge table over the LAN, built from what the launcher knows.
 *
 * `@mtg/netplay`'s `createObservedDealer` seats two people at one observed
 * backend session and knows nothing about this machine: which addresses it
 * answers on, which port the page is served from, and which page a seat opens
 * are all launcher facts, the way `table-dealer.ts` argues for a kernel table.
 * This file supplies them.
 *
 * # The link opens the section that holds the deck builder
 *
 * A kernel table's guest link opens a Play section and the page reads the seat
 * off the `table=` token. A Forge table's seats build their decks first, and
 * which section holds that builder is the section the format is offered under:
 * the Legacy Cube is drafted, a printed limited format is sealed, and a printed
 * constructed format is a Commander precon. `packages/ui/src/routes/play/sources.ts`
 * is what lists a format under a section, and it reads the staged index row's
 * `kind`, so the same row decides the link here. The link carries `source=`
 * beside `table=`, and the page mounts the seat when the token starts with
 * `obs-`. Nothing in the app shell learns a new route for it.
 *
 * The addresses are read per table rather than at boot, for the reason the
 * kernel dealer reads them then: a laptop that joined a network after
 * `npm run play` started has an address the launcher never saw.
 */
import type { ObservedBackend } from '@mtg/engine';
import { createObservedDealer, observedSeatName } from '@mtg/netplay';
import type {
  ObservedClock,
  ObservedDealer,
  ObservedEndReason,
  ObservedTable,
  ObservedTableCapture,
  SeatTokens,
  TableInvite,
} from '@mtg/netplay';
import type { InterfaceInfo } from './lan-address';
import { tableInvite } from './netplay-links';
import type { SeatLinkPage } from './netplay-links';
import type { PrintedFormatRow } from '../src/lab/printed-format';
import { LEGACY_CUBE_FORMAT } from '../src/routes/legacy-cube/model';

/** What a staged printed format says about where its games are built and seated. */
export type SeatFormat = Pick<PrintedFormatRow, 'id' | 'kind'>;

export interface ObservedDealerOptions {
  /** The composite the gateway serves, so a LAN table plays the same backend a bot game does. */
  readonly backend: ObservedBackend;
  /** The formats that composite routes, which is what `/api/health` advertises. */
  readonly formats: readonly string[];
  /** The staged index's rows, which say which section each printed format is played on. */
  readonly printed: readonly SeatFormat[];
  /** The port the page is served on, which is the port a link has to carry. */
  readonly webPort: number;
  /** Read per table; `networkInterfaces` from `node:os` in the launcher. */
  readonly interfaces: () => Readonly<Record<string, readonly InterfaceInfo[] | undefined>>;
  /** Token minting, injectable so a test can say which token went where. */
  readonly mint?: () => string;
  readonly clock?: ObservedClock;
  /** Handed each finished game exactly once; the recorder's seam. */
  readonly onFinished?: (capture: ObservedTableCapture) => void;
  /** Handed each table that ends without a result; the launcher's log seam (mtg-72fjo). */
  readonly onEnded?: (table: ObservedTable, reason: ObservedEndReason, message: string) => void;
}

/** The Play section a seat at a table of this format opens, and how it names the format there. */
export function observedSeatPage(format: string, printed: readonly SeatFormat[]): SeatLinkPage {
  if (format === LEGACY_CUBE_FORMAT) return { sub: 'draft', params: { source: format } };
  const row = printed.find((entry) => entry.id === format);
  if (row === undefined) {
    throw new Error(`No staged printed format is named ${format}, so a seat at its table has no page.`);
  }
  return {
    sub: row.kind === 'constructed' ? 'commander' : 'sealed',
    params: { source: `printed:${format}` },
  };
}

export function observedDealer(options: ObservedDealerOptions): ObservedDealer {
  // A format the lab advertises and cannot name a seat page for is a
  // disagreement between the staged index and the admitted formats. It is
  // raised here, while the launcher is still printing, rather than under
  // somebody's press of Start.
  for (const format of options.formats) observedSeatPage(format, options.printed);
  const invite = (table: ObservedTable, tokens: SeatTokens): TableInvite =>
    tableInvite({
      names: tokens.map((_token, seat) =>
        seat === 1 && table.request.deck !== undefined ? table.request.deck.name : observedSeatName(seat),
      ),
      tokens,
      port: options.webPort,
      interfaces: options.interfaces(),
      param: 'table',
      page: observedSeatPage(table.request.format, options.printed),
    });
  return createObservedDealer({
    backend: options.backend,
    formats: options.formats,
    invite,
    ...(options.mint === undefined ? {} : { mint: options.mint }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onFinished === undefined ? {} : { onFinished: options.onFinished }),
    ...(options.onEnded === undefined ? {} : { onEnded: options.onEnded }),
  });
}
