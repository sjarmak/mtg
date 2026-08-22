// @vitest-environment jsdom
/**
 * The Replay tab is the event viewer, and this is the wiring that says so.
 *
 * The viewer had been complete and tested for a while with nothing rendering
 * it: `dev/LabApp.ts` put `ReplayRoute` in the `replay` slot, which reads
 * `@mtg/sim`'s statistics log — per-turn aggregates, no action anywhere in the
 * file. A view that is exported and mounted nowhere is a view that goes quietly
 * wrong, so what is asserted here is the slot rather than the component.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { hashSource } from '../../src/app/router';
import { fixtureText } from './support/log-fixture';

// The same tolerance `lab.test.ts` sets and for the same reason: every fetch
// here is already resolved, and what this buys is a starved event loop.
configure({ asyncUtilTimeout: 4_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

/** Answers `events.jsonl` with `body` and 404s everything else. */
function stubEventLog(body: string, ok = true): void {
  vi.stubGlobal('fetch', (url: string) =>
    url === 'events.jsonl'
      ? Promise.resolve({ ok, status: ok ? 200 : 404, text: () => Promise.resolve(body) })
      : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
  );
}

function mountLab(eventLogUrl?: string): void {
  setHash('#/replay');
  render(
    h(LabApp, {
      replayUrl: 'missing.jsonl',
      cards: EXAMPLE_CARDS,
      ...(eventLogUrl === undefined ? {} : { eventLogUrl }),
    }),
  );
}

describe('the Replay tab', () => {
  it('draws the recorded board rather than a table of per-turn counts', async () => {
    stubEventLog(fixtureText());
    mountLab('events.jsonl');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    });
    // A playback speed and a seat's own battlefield: neither is expressible
    // over the statistics log, which holds no step and no object.
    expect(screen.getByRole('combobox', { name: 'Speed' })).toBeTruthy();
    expect(screen.getByLabelText("RW Aggro's battlefield")).toBeTruthy();
  });

  it('names the command that records a log when there is none', async () => {
    stubEventLog('', false);
    mountLab('events.jsonl');
    await waitFor(() => {
      expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    });
    expect(screen.queryByText('That event log could not be read')).toBeNull();
  });

  it('gives the line back when the log is there and unreadable', async () => {
    stubEventLog('{"record":"header","schema":"nope","source":"x","games":0}\n');
    mountLab('events.jsonl');
    await waitFor(() => {
      expect(screen.getByText('That event log could not be read')).toBeTruthy();
    });
    expect(screen.getByText(/line 1/)).toBeTruthy();
  });

  it('is absent rather than broken when the wiring names no log at all', async () => {
    stubEventLog('', false);
    mountLab();
    await waitFor(() => {
      expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    });
  });
});
