// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readPrintedLibrary } from '../../src/routes/printed/printed-library';
import { PrintedDeckLibrary } from '../../src/routes/printed/PrintedDeckLibrary';

const formatId = 'akh-hou';
const fingerprint = 'a'.repeat(64);
const key = 'mtg.printed.sealed:akh-hou:pool:one';
const session = {
  version: 1,
  mode: 'sealed',
  formatId,
  fingerprint,
  seed: 'pool:one',
  deck: {
    selectedPhysicalIds: ['copy-1', 'copy-2'],
    basics: { Plains: 18, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
  },
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('links saved pools to the existing editor with the selected printed source preserved', () => {
  localStorage.setItem(key, JSON.stringify(session));
  render(
    h(PrintedDeckLibrary, {
      formatId,
      fingerprint,
      title: 'Amonkhet / Hour of Devastation',
      route: { mode: 'customize', sub: 'decks', params: { source: 'printed:akh-hou:AKH', q: 'stale' } },
      playAvailability: {
        status: 'supported',
        reason: 'Verified full-card and match interaction admission is installed.',
      },
    }),
  );
  expect(
    (
      screen.getByRole('link', { name: 'Open sealed pool pool:one' }) as unknown as {
        getAttribute(name: string): string | null;
      }
    ).getAttribute('href'),
  ).toBe('#/play/sealed?seed=pool%3Aone&source=printed%3Aakh-hou%3AAKH');
  expect(screen.getByText('20 cards in deck')).toBeDefined();
  expect(screen.getByText(/Plays against Forge\./)).toBeDefined();
  expect(screen.queryByText(/Verified full-card and match interaction admission is installed/)).toBeNull();
});

it('offers creation from the empty library but never offers to open stale saved sessions', () => {
  const props = {
    formatId,
    fingerprint,
    title: 'AKH/HOU',
    route: { mode: 'customize' as const, sub: 'decks' as const, params: {} },
    playAvailability: { status: 'unavailable' as const, reason: 'Full Forge admission is incomplete.' },
  };
  const view = render(h(PrintedDeckLibrary, props));
  expect(screen.getByText('No saved sessions for this format.')).toBeDefined();
  expect(screen.getByRole('link', { name: 'Start a draft' })).toBeDefined();
  view.unmount();
  localStorage.setItem(key, JSON.stringify({ ...session, fingerprint: 'b'.repeat(64) }));
  render(h(PrintedDeckLibrary, props));
  expect(screen.queryByRole('link', { name: /Open sealed pool/ })).toBeNull();
  expect(screen.getByText(/Saved format fingerprint differs/)).toBeDefined();
});

it('refreshes after another tab saves a draft and exposes later storage failure', () => {
  render(
    h(PrintedDeckLibrary, {
      formatId,
      fingerprint,
      title: 'AKH/HOU',
      route: { mode: 'customize', sub: 'decks', params: {} },
      playAvailability: {
        status: 'experimental',
        reason: 'Experimental Forge play has not completed admission.',
      },
    }),
  );
  localStorage.setItem(
    'mtg.printed.draft:akh-hou:later',
    JSON.stringify({
      mode: 'draft',
      transcript: {
        version: 1,
        formatId,
        fingerprint,
        seed: 'later',
        humanSeatIds: ['seat-1'],
        picks: { 'seat-1': [] },
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved sessions' }));
  expect(screen.getByRole('link', { name: 'Open draft later' })).toBeDefined();
  expect(screen.getByText('0 recorded picks')).toBeDefined();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved sessions' }));
  expect((screen.getByRole('alert') as unknown as { textContent: string }).textContent).toMatch(
    /could not be read/,
  );
});

it('discovers existing physical sessions without writing a duplicate store', () => {
  localStorage.setItem(key, JSON.stringify(session));
  localStorage.setItem('mtg.deck.saved', 'unrelated');
  localStorage.setItem('mtg.printed.sealed:another:pool', 'unrelated');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const result = readPrintedLibrary(formatId, fingerprint);
  expect(result.error).toBeNull();
  expect(result.entries).toEqual([
    { key, mode: 'sealed', seed: 'pool:one', cards: 20, picks: null, issue: null },
  ]);
  expect(write).not.toHaveBeenCalled();
});

it('keeps corrupt, stale, and mismatched records visible without permitting reopen', () => {
  localStorage.setItem(key, '{broken');
  expect(readPrintedLibrary(formatId, fingerprint).entries[0]?.issue).toMatch(/unreadable/i);
  localStorage.setItem(key, JSON.stringify({ ...session, fingerprint: 'b'.repeat(64) }));
  expect(readPrintedLibrary(formatId, fingerprint).entries[0]?.issue).toMatch(/fingerprint/i);
  localStorage.setItem(key, JSON.stringify({ ...session, seed: 'different' }));
  expect(readPrintedLibrary(formatId, fingerprint).entries[0]?.issue).toMatch(/identity/i);
  expect(localStorage.getItem(key)).toContain('different');
});

it('lists in-progress draft picks and distinguishes no deck edit from an empty deck', () => {
  localStorage.setItem(
    'mtg.printed.draft:akh-hou:draft',
    JSON.stringify({
      mode: 'draft',
      transcript: {
        version: 1,
        formatId,
        fingerprint,
        seed: 'draft',
        humanSeatIds: ['seat-1'],
        picks: { 'seat-1': ['one', 'two'] },
      },
    }),
  );
  expect(readPrintedLibrary(formatId, fingerprint).entries[0]).toMatchObject({
    mode: 'draft',
    seed: 'draft',
    cards: null,
    picks: 2,
    issue: null,
  });
});

it('reports unavailable storage rather than pretending there are no saved decks', () => {
  vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
    throw new Error('denied');
  });
  localStorage.setItem(key, JSON.stringify(session));
  expect(readPrintedLibrary(formatId, fingerprint)).toEqual({
    entries: [],
    error: 'Saved sessions could not be read from this browser.',
  });
});
