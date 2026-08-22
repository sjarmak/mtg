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
import { addressCandidates, labelFor } from './lan-address';
import type { AddressCandidate, InterfaceInfo } from './lan-address';
import { encodeQr, renderQr } from './qr';

/** Everything the printed block is made of. */
export interface LinkBlock {
  readonly names: readonly [string, string];
  readonly tokens: readonly [string, string];
  readonly port: number;
  readonly interfaces: Readonly<Record<string, readonly InterfaceInfo[] | undefined>>;
}

/** The URL a seat opens, on a given address. */
export function seatLink(address: string, port: number, token: string): string {
  return `http://${address}:${String(port)}/#/play?table=${token}`;
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
      lines.push(`  ${name}  ${seatLink('localhost', block.port, block.tokens[index] ?? '')}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('One link per seat, on each address this machine answers on:', '');
  for (const candidate of candidates) {
    lines.push(`  ${candidate.address}  (${labelFor(candidate.kind)}, ${candidate.iface})`);
    for (const [index, name] of block.names.entries()) {
      lines.push(`    ${name}  ${seatLink(candidate.address, block.port, block.tokens[index] ?? '')}`);
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
    const link = seatLink(preferred.address, block.port, block.tokens[1] ?? '');
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
