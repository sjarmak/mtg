// @vitest-environment jsdom
/**
 * The button that seats a Forge table over the network.
 *
 * Three answers from the lab are three sentences beside one button, and only
 * one of them enables it: a lab whose Forge serves this format, a lab started
 * without Forge, and nothing listening at all. Pressing the enabled button is
 * the whole journey: the lab opens a table and this page is handed the host's
 * seat, with no command typed anywhere. And the beat of silence before the
 * probe answers is kept, for the reason `lan-section.test.ts` gives.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ObservedBackend } from '@mtg/engine';
import { createObservedDealer } from '@mtg/netplay';
import type { ObservedDealer } from '@mtg/netplay';
import { readObservedFormats } from '../../src/net/invite';
import { CLIENT_PROTOCOL } from '../../src/net/snapshot';
import {
  LAN_FORGE_ASKING,
  LAN_FORGE_LABEL,
  LAN_FORGE_NO_LAB,
  LAN_FORGE_START_LABEL,
  LanForgeStart,
  lanForgeSection,
} from '../../src/routes/play/LanForgeStart';
import type { ObservedTableOpened } from '../../src/routes/play/LanForgeStart';
import { PLAY_LAN_COMMAND } from '../../src/routes/play/LanSection';
import { WIRE_BASE, observedWire, stillClock } from './observed-wire';

const FORMAT = 'akh-hou';

/** A backend that is never opened here: the section only seats the table. */
const backend: ObservedBackend = {
  id: 'forge-2.0.14',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () => Promise.reject(new Error('not opened here')),
};

let restore: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

function stubFetch(answer: typeof globalThis.fetch): void {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: answer });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function dealerOf(): ObservedDealer {
  return createObservedDealer({ backend, formats: [FORMAT], clock: stillClock() });
}

function section(format: string, onStarted: (opened: ObservedTableOpened) => void): ReturnType<typeof h> {
  return h(LanForgeStart, { base: WIRE_BASE, format, content: { kind: 'printed', format }, onStarted });
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function disabled(node: unknown): boolean {
  return (node as { getAttribute(name: string): string | null }).getAttribute('disabled') !== null;
}

describe('the health answer', () => {
  it('reads the observed arm only when it speaks this protocol and lists strings', () => {
    expect(readObservedFormats({ observed: { protocol: 1, formats: ['m11', FORMAT] } })).toEqual([
      'm11',
      FORMAT,
    ]);
    expect(readObservedFormats({ observed: { protocol: 1, formats: [] } })).toEqual([]);
    expect(readObservedFormats({ observed: { protocol: 2, formats: [FORMAT] } })).toBeNull();
    expect(readObservedFormats({ observed: { protocol: 1, formats: [FORMAT, 7] } })).toBeNull();
    expect(readObservedFormats({ ok: true, protocol: CLIENT_PROTOCOL })).toBeNull();
    expect(readObservedFormats(null)).toBeNull();
  });

  it('is one of four sentences, or ready', () => {
    expect(lanForgeSection('none', [FORMAT], FORMAT)).toEqual({
      status: 'unavailable',
      reason: LAN_FORGE_NO_LAB,
    });
    expect(lanForgeSection('seated', null, FORMAT)).toMatchObject({ status: 'unavailable' });
    expect(lanForgeSection('dealing', [FORMAT], FORMAT)).toEqual({ status: 'ready' });
    expect(LAN_FORGE_NO_LAB).toContain(PLAY_LAN_COMMAND);
  });

  // The cell the landing frame owns is drawn before the probe answers, and a
  // cell that went live on an assumption would go dark a frame later; this
  // section draws nothing at all then, so only the cell reads this answer.
  it('is never ready while the probe is still out', () => {
    expect(lanForgeSection('asking', [FORMAT], FORMAT)).toEqual({
      status: 'unavailable',
      reason: LAN_FORGE_ASKING,
    });
  });
});

describe('LanForgeStart', () => {
  it('seats the host at a table the lab opened, on one press', async () => {
    const dealer = dealerOf();
    stubFetch(observedWire(dealer));
    const onStarted = vi.fn<(opened: ObservedTableOpened) => void>();
    render(section(FORMAT, onStarted));

    const start = await screen.findByRole('button', { name: LAN_FORGE_START_LABEL });
    expect(disabled(start)).toBe(false);
    expect(screen.getByRole('region', { name: LAN_FORGE_LABEL })).not.toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
    const opened = onStarted.mock.calls[0]?.[0];
    expect(opened?.host.startsWith('obs-')).toBe(true);
    expect(dealer.find(opened?.host ?? '')?.seat).toBe(0);
    expect(dealer.find(opened?.guest ?? '')?.seat).toBe(1);
    expect(dealer.live).toBe(1);
    await dealer.close();
  });

  it('keeps the button disabled and says which formats Forge serves when this one is not among them', async () => {
    const dealer = dealerOf();
    stubFetch(observedWire(dealer));
    render(section('m11', vi.fn()));

    const start = await screen.findByRole('button', { name: LAN_FORGE_START_LABEL });
    expect(disabled(start)).toBe(true);
    expect(textOf(screen.getByRole('status'))).toBe(
      `Forge on this lab does not serve m11 over the network; it serves ${FORMAT}.`,
    );
    await dealer.close();
  });

  it('says the lab was started without Forge when health advertises no observed arm', async () => {
    stubFetch(() => json({ ok: true, protocol: CLIENT_PROTOCOL, deals: true }));
    render(section(FORMAT, vi.fn()));

    const start = await screen.findByRole('button', { name: LAN_FORGE_START_LABEL });
    expect(disabled(start)).toBe(true);
    expect(textOf(screen.getByRole('status'))).toContain('started without a Forge backend');
  });

  it('names the command that starts a lab when nothing is listening', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')));
    render(section(FORMAT, vi.fn()));

    const start = await screen.findByRole('button', { name: LAN_FORGE_START_LABEL });
    expect(disabled(start)).toBe(true);
    const note = textOf(screen.getByRole('status'));
    expect(note).toContain('Nothing is listening for tables at this address.');
    expect(note).toContain(PLAY_LAN_COMMAND);
  });

  it('draws nothing until the probe answers', () => {
    stubFetch(() => new Promise(() => undefined));
    const rendered = render(section(FORMAT, vi.fn()));
    expect(textOf(rendered.container)).toBe('');
    expect(screen.queryByRole('button', { name: LAN_FORGE_START_LABEL })).toBeNull();
  });
});
