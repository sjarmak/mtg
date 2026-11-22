/**
 * The block `npm run netplay` prints: one link per seat, one address per network.
 *
 * Kept out of `netplay.ts` for the reason `resolve-set.ts` is kept out of
 * `play.ts` — that file is the part that touches the process, and what it says
 * to two people about to play is worth being able to test.
 *
 * Two decisions live here. **Every candidate is printed**, because this machine
 * carries a tailnet interface beside the LAN one and nothing in a launcher can
 * know which network the other device is on; the labels are in `lan-address.ts`
 * and the reader makes the choice. And **the second seat's link is drawn as a
 * QR code**, because both links print to the host's screen and the second one
 * has to reach the second device somehow. The QR carries the LAN address when
 * there is one, which is the address that link is most likely to be opened
 * against; the others stay printed as text beside it.
 */
import type { InviteSeat, TableInvite } from '@mtg/netplay';
import { routeHash } from '../src/app/router';
import type { SubOf } from '../src/app/router';
import { addressCandidates, labelFor } from './lan-address';
import type { AddressCandidate, InterfaceInfo } from './lan-address';
import { encodeQr, renderQr } from '../src/net/qr';

/** Everything the printed block is made of. */
export interface LinkBlock {
  readonly names: readonly string[];
  readonly tokens: readonly string[];
  readonly port: number;
  readonly interfaces: Readonly<Record<string, readonly InterfaceInfo[] | undefined>>;
  /**
   * Which hash parameter the link carries, which is what kind of game it is.
   *
   * `table` opens a seat at a game whose decks are already built; `room` opens
   * the build screen for a game the two people cut themselves. The page reads
   * the parameter rather than probing both routes, so the difference has to be
   * in the link the other player is handed and cannot be discovered afterwards.
   */
  readonly param?: SeatParam | undefined;
  /**
   * The Play section the link opens the seat on, when it is not the one the
   * param implies. A Forge table over the LAN opens on the section that already
   * holds its deck builder -- a printed format's sealed or commander page, the
   * Legacy Cube's draft -- and those pages read which format from a parameter
   * the link has to carry.
   */
  readonly page?: SeatLinkPage | undefined;
}

/** The hash parameter a seat link addresses its game through. */
export type SeatParam = 'table' | 'room';

/**
 * The Play section a seat link opens, and the parameters that section reads
 * beside the seat's own token.
 *
 * A section of Play rather than a free path: every seat this launcher mints is
 * a seat at a game, and Play is where games are (`../src/app/router.ts`). The
 * type says so, so a link cannot be written to a section that does not exist.
 */
export interface SeatLinkPage {
  readonly sub: SubOf<'play'>;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * The Play section each param's link opens when the caller names none, per
 * `../src/app/router.ts`'s `tokenSub`: a `table` token seats a game whose decks
 * are already built, which is the Constructed section, and a `room` token opens
 * the build screen, which is the Sealed section whether or not the room drafted
 * first (`table-dealer.ts`'s `roomDealer` writes a drafting room's invite with
 * the same `room=` param as a sealed one).
 */
const PARAM_SUB: Readonly<Record<SeatParam, SubOf<'play'>>> = {
  table: 'constructed',
  room: 'sealed',
};

/** The URL a seat opens, on a given address. */
export function seatLink(
  address: string,
  port: number,
  token: string,
  param: SeatParam = 'table',
  page?: SeatLinkPage,
): string {
  const hash = routeHash({
    mode: 'play',
    sub: page?.sub ?? PARAM_SUB[param],
    params: { ...page?.params, [param]: token },
  });
  return `http://${address}:${String(port)}/${hash}`;
}

/**
 * The address the QR code should carry.
 *
 * The tailnet address first, then a LAN one, then anything else, then nothing at
 * all on a machine with no external interface, which is a real state (an
 * unplugged laptop) and prints as an explanation rather than a blank space.
 *
 * This used to prefer the LAN address, on the reasoning that it is the one a
 * link is most likely to be opened against. That was wrong for the device the
 * code exists to serve. A QR code is scanned by a phone or a tablet rather than
 * typed on a second computer, those devices are the ones carried between
 * networks, and the tailnet address reaches this machine from a guest network,
 * a hotspot or the far end of a tunnel, while a `192.168.x.x` address is a
 * promise that only holds while both devices sit on the same router. The
 * tailnet address also works perfectly well when they do. So it is not a
 * tradeoff between two addresses that each win somewhere: one of them is a
 * superset of the other, and the printed list still carries both for the reader
 * who wants to choose.
 */
export function preferredAddress(candidates: readonly AddressCandidate[]): AddressCandidate | undefined {
  return (
    candidates.find((candidate) => candidate.kind === 'tailnet') ??
    candidates.find((candidate) => candidate.kind === 'lan') ??
    candidates[0]
  );
}

const NO_ADDRESS = [
  'This machine reports no non-internal IPv4 address, so there is no address to',
  'hand the other player. Both seats can still be opened here, on localhost:',
].join('\n');

export function linkBlock(block: LinkBlock): string {
  const candidates = addressCandidates(block.interfaces);
  const lines: string[] = [];

  if (candidates.length === 0) {
    lines.push(NO_ADDRESS, '');
    for (const [index, name] of block.names.entries()) {
      lines.push(`  ${name}  ${seatLink('localhost', block.port, block.tokens[index] ?? '', block.param)}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('One link per seat, on each address this machine answers on:', '');
  for (const candidate of candidates) {
    lines.push(`  ${candidate.address}  (${labelFor(candidate.kind)}, ${candidate.iface})`);
    for (const [index, name] of block.names.entries()) {
      lines.push(
        `    ${name}  ${seatLink(candidate.address, block.port, block.tokens[index] ?? '', block.param)}`,
      );
    }
    lines.push('');
  }

  if (candidates.length > 1) {
    lines.push(
      'More than one address is printed because nothing here can tell which network',
      'the other device is on. The tailnet one reaches this machine from anywhere the',
      'other device can get online; the LAN one only holds while both sit on the same',
      'router.',
      '',
    );
  }

  const preferred = preferredAddress(candidates);
  if (preferred !== undefined) {
    const link = seatLink(preferred.address, block.port, block.tokens[1] ?? '', block.param);
    const matrix = encodeQr(link);
    lines.push(
      `${block.names[1]} can scan this instead of typing it (${preferred.address}, ${labelFor(preferred.kind)}):`,
      '',
    );
    if (matrix === undefined) {
      // Refused rather than drawn wrong: the link is above, in full.
      lines.push('  (the link is too long for the code sizes this launcher draws)', '');
    } else {
      lines.push(...renderQr(matrix), '');
    }
  }

  return lines.join('\n');
}

/**
 * The same links, for the page rather than for the terminal.
 *
 * `linkBlock` above is what a person reads off stdout; this is what the host's
 * browser is handed so it can draw a copy button and a QR code beside the board
 * (`@mtg/netplay`'s invite route, `../src/routes/play/LanInvite.ts`). One
 * builder for both, because two would be two chances for the printed link and
 * the drawn one to name different ports.
 *
 * Seat 0 is the host, which is a convention rather than a discovery: this
 * launcher prints seat 0's link first and it is the seat the person who ran it
 * opens. Nothing in `@mtg/netplay` decides it — the invite states it, and the
 * server enforces only what the invite states.
 *
 * A machine with no external address still gets an invite, on `localhost`. That
 * is useless to a second machine and useful to a second browser window on this
 * one, which is exactly the state an unplugged laptop is in, and it is better
 * than a panel that says nothing.
 */
/**
 * The candidates, best first.
 *
 * `preferredAddress` above already argues which one that is, and the page draws
 * `links[0]` rather than repeating the argument in a second language: the panel
 * shows one link and one QR code with the rest folded under them, and which one
 * is on top is a fact about networks, which is what this file knows about. The
 * order is total rather than a pick, because the page also lists the others and
 * a list whose first entry was moved to the top twice would show it twice.
 */
function orderedAddresses(
  interfaces: Readonly<Record<string, readonly InterfaceInfo[] | undefined>>,
): readonly AddressCandidate[] {
  const candidates = addressCandidates(interfaces);
  const preferred = preferredAddress(candidates);
  if (preferred === undefined) return candidates;
  return [preferred, ...candidates.filter((candidate) => candidate !== preferred)];
}

export const HOST_SEAT = 0;

export function tableInvite(block: LinkBlock): TableInvite {
  const candidates = orderedAddresses(block.interfaces);
  const addresses: readonly AddressCandidate[] =
    candidates.length === 0 ? [{ address: 'localhost', iface: 'lo', kind: 'other' }] : candidates;
  const guests: InviteSeat[] = [];
  for (const [index, name] of block.names.entries()) {
    if (index === HOST_SEAT) continue;
    guests.push({
      name,
      links: addresses.map((candidate) => ({
        label: `${labelFor(candidate.kind)} (${candidate.address})`,
        url: seatLink(candidate.address, block.port, block.tokens[index] ?? '', block.param, block.page),
      })),
      // Filled in by the server, which is the only thing that sees a request.
      joined: false,
    });
  }
  return { hostSeat: HOST_SEAT, guests };
}
