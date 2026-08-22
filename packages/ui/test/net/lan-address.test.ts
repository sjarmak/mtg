/**
 * Which address `npm run netplay` prints, and that it prints all of them.
 *
 * The classifier is tested against a table rather than against this machine's
 * own interfaces, because whatever is plugged in today is not a fixture and a
 * test that asserts on it fails on a laptop with the lid shut.
 */
import { describe, expect, it } from 'vitest';
import { addressCandidates, classifyAddress, isVirtualInterface, labelFor } from '../../tools/lan-address';
import type { InterfaceInfo } from '../../tools/lan-address';

function info(address: string, internal = false): InterfaceInfo {
  return { address, family: 'IPv4', internal };
}

describe('classifying an address', () => {
  it('reads the three RFC 1918 ranges as the LAN', () => {
    expect(classifyAddress('192.168.1.42')).toBe('lan');
    expect(classifyAddress('10.0.0.7')).toBe('lan');
    expect(classifyAddress('172.16.4.1')).toBe('lan');
    expect(classifyAddress('172.31.255.254')).toBe('lan');
  });

  it('does not mistake the addresses either side of 172.16.0.0/12 for the LAN', () => {
    expect(classifyAddress('172.15.0.1')).toBe('other');
    expect(classifyAddress('172.32.0.1')).toBe('other');
  });

  it('reads the carrier-grade NAT range as the tailnet', () => {
    expect(classifyAddress('100.64.0.1')).toBe('tailnet');
    expect(classifyAddress('100.101.102.103')).toBe('tailnet');
    expect(classifyAddress('100.127.255.255')).toBe('tailnet');
    // 100.0.0.0/10 is ordinary public space; only 64..127 is the reserved block.
    expect(classifyAddress('100.63.0.1')).toBe('other');
    expect(classifyAddress('100.128.0.1')).toBe('other');
  });

  it('names an address with no DHCP lease for what it is', () => {
    expect(classifyAddress('169.254.11.9')).toBe('link-local');
  });

  it('classifies something it cannot parse rather than throwing', () => {
    expect(classifyAddress('not an address')).toBe('other');
    expect(classifyAddress('192.168.1')).toBe('other');
    expect(classifyAddress('999.1.1.1')).toBe('other');
  });

  it('has a word for every kind', () => {
    for (const kind of ['lan', 'tailnet', 'virtual', 'link-local', 'other'] as const) {
      expect(labelFor(kind).length).toBeGreaterThan(0);
    }
  });
});

describe('collecting the candidates', () => {
  it('prints every non-internal IPv4 rather than picking one', () => {
    const candidates = addressCandidates({
      lo: [info('127.0.0.1', true)],
      wlan0: [info('192.168.1.42')],
      tailscale0: [info('100.101.102.103')],
    });
    expect(candidates.map((candidate) => candidate.address)).toEqual(['192.168.1.42', '100.101.102.103']);
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['lan', 'tailnet']);
  });

  it('puts the LAN first, because that is the one that is usually meant', () => {
    const candidates = addressCandidates({
      tailscale0: [info('100.101.102.103')],
      enp3s0: [info('169.254.1.1')],
      eth0: [info('10.0.0.7')],
    });
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['lan', 'tailnet', 'link-local']);
  });

  it('drops loopback and IPv6, and keeps the interface name', () => {
    const candidates = addressCandidates({
      lo: [info('127.0.0.1', true)],
      eth0: [{ address: 'fe80::1', family: 'IPv6', internal: false }, info('10.0.0.7')],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.iface).toBe('eth0');
  });

  it('accepts the numeric family older Node releases report', () => {
    const candidates = addressCandidates({
      eth0: [{ address: '10.0.0.7', family: 4, internal: false }],
    });
    expect(candidates).toHaveLength(1);
  });

  it('demotes a container bridge below the network the other device is on', () => {
    // Docker's default bridge is inside RFC 1918, so only the name tells them
    // apart, and on this machine it sorted first and was offered as the answer.
    const candidates = addressCandidates({
      docker0: [info('172.17.0.1')],
      enp8s0: [info('192.168.1.67')],
    });
    expect(candidates.map((candidate) => candidate.address)).toEqual(['192.168.1.67', '172.17.0.1']);
    expect(candidates[1]?.kind).toBe('virtual');
  });

  it('knows the bridge names, and no ordinary one', () => {
    for (const name of ['docker0', 'br-1a2b3c', 'virbr0', 'veth0a1b', 'vboxnet0', 'podman0']) {
      expect(isVirtualInterface(name), name).toBe(true);
    }
    for (const name of ['eth0', 'enp8s0', 'wlan0', 'tailscale0', 'lo']) {
      expect(isVirtualInterface(name), name).toBe(false);
    }
  });

  it('finds nothing on a machine with nothing, without failing', () => {
    expect(addressCandidates({ lo: [info('127.0.0.1', true)] })).toEqual([]);
    expect(addressCandidates({ eth0: undefined })).toEqual([]);
  });
});
