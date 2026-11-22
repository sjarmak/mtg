// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { PrintedFormatRoute } from '../../src/routes/printed/PrintedFormatRoute';
import type { PrintedFormatState } from '../../src/routes/printed/use-printed-format';
import { writeStored } from '../../src/routes/deck/local-store';

let prepared: PreparedPrintedLimitedFormat;
beforeAll(async () => {
  const read = (name: string): unknown => JSON.parse(readFileSync(`packages/data/data/isd/${name}`, 'utf8'));
  prepared = await preparePrintedLimitedFormat(
    read('isd-limited-format-v1.json'),
    [read('isd-printed-catalog-v1.json')],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function ready(
  play: Extract<PrintedFormatState, { readonly status: 'ready' }>['value']['availability']['play'] = {
    status: 'unavailable',
    reason: 'Full Forge admission is incomplete.',
  },
): PrintedFormatState {
  return {
    status: 'ready',
    value: {
      availability: {
        browse: 'available',
        draft: 'available',
        sealed: 'available',
        play,
      },
      rarities: {},
      tokens: [],
      prepared,
      catalogs: [],
    },
  } as PrintedFormatState;
}

it('translates play admission into player-facing draft copy', () => {
  const route = { mode: 'play' as const, sub: 'draft' as const, params: {} };
  const props = {
    title: 'Innistrad',
    sourceCode: undefined,
    page: 'draft' as const,
    route,
    onSetParams: vi.fn(),
  };
  const supported = render(
    h(PrintedFormatRoute, {
      ...props,
      state: ready({ status: 'supported', reason: 'Verified admission is installed.' }),
    }),
  );
  expect(screen.getByText(/Plays against Forge\./)).toBeTruthy();
  expect(screen.queryByText(/Verified admission is installed/)).toBeNull();
  supported.unmount();
  render(
    h(PrintedFormatRoute, {
      ...props,
      state: ready({ status: 'experimental', reason: 'Partial admission evidence.' }),
    }),
  );
  expect(screen.getByText(/You can try a Forge match, but it may stop\./)).toBeTruthy();
  expect(screen.queryByText(/Partial admission evidence/)).toBeNull();
});

it('keeps admission evidence on the cards gallery', () => {
  render(
    h(PrintedFormatRoute, {
      state: ready({ status: 'supported', reason: 'Verified admission is installed.' }),
      title: 'Innistrad',
      sourceCode: undefined,
      page: 'gallery',
      route: { mode: 'cards', sub: 'gallery', params: {} },
      onSetParams: vi.fn(),
    }),
  );
  expect(screen.getByText(/Verified admission is installed/)).toBeTruthy();
});

function transcript(seed: string, picks: readonly string[]): string {
  return JSON.stringify({
    mode: 'draft',
    transcript: {
      version: 1,
      formatId: prepared.format.id,
      fingerprint: prepared.fingerprint,
      seed,
      humanSeatIds: ['seat-1'],
      picks: { 'seat-1': picks },
    },
  });
}

function href(name: RegExp | string): string | null {
  return (
    screen.getByRole('link', { name }) as unknown as { getAttribute(n: string): string | null }
  ).getAttribute('href');
}

it('lists an unfinished draft to continue and a finished one to open beside New draft', () => {
  const packs = prepared.openDraftPacks('draft/half');
  const first = packs[0]!.cards[0]!.physicalId;
  writeStored('mtg.printed.draft:isd:draft/half', transcript('draft/half', [first]));
  const whole = prepared
    .openDraftPacks('draft/done')
    .filter((pack) => pack.openedBy === 'seat-1')
    .reduce((total, pack) => total + pack.cards.length, 0);
  writeStored(
    'mtg.printed.draft:isd:draft/done',
    JSON.stringify({
      ...JSON.parse(
        transcript(
          'draft/done',
          Array.from({ length: whole }, (_, i) => `pick-${String(i)}`),
        ),
      ),
      deck: {
        selectedPhysicalIds: ['pick-0'],
        basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
      },
    }),
  );
  writeStored(
    'mtg.printed.sealed:isd:pool/one',
    JSON.stringify({
      version: 1,
      mode: 'sealed',
      formatId: 'isd',
      fingerprint: prepared.fingerprint,
      seed: 'pool/one',
    }),
  );
  const onSetParams = vi.fn();
  render(
    h(PrintedFormatRoute, {
      state: ready(),
      title: 'Innistrad',
      sourceCode: undefined,
      page: 'draft',
      route: { mode: 'play', sub: 'draft', params: { source: 'printed:isd' } },
      onSetParams,
    }),
  );
  const saved = screen.getByRole('region', { name: 'Saved drafts' });
  expect(within(saved).getByText('Saved drafts in this browser')).toBeTruthy();
  expect(href('Continue draft draft/half')).toBe('#/play/draft?seed=draft%2Fhalf&source=printed%3Aisd');
  expect(within(saved).getByText(`1 of ${String(whole)} picks made`)).toBeTruthy();
  expect(href('Open drafted deck draft/done')).toBe('#/play/draft?seed=draft%2Fdone&source=printed%3Aisd');
  expect(within(saved).getByText('1 cards in deck')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /sealed pool/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
  expect(onSetParams).toHaveBeenCalledWith({ seed: expect.stringMatching(/^isd\/draft\//) });
});

it('lists saved sealed pools on the sealed page and nothing at all on a first visit', () => {
  const props = {
    state: ready(),
    title: 'Innistrad',
    sourceCode: undefined,
    page: 'sealed' as const,
    route: { mode: 'play' as const, sub: 'sealed' as const, params: {} },
    onSetParams: vi.fn(),
  };
  const first = render(h(PrintedFormatRoute, props));
  expect(screen.queryByRole('region', { name: /Saved/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Generate sealed pool' })).toBeTruthy();
  first.unmount();
  writeStored(
    'mtg.printed.sealed:isd:pool/two',
    JSON.stringify({
      version: 1,
      mode: 'sealed',
      formatId: 'isd',
      fingerprint: prepared.fingerprint,
      seed: 'pool/two',
      deck: { selectedPhysicalIds: [], basics: { Plains: 17, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 } },
    }),
  );
  writeStored(
    'mtg.printed.sealed:isd:pool/stale',
    JSON.stringify({
      version: 1,
      mode: 'sealed',
      formatId: 'isd',
      fingerprint: 'b'.repeat(64),
      seed: 'pool/stale',
    }),
  );
  render(h(PrintedFormatRoute, props));
  const saved = screen.getByRole('region', { name: 'Saved sealed pools' });
  expect(href('Open sealed pool pool/two')).toBe('#/play/sealed?seed=pool%2Ftwo');
  expect(within(saved).getByText('17 cards in deck')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /pool\/stale/ })).toBeNull();
  expect(within(saved).getByText(/Saved format fingerprint differs/)).toBeTruthy();
});
