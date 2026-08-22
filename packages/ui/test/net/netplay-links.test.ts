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
import { linkBlock, preferredAddress, seatLink } from '../../tools/netplay-links';
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
    expect(text).toContain('http://192.168.1.42:5273/#/play?table=3f2a6c1e-8b4d-4c7a-9e10-5d6b2f8a1c33');
    expect(text).toContain('http://192.168.1.42:5273/#/play?table=9c1b7d55-2e60-4a83-8f47-11de3a904bb2');
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
    expect(text).toContain('http://localhost:5273/#/play?table=3f2a6c1e-8b4d-4c7a-9e10-5d6b2f8a1c33');
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
    expect(seatLink('192.168.1.42', 5273, 'abc')).toBe('http://192.168.1.42:5273/#/play?table=abc');
  });
});
