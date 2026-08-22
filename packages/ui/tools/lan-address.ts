/**
 * Which address the other player types, and why the launcher prints all of them.
 *
 * `npm run netplay` used to print the literal string `http://<this machine>`,
 * which is true and useless: the host had to go and find the address themselves,
 * and the whole distance between "two people can play over the LAN if they know
 * the trick" and "two people can play over the LAN" was that string.
 *
 * Resolving it is `os.networkInterfaces()`. Choosing between the results is the
 * part worth writing down. This machine carries a Tailscale interface beside the
 * LAN one, so a launcher that picked the first non-internal IPv4 would hand out
 * a tailnet address about half the time, and a tailnet address is right only if
 * the other device is on the tailnet. Nothing here can know that. So every
 * candidate is printed, each with the one word that tells the reader which is
 * which, and the person who knows which network the iPad is on makes the choice
 * a heuristic would have made wrong.
 *
 * The labels are ranges wherever a range can tell them apart. Tailscale hands
 * out CGNAT space (`100.64.0.0/10`, RFC 6598), RFC 1918 is the LAN, and
 * `169.254.0.0/16` is what an interface has when it failed to get a lease.
 *
 * **One kind is named by its interface instead, and it has to be.** A container
 * bridge lives inside RFC 1918 — Docker's default is `172.17.0.0/16` — so no
 * range distinguishes it from the network the iPad is on, and on this machine it
 * sorted ahead of the real LAN address and was offered as the answer. Nothing
 * outside that bridge can reach it. So the well-known bridge names are demoted
 * and labeled, and an unrecognized bridge is only mislabeled rather than hidden:
 * it still prints, under the range it belongs to, which is the behavior a name
 * list has to fall back to when the name list is incomplete.
 */

/** What a printed address is, in one word the reader does not have to decode. */
export type AddressKind = 'lan' | 'tailnet' | 'virtual' | 'link-local' | 'other';

/**
 * Interface-name prefixes that mean a bridge to something on this machine.
 *
 * Docker, Podman's and libvirt's bridges, the veth ends of containers, VMware
 * and VirtualBox host adapters, and the tun/tap devices a VPN builds.
 */
const VIRTUAL_PREFIXES: readonly string[] = [
  'docker',
  'br-',
  'virbr',
  'veth',
  'vmnet',
  'vboxnet',
  'cni',
  'flannel',
  'podman',
];

/** True when an interface name is one of the bridges nothing else can reach. */
export function isVirtualInterface(iface: string): boolean {
  const name = iface.toLowerCase();
  return VIRTUAL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** One address this machine answers on, with the network it belongs to. */
export interface AddressCandidate {
  /** The dotted-quad itself. */
  readonly address: string;
  /** The interface the operating system reported it under. */
  readonly iface: string;
  /** Which network it reaches. */
  readonly kind: AddressKind;
}

/**
 * The subset of `os.NetworkInterfaceInfo` this file reads.
 *
 * Structural rather than imported so the classifier can be tested against a
 * table of addresses instead of against whatever this machine happens to have
 * plugged in, which is not a fixture anybody can pin.
 */
export interface InterfaceInfo {
  readonly address: string;
  readonly family: string | number;
  readonly internal: boolean;
}

/** Print order: the answer that is usually right, then the ones that sometimes are. */
const KIND_ORDER: Record<AddressKind, number> = {
  lan: 0,
  other: 1,
  tailnet: 2,
  virtual: 3,
  'link-local': 4,
};

/** Human words for the kinds, said the way a person would say them out loud. */
const KIND_LABEL: Record<AddressKind, string> = {
  lan: 'LAN',
  tailnet: 'tailnet (Tailscale)',
  virtual: 'virtual bridge, reachable from this machine only',
  'link-local': 'link-local (no DHCP lease)',
  other: 'unrecognized range',
};

function octets(address: string): readonly number[] | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    values.push(value);
  }
  return values;
}

/**
 * Which network an IPv4 address belongs to.
 *
 * An address this cannot parse is `other` rather than a thrown error: the
 * launcher's job here is to print what it found, and a candidate it cannot
 * classify is still a candidate the host may recognize.
 */
export function classifyAddress(address: string): AddressKind {
  const parts = octets(address);
  if (parts === undefined) return 'other';
  const [a, b] = parts as readonly [number, number, number, number];
  if (a === 10) return 'lan';
  if (a === 172 && b >= 16 && b <= 31) return 'lan';
  if (a === 192 && b === 168) return 'lan';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'tailnet';
  return 'other';
}

/** The word the launcher prints beside an address. */
export function labelFor(kind: AddressKind): string {
  return KIND_LABEL[kind];
}

/**
 * Every non-internal IPv4 this machine answers on, most-likely first.
 *
 * Node reports `family` as the string `'IPv4'` on current releases and as the
 * number `4` on older ones; both are accepted because a launcher that silently
 * found nothing would be indistinguishable from a machine with no network.
 */
export function addressCandidates(
  interfaces: Readonly<Record<string, readonly InterfaceInfo[] | undefined>>,
): readonly AddressCandidate[] {
  const found: AddressCandidate[] = [];
  for (const [iface, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal) continue;
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      const kind = isVirtualInterface(iface) ? 'virtual' : classifyAddress(info.address);
      found.push({ address: info.address, iface, kind });
    }
  }
  return [...found].sort((left, right) => {
    const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (byKind !== 0) return byKind;
    return left.address.localeCompare(right.address);
  });
}
