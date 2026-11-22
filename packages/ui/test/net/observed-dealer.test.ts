/**
 * What the launcher adds to a Forge table over the LAN: the links.
 *
 * `@mtg/netplay` tests the table itself. What is pinned here is the part only
 * the launcher knows, that a guest's link opens the Play section holding that
 * format's deck builder, names the format the way that section reads it, and
 * carries the guest's token rather than the host's.
 */
import { describe, expect, it } from 'vitest';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import { OBSERVED_SEAT_NAMES } from '@mtg/netplay';
import type { ObservedDealer } from '@mtg/netplay';
import type { InterfaceInfo } from '../../tools/lan-address';
import { observedDealer, observedSeatPage } from '../../tools/observed-dealer';
import type { SeatFormat } from '../../tools/observed-dealer';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';

const INTERFACES: Readonly<Record<string, readonly InterfaceInfo[] | undefined>> = {
  eth0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
};

const PRINTED: readonly SeatFormat[] = [
  { id: 'akh-hou', kind: 'limited' },
  { id: 'scd', kind: 'constructed' },
  { id: 'isd' },
];

const backend: ObservedBackend = {
  id: 'forge-2.0.14',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () => Promise.reject(new Error('not opened here')),
};

const GUEST_DECK: DeckRef = {
  name: 'Token Triumph',
  cards: [{ name: 'Emmara, Soul of the Accord', count: 1 }],
};

function counting(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `t${String(next)}`;
  };
}

function dealer(formats: readonly string[]): ObservedDealer {
  return observedDealer({
    backend,
    formats,
    printed: PRINTED,
    webPort: 5173,
    interfaces: () => INTERFACES,
    mint: counting(),
  });
}

async function open(dealer: ObservedDealer, format: string) {
  const outcome = await dealer.open({
    protocol: 1,
    format,
    content: { kind: 'printed', format },
    seed: null,
    maximumTurns: null,
  });
  if (!outcome.ok) throw new Error(outcome.refused);
  return outcome;
}

describe('the section a seat opens', () => {
  it('opens each format where its own builder is, which is where Play lists it', () => {
    expect(observedSeatPage('akh-hou', PRINTED)).toEqual({
      sub: 'sealed',
      params: { source: 'printed:akh-hou' },
    });
    expect(observedSeatPage('scd', PRINTED)).toEqual({
      sub: 'commander',
      params: { source: 'printed:scd' },
    });
    expect(observedSeatPage(LEGACY_CUBE_FORMAT, PRINTED)).toEqual({
      sub: 'draft',
      params: { source: LEGACY_CUBE_FORMAT },
    });
  });

  it('reads a row staged before the kind existed as the limited format it is', () => {
    expect(observedSeatPage('isd', PRINTED).sub).toBe('sealed');
  });

  it('refuses at launcher start to advertise a format it has no staged row for', () => {
    expect(() => dealer(['akh-hou', 'm11'])).toThrow(/m11/u);
  });
});

describe('the invite a LAN Forge table hands the host', () => {
  it('links the guest seat to the format section, and not the host token', async () => {
    const opened = await open(dealer(['akh-hou']), 'akh-hou');
    const invite = opened.table.invite;
    expect(invite?.hostSeat).toBe(0);
    expect(invite?.guests.map((guest) => guest.name)).toEqual([OBSERVED_SEAT_NAMES[1]]);
    expect(invite?.guests[0]?.links.map((link) => link.url)).toEqual([
      `http://192.168.1.20:5173/#/play/sealed?source=printed%3Aakh-hou&table=${opened.tokens[1]}`,
    ]);
    expect(JSON.stringify(invite)).not.toContain(opened.tokens[0]);
    expect(opened.tokens[0]).toMatch(/^obs-/u);
  });

  it('names a pre-seated guest deck in the invite', async () => {
    const subject = dealer(['scd']);
    const opened = await subject.open({
      protocol: 1,
      format: 'scd',
      content: { kind: 'printed', format: 'scd' },
      seed: null,
      maximumTurns: null,
      deck: GUEST_DECK,
    });
    if (!opened.ok) throw new Error(opened.refused);
    expect(opened.table.invite?.guests[0]?.name).toBe('Token Triumph');
  });

  it('opens a cube seat on the draft section under the source parameter', async () => {
    const opened = await open(dealer([LEGACY_CUBE_FORMAT]), LEGACY_CUBE_FORMAT);
    expect(opened.table.invite?.guests[0]?.links[0]?.url).toBe(
      `http://192.168.1.20:5173/#/play/draft?source=${LEGACY_CUBE_FORMAT}&table=${opened.tokens[1]}`,
    );
  });

  it('advertises exactly the formats it was given and refuses the rest', async () => {
    const subject = dealer(['akh-hou']);
    expect(subject.formats).toEqual(['akh-hou']);
    const refused = await subject.open({
      protocol: 1,
      format: 'm11',
      content: { kind: 'printed', format: 'm11' },
      seed: null,
      maximumTurns: null,
    });
    expect(refused).toMatchObject({ ok: false, code: 'unknown-format' });
  });
});
