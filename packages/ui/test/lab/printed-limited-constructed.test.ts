// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { UiRoute } from '../../src/app/router';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { loadPrintedFormat } from '../../src/lab/printed-format';
import { CONSTRUCTED_BACK_LABEL } from '../../src/routes/printed/PrintedPreconRoute';
import { PrintedSelectionRoute } from '../../src/routes/printed/PrintedSelectionRoute';

const data = 'packages/data/data/ktk';
const fixture = 'packages/ui/test/fixtures/ktk-constructed-format-v1.json';
const admission = JSON.parse(readFileSync(`${data}/play-admission-v23/admission.json`, 'utf8')) as {
  cards: { id: string; review: string }[];
  subject: { formatId: string; formatSha256: string };
};
const row = {
  id: 'ktk',
  name: 'Khans of Tarkir',
  kind: 'limited' as const,
  availability: {
    browse: 'available' as const,
    draft: 'available' as const,
    sealed: 'available' as const,
    play: { status: 'supported' as const, reason: 'Verified admission is installed.' },
  },
  formatUrl: 'formats/ktk/ktk-limited-format-v1.json',
  constructedFormatUrl: 'formats/ktk/ktk-constructed-format-v1.json',
  constructedAdmissionUrl: 'formats/ktk/ktk-constructed-admission-v1.json',
  catalogs: [{ code: 'KTK', url: 'formats/ktk/ktk-printed-catalog-v1.json' }],
};
const resources = new Map<string, unknown>([
  [row.formatUrl, JSON.parse(readFileSync(`${data}/ktk-limited-format-v1.json`, 'utf8'))],
  [row.constructedFormatUrl, JSON.parse(readFileSync(fixture, 'utf8'))],
  [row.catalogs[0]!.url, JSON.parse(readFileSync(`${data}/ktk-printed-catalog-v1.json`, 'utf8'))],
  [
    row.constructedAdmissionUrl,
    {
      schemaVersion: 1,
      formatId: admission.subject.formatId,
      cards: admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    },
  ],
]);
const read = async (url: string): Promise<unknown> => resources.get(url);
let limited: Awaited<ReturnType<typeof loadPrintedFormat>>;
let constructed: Awaited<ReturnType<typeof loadPrintedConstructedFormat>>;

const withChecksum = (format: Record<string, unknown>) => {
  const { contentSha256: _checksum, ...content } = format;
  return {
    ...content,
    contentSha256: createHash('sha256')
      .update(`${JSON.stringify(content)}\n`)
      .digest('hex'),
  };
};

beforeAll(async () => {
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: {
      digest: async (_algorithm: string, value: ArrayBuffer) =>
        createHash('sha256').update(Buffer.from(value)).digest().buffer,
    },
    getRandomValues: (array: Uint8Array) => array.fill(3),
  });
  [limited, constructed] = await Promise.all([
    loadPrintedFormat(row, read),
    loadPrintedConstructedFormat(row, read),
  ]);
});

afterEach(cleanup);

it('shows KTK constructed decks under Constructed while keeping the limited selection', () => {
  render(
    h(PrintedSelectionRoute, {
      state: { status: 'ready', value: { kind: 'limited', loaded: limited, constructed } },
      title: row.name,
      sourceCode: undefined,
      page: 'constructed',
      route: { mode: 'play', sub: 'constructed', params: {} } as UiRoute,
      onSetParams: vi.fn(),
      backend: {
        id: 'forge',
        determinism: 'observed',
        capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
        supports: () => Promise.resolve([]),
        open: () => Promise.reject(new Error('not opened')),
      },
    }),
  );
  expect(screen.getByRole('heading', { name: 'Khans of Tarkir' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'View Abzan Outlast' }));
  expect(screen.getByRole('button', { name: CONSTRUCTED_BACK_LABEL })).toBeDefined();
});

it('refuses a limited format sidecar that is not Standard at twenty life', async () => {
  const changed = structuredClone(resources.get(row.constructedFormatUrl)) as Record<string, unknown> & {
    rules: { variant: string; startingLife: number };
  };
  changed.rules.startingLife = 21;
  const changedResources = new Map(resources).set(row.constructedFormatUrl, withChecksum(changed));
  await expect(loadPrintedConstructedFormat(row, async (url) => changedResources.get(url))).rejects.toThrow(
    /require Standard rules at 20 life/,
  );
});

it('refuses a limited format sidecar whose deck is not sixty cards', async () => {
  const changed = structuredClone(resources.get(row.constructedFormatUrl)) as Record<string, unknown> & {
    decks: { cards: { count: number }[] }[];
  };
  changed.decks[0]!.cards[0]!.count = 3;
  const changedResources = new Map(resources).set(row.constructedFormatUrl, withChecksum(changed));
  await expect(loadPrintedConstructedFormat(row, async (url) => changedResources.get(url))).rejects.toThrow(
    /deck abzan-outlast.*59 cards/u,
  );
});
