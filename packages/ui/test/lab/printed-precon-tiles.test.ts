// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { UiRoute } from '../../src/app/router';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import type { LoadedPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { PLAY_DECKS_LABEL } from '../../src/routes/play/PlayChooser';
import {
  OPPONENT_LABEL,
  PRECON_LABEL,
  chooseTheirsLabel,
  chooseYoursLabel,
} from '../../src/routes/play/PreconPicker';
import { DECK_CARD_KIND_LABELS } from '../../src/routes/deck/DeckCard';
import {
  CONSTRUCTED_BACK_LABEL,
  PRECON_DECK_PARAM,
  PRECON_OPPONENT_PARAM,
  PrintedPreconRoute,
} from '../../src/routes/printed/PrintedPreconRoute';
import { printedCountsLine, printedPreconFacts } from '../../src/routes/printed/printed-precon-facts';

const ktkData = 'packages/data/data/ktk';
const fixture = 'packages/ui/test/fixtures/ktk-constructed-format-v1.json';
const admission = JSON.parse(readFileSync(`${ktkData}/play-admission-v24/admission.json`, 'utf8')) as {
  cards: { id: string; review: string }[];
  subject: { formatId: string };
};
const ktkRow = {
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
  displayMetadataUrl: 'formats/ktk/ktk-display-metadata-v1.json',
  catalogs: [{ code: 'KTK', url: 'formats/ktk/ktk-printed-catalog-v1.json' }],
};
const scdRow = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed' as const,
  variant: 'commander' as const,
  formatUrl: 'formats/scd/scd-constructed-format-v1.json',
  displayMetadataUrl: 'formats/scd/scd-display-metadata-v1.json',
  catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
  availability: {
    browse: 'available' as const,
    draft: 'unavailable' as const,
    sealed: 'unavailable' as const,
    play: { status: 'supported' as const, reason: 'Verified admission is installed.' },
  },
};

const MIRROR = { id: 'abzan-mirror', name: 'Abzan Mirror' };

const withChecksum = (format: Record<string, unknown>): Record<string, unknown> => {
  const { contentSha256: _checksum, ...content } = format;
  return {
    ...content,
    contentSha256: createHash('sha256')
      .update(`${JSON.stringify(content)}\n`)
      .digest('hex'),
  };
};

const twoDeckFormat = (): Record<string, unknown> => {
  const format = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, unknown> & {
    decks: Record<string, unknown>[];
  };
  const first = format.decks[0]!;
  return withChecksum({ ...format, decks: [first, { ...first, ...MIRROR }] });
};

const ktkResources = new Map<string, unknown>([
  [ktkRow.formatUrl, JSON.parse(readFileSync(`${ktkData}/ktk-limited-format-v1.json`, 'utf8'))],
  [ktkRow.constructedFormatUrl, twoDeckFormat()],
  [ktkRow.catalogs[0]!.url, JSON.parse(readFileSync(`${ktkData}/ktk-printed-catalog-v1.json`, 'utf8'))],
  [ktkRow.displayMetadataUrl, JSON.parse(readFileSync(`${ktkData}/ktk-display-metadata-v1.json`, 'utf8'))],
  [
    ktkRow.constructedAdmissionUrl,
    {
      schemaVersion: 1,
      formatId: admission.subject.formatId,
      cards: admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
    },
  ],
]);
const readScd = (url: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/scd/${url.split('/').at(-1)!}`, 'utf8'));

const momirRow = {
  id: 'momir-basic',
  name: 'Momir Basic',
  kind: 'constructed' as const,
  variant: 'momir' as const,
  formatUrl: 'formats/momir-basic/momir-basic-constructed-format-v1.json',
  catalogs: [{ code: 'M11', url: 'formats/momir-basic/m11-printed-catalog-v1.json' }],
  availability: {
    browse: 'available' as const,
    draft: 'unavailable' as const,
    sealed: 'unavailable' as const,
    play: {
      status: 'supported' as const,
      reason:
        'Verified real-Forge match admission is installed with an explicit global creature pool policy.',
    },
  },
};
const readMomir = (url: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/momir-basic/${url.split('/').at(-1)!}`, 'utf8'));

let ktk: LoadedPrintedConstructedFormat;
let scd: LoadedPrintedConstructedFormat;
let momir: LoadedPrintedConstructedFormat;

beforeAll(async () => {
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: {
      digest: async (_algorithm: string, value: ArrayBuffer) =>
        createHash('sha256').update(Buffer.from(value)).digest().buffer,
    },
    getRandomValues: (array: Uint8Array) => array.fill(3),
  });
  [ktk, scd, momir] = await Promise.all([
    loadPrintedConstructedFormat(ktkRow, async (url) => ktkResources.get(url)),
    loadPrintedConstructedFormat(scdRow, async (url) => readScd(url)),
    loadPrintedConstructedFormat(momirRow, async (url) => readMomir(url)),
  ]);
});

afterEach(cleanup);

const backend = {
  id: 'forge',
  determinism: 'observed' as const,
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () => Promise.reject(new Error('not opened')),
};

function renderPlay(
  loaded: LoadedPrintedConstructedFormat,
  page: 'constructed' | 'commander',
  params: Record<string, string> = {},
) {
  const onSetParams = vi.fn();
  const view = render(
    h(PrintedPreconRoute, {
      loaded,
      title: loaded.format.name,
      sourceCode: undefined,
      page,
      route: { mode: 'play', sub: page, params } as UiRoute,
      onSetParams,
      backend,
    }),
  );
  return { ...view, onSetParams };
}

interface DomNode {
  readonly textContent: string | null;
  readonly tagName: string;
  readonly getAttribute: (name: string) => string | null;
}
const node = (value: unknown): DomNode => value as DomNode;
const html = (value: unknown): { querySelector: (selector: string) => DomNode | null } =>
  value as { querySelector: (selector: string) => DomNode | null };
const matchupLine = (container: unknown): string =>
  html(container).querySelector('.mtg-matchup__line')?.textContent ?? '';

describe('printed constructed decks as tiles', () => {
  it('draws a Preconstructed decks section with one tile per deck', () => {
    const { container } = renderPlay(ktk, 'constructed');
    const section = screen.getByRole('region', { name: PLAY_DECKS_LABEL });
    expect(within(section).getByRole('heading', { name: PLAY_DECKS_LABEL })).toBeDefined();
    const tiles = within(within(section).getByRole('group', { name: PRECON_LABEL })).getAllByRole('button');
    expect(tiles.map((tile) => node(tile).getAttribute('aria-label'))).toEqual([
      chooseYoursLabel('Abzan Outlast'),
      chooseYoursLabel(MIRROR.name),
    ]);
    const facts = printedPreconFacts(ktk.format.decks[0]!, ktk.printings, ktk.rarities);
    expect(node(tiles[0]).textContent).toContain(DECK_CARD_KIND_LABELS.precon);
    expect(node(tiles[0]).textContent).toContain(printedCountsLine(facts));
    expect(facts.spells + facts.lands).toBe(60);
    expect(facts.rares).not.toBeNull();
    expect(within(section).getByRole('button', { name: 'Play Forge match' })).toBeDefined();
    expect(matchupLine(container)).toBe(`${ktk.format.decks[0]!.name}vs${MIRROR.name}`);
  });

  it('picks your deck from a tile and theirs from the Opponent row', () => {
    const { onSetParams } = renderPlay(ktk, 'constructed');
    fireEvent.click(screen.getByRole('button', { name: chooseYoursLabel(MIRROR.name) }));
    expect(onSetParams).toHaveBeenLastCalledWith({ [PRECON_DECK_PARAM]: MIRROR.id });
    const opponents = screen.getByRole('group', { name: OPPONENT_LABEL });
    fireEvent.click(within(opponents).getByRole('button', { name: chooseTheirsLabel(MIRROR.name) }));
    expect(onSetParams).toHaveBeenLastCalledWith({ [PRECON_OPPONENT_PARAM]: MIRROR.id });
    cleanup();
    const { container } = renderPlay(ktk, 'constructed', {
      [PRECON_DECK_PARAM]: MIRROR.id,
      [PRECON_OPPONENT_PARAM]: 'abzan-outlast',
    });
    expect(
      node(screen.getByRole('button', { name: chooseYoursLabel(MIRROR.name) })).getAttribute('aria-pressed'),
    ).toBe('true');
    const theirs = within(screen.getByRole('group', { name: OPPONENT_LABEL })).getByRole('button', {
      name: chooseTheirsLabel('Abzan Outlast'),
    });
    expect(node(theirs).getAttribute('aria-pressed')).toBe('true');
    expect(matchupLine(container)).toBe(`${MIRROR.name}vsAbzan Outlast`);
    fireEvent.click(screen.getByRole('button', { name: `View ${MIRROR.name}` }));
    expect(screen.getByRole('button', { name: CONSTRUCTED_BACK_LABEL })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeDefined();
  });

  it('draws no plan or centerpiece line for a printed deck that states none', () => {
    const { container } = renderPlay(ktk, 'constructed');
    expect(html(container).querySelector('.mtg-deckcard__plan')).toBeNull();
    expect(html(container).querySelector('.mtg-deckcard__payoff')).toBeNull();
    expect(html(container).querySelector('.mtg-deckcard__counts')).not.toBeNull();
  });

  it('omits the rare count when any card in the deck has no rarity entry', () => {
    const facts = printedPreconFacts(ktk.format.decks[0]!, ktk.printings, {});
    expect(facts.rares).toBeNull();
    expect(printedCountsLine(facts)).not.toContain('rare');
    expect(printedCountsLine(facts)).toContain('land');
    expect(facts.colors).toEqual(['W', 'R']);
  });

  it('draws no Preconstructed decks section for a format with no decks', () => {
    renderPlay({ ...ktk, format: { ...ktk.format, decks: [] } }, 'constructed');
    expect(screen.queryByRole('region', { name: PLAY_DECKS_LABEL })).toBeNull();
    expect(node(screen.getByRole('status')).textContent).toBe('This format ships no decks.');
  });

  it('leaves the Commander list as it was', () => {
    renderPlay(scd, 'commander');
    expect(screen.queryByRole('region', { name: PLAY_DECKS_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    expect(node(screen.getByLabelText('Your deck')).tagName).toBe('SELECT');
    expect(node(screen.getByLabelText('Across the table')).tagName).toBe('SELECT');
    expect(screen.getByRole('region', { name: `Your deck: ${scd.format.decks[0]!.name}` })).toBeDefined();
  });
});

describe('Momir Basic draws its own landing', () => {
  it('states the format in plain words instead of a deck-tile picker or a mirror matchup line', () => {
    const { container } = renderPlay(momir, 'constructed');
    expect(screen.queryByRole('region', { name: PLAY_DECKS_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    expect(screen.queryByLabelText('Your deck')).toBeNull();
    expect(screen.queryByLabelText('Across the table')).toBeNull();
    expect(matchupLine(container)).toBe('');
    expect(node(container).textContent).toContain('60');
    expect(node(container).textContent).toContain('24');
    expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeDefined();
  });

  it('still lets you open its one deck, with no mirror matchup line over it', () => {
    const { container } = renderPlay(momir, 'constructed');
    fireEvent.click(screen.getByRole('button', { name: `View ${momir.format.decks[0]!.name}` }));
    expect(screen.getByRole('button', { name: CONSTRUCTED_BACK_LABEL })).toBeDefined();
    expect(matchupLine(container)).toBe('');
  });
});
