/**
 * What two people actually read when the launcher starts.
 *
 * The bead's acceptance is behavioral and no test here can put a second device
 * on the sofa. What this file checks is the part that was wrong: that the block
 * contains a real address rather than a placeholder, that it contains every
 * address rather than a guess, and that a machine with no network says so
 * instead of printing a link to nowhere.
 */
import { describe, expect, it } from 'vitest';
import type { InterfaceInfo } from '../../tools/lan-address';
import { HOST_SEAT, linkBlock, preferredAddress, seatLink, tableInvite } from '../../tools/netplay-links';
import { addressCandidates } from '../../tools/lan-address';

function info(address: string, internal = false): InterfaceInfo {
  return { address, family: 'IPv4', internal };
}

const NAMES: readonly [string, string] = ['Seat one', 'Seat two'];
const TOKENS: readonly [string, string] = [
  '3f2a6c1e-8b4d-4c7a-9e10-5d6b2f8a1c33',
  '9c1b7d55-2e60-4a83-8f47-11de3a904bb2',
];

function block(interfaces: Record<string, readonly InterfaceInfo[] | undefined>): string {
  return linkBlock({ names: NAMES, tokens: TOKENS, port: 5273, interfaces });
}

describe('the printed links', () => {
  it('never prints the placeholder it replaced', () => {
    expect(block({ wlan0: [info('192.168.1.42')] })).not.toContain('<this machine>');
  });

  it('prints both seats on the LAN address', () => {
    const text = block({ wlan0: [info('192.168.1.42')] });
    expect(text).toContain(
      'http://192.168.1.42:5273/#/play/constructed?table=3f2a6c1e-8b4d-4c7a-9e10-5d6b2f8a1c33',
    );
    expect(text).toContain(
      'http://192.168.1.42:5273/#/play/constructed?table=9c1b7d55-2e60-4a83-8f47-11de3a904bb2',
    );
  });

  it('prints the tailnet address too, and says which is which', () => {
    const text = block({
      wlan0: [info('192.168.1.42')],
      tailscale0: [info('100.101.102.103')],
    });
    expect(text).toContain('192.168.1.42');
    expect(text).toContain('100.101.102.103');
    expect(text).toContain('LAN');
    expect(text).toContain('Tailscale');
    // The LAN block comes first, so the address most people want is read first.
    expect(text.indexOf('192.168.1.42')).toBeLessThan(text.indexOf('100.101.102.103'));
  });

  it('says nothing about choosing when there is only one address', () => {
    expect(block({ wlan0: [info('192.168.1.42')] })).not.toContain('More than one address');
  });

  it('draws a QR code for the second seat', () => {
    const text = block({ wlan0: [info('192.168.1.42')] });
    expect(text).toContain('Seat two can scan this');
    // The half-block character each rendered module row is drawn with.
    expect(text).toContain('▀');
  });

  it('explains itself on a machine with no external address', () => {
    const text = block({ lo: [info('127.0.0.1', true)] });
    expect(text).toContain('no non-internal IPv4 address');
    expect(text).toContain(
      'http://localhost:5273/#/play/constructed?table=3f2a6c1e-8b4d-4c7a-9e10-5d6b2f8a1c33',
    );
    expect(text).not.toContain('▀');
  });

  it('puts the tailnet address in the QR, because the device scanning it gets carried between networks', () => {
    const candidates = addressCandidates({
      tailscale0: [info('100.101.102.103')],
      wlan0: [info('10.0.0.7')],
    });
    expect(preferredAddress(candidates)?.address).toBe('100.101.102.103');
  });

  it('falls back to a LAN address when there is no tailnet one', () => {
    const candidates = addressCandidates({ wlan0: [info('10.0.0.7')] });
    expect(preferredAddress(candidates)?.address).toBe('10.0.0.7');
  });

  it('falls back to whatever address exists when none of them is a LAN one', () => {
    const candidates = addressCandidates({ tailscale0: [info('100.101.102.103')] });
    expect(preferredAddress(candidates)?.address).toBe('100.101.102.103');
    expect(preferredAddress([])).toBeUndefined();
  });

  it('builds a link the play route can read', () => {
    expect(seatLink('192.168.1.42', 5273, 'abc')).toBe(
      'http://192.168.1.42:5273/#/play/constructed?table=abc',
    );
  });

  it('opens the Sealed section for a room token, drafted or not', () => {
    // `router.ts`'s `tokenSub` reads `room=` as Sealed, and `table-dealer.ts`
    // writes a drafting room's invite with the same `room=` param as a sealed
    // one, so this is the address for both.
    expect(seatLink('192.168.1.42', 5273, 'abc', 'room')).toBe(
      'http://192.168.1.42:5273/#/play/sealed?room=abc',
    );
  });

  it('opens a seat on the section its format lives on, with that section named first', () => {
    expect(
      seatLink('192.168.1.42', 5273, 'obs-1', 'table', {
        sub: 'draft',
        params: { source: 'legacy-cube-2021-08' },
      }),
    ).toBe('http://192.168.1.42:5273/#/play/draft?source=legacy-cube-2021-08&table=obs-1');
    expect(
      seatLink('192.168.1.42', 5273, 'obs-1', 'table', {
        sub: 'sealed',
        params: { source: 'printed:akh-hou' },
      }),
    ).toBe('http://192.168.1.42:5273/#/play/sealed?source=printed%3Aakh-hou&table=obs-1');
  });
});

/**
 * The same links, for the page.
 *
 * `linkBlock` above is read off a terminal; this is what the host's browser is
 * handed. One builder for both, so the two cannot name different ports — and one
 * thing this file is specifically for is that the *host's* token is not in it.
 */
function invite(interfaces: Record<string, readonly InterfaceInfo[] | undefined>) {
  return tableInvite({ names: NAMES, tokens: TOKENS, port: 5273, interfaces });
}

describe('the invite the page is handed', () => {
  it('addresses the page the block names, on every link', () => {
    const built = tableInvite({
      names: NAMES,
      tokens: TOKENS,
      port: 5273,
      interfaces: { wlan0: [info('192.168.1.42')] },
      page: { sub: 'draft', params: { source: 'legacy-cube-2021-08' } },
    });
    expect(built.guests[0]?.links.map((link) => link.url)).toEqual([
      `http://192.168.1.42:5273/#/play/draft?source=legacy-cube-2021-08&table=${TOKENS[1]}`,
    ]);
  });

  it('carries the guest seat and not the host', () => {
    const built = invite({ wlan0: [info('192.168.1.42')] });
    expect(built.hostSeat).toBe(HOST_SEAT);
    expect(built.guests.map((guest) => guest.name)).toEqual(['Seat two']);
    // The host's token is the one thing a page drawing this must never be able
    // to show, and the check is on the whole document rather than on a field.
    expect(JSON.stringify(built)).not.toContain(TOKENS[0]);
    expect(JSON.stringify(built)).toContain(TOKENS[1]);
  });

  it('puts the address most likely to reach another device first', () => {
    const built = invite({ wlan0: [info('10.0.0.7')], tailscale0: [info('100.101.102.103')] });
    const links = built.guests[0]?.links ?? [];
    // The page draws `links[0]` and folds the rest, so this order is the whole
    // of which link a host is shown.
    expect(links[0]?.url).toContain('100.101.102.103');
    expect(links.map((link) => link.url).join(' ')).toContain('10.0.0.7');
    expect(links).toHaveLength(2);
  });

  it('invites over localhost on a machine with no external address', () => {
    // Useless to a second machine, useful to a second window on this one, and
    // better than a panel with nothing in it.
    const links = invite({ lo: [info('127.0.0.1', true)] }).guests[0]?.links ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe(`http://localhost:5273/#/play/constructed?table=${TOKENS[1]}`);
  });

  it('says every seat has yet to join, because nothing has asked the server anything', () => {
    expect(invite({ wlan0: [info('192.168.1.42')] }).guests.every((guest) => !guest.joined)).toBe(true);
  });
});
