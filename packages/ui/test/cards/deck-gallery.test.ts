// @vitest-environment jsdom
/**
 * The Decks section of the Cards tab.
 *
 * `mtg-aay2k` widened this gallery from the workbench's own shelf
 * (`mtg-a982g.1`) to every deck the lab has: a precon written beside the
 * staged set, `@mtg/decklab`'s artifact built from the card store, a
 * workbench variation, and a deck saved in this browser. What is pinned here
 * is the acceptance criteria itself — the gallery lists all four kinds, drops
 * the descriptive plan text and the underlined link, and draws each deck's
 * colors as mana-registry pips rather than bare letters — plus the shape
 * `../deck/deck-library.test.ts` already pins for the same four sources: a
 * link the workbench answers to, per-deck set and card count.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { parsePreconFile } from '@mtg/deckbuild';
import {
  DECK_GALLERY_EMPTY_NOTE,
  DECK_GALLERY_LABEL,
  DeckGallery,
  deckGalleryTileHref,
  deckGalleryTileLabel,
} from '../../src/routes/cards/DeckGallery';
import type { DeckGalleryProps } from '../../src/routes/cards/DeckGallery';
import { counted, DECK_CARD_KIND_LABELS, deckCountsLine } from '../../src/routes/deck/DeckCard';
import { DECK_OPEN_PARAM } from '../../src/routes/deck/open';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact } from '../../src/lab/deck-artifact';
import { SAVED_DECK_VERSION, writeSavedDecks } from '../../src/routes/deck/saved-decks';
import type { SavedDeck } from '../../src/routes/deck/saved-decks';
import { resetDeckKeeping } from '../../src/routes/deck/deck-keeping';
import { selectable } from '../../src/routes/deck/build';

/** The staged set every precon and saved deck here is shelved under. */
const STAGED = { name: 'The Tideglass Prototype', origin: 'custom' as const };

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

const SPELL_IDS = selectable(SET)
  .slice(0, 6)
  .map((card) => card.id);

const FIRST_SPELL = SPELL_IDS[0];
if (FIRST_SPELL === undefined) throw new Error('the prototype set has no selectable card');

/** One precon, cut from the committed prototype set the way `../deck/deck-library.test.ts` does. */
const PRECON: PreconFile = parsePreconFile({
  formatVersion: 1,
  setCode: 'TGR',
  decks: [
    {
      id: 'tide',
      name: 'The Tide Comes In',
      plan: 'Hold the board and win late.',
      payoff: FIRST_SPELL,
      deckSize: 60,
      basics: { U: 24 },
      spells: SPELL_IDS.map((id) => ({ id, count: 6 })),
    },
  ],
});

/** The decklab artifact deck, read off the committed fixture other tests already trust. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ARTIFACT_FIXTURE = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

function committedArtifact(): DeckArtifact {
  const parsed = readDeckArtifact(JSON.parse(readFileSync(ARTIFACT_FIXTURE, 'utf8')), ARTIFACT_FIXTURE);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

const ARTIFACT = committedArtifact();

/** A deck saved in this browser, colored off its own basics rather than off the set. */
const SAVED: SavedDeck = {
  version: SAVED_DECK_VERSION,
  id: 'saved-1',
  name: 'A deck kept here',
  savedAt: '2026-09-10T10:00:00.000Z',
  entries: [{ id: FIRST_SPELL, name: 'a card', count: 4 }],
  basics: [{ color: 'B', count: 20 }],
  set: STAGED,
  source: 'constructed',
};

const VARIATION_ROW = {
  id: 'v1',
  name: 'tide tempo',
  builtAt: '2026-09-01T00:00:00.000Z',
  parentId: null,
  prompt: 'a two-color tempo deck',
  sets: ['TGR'],
  colors: ['W', 'U'],
  totalCards: 60,
  shortfallCount: 0,
};

function stubDeckServer(): void {
  vi.stubGlobal('fetch', (input: string) => {
    const url = String(input);
    const answer = (body: unknown): Promise<Response> =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    if (url.endsWith('/deck-api/sets')) {
      return answer({ sets: [{ code: 'TGR', name: STAGED.name, cardCount: SET.length }], builds: false });
    }
    if (url.endsWith('/deck-api/variations')) return answer({ variations: [VARIATION_ROW], unreadable: [] });
    return answer({});
  });
}

/**
 * A rendered element, narrowed by hand.
 *
 * There is no `lib: dom` in this workspace, so `HTMLElement` carries no
 * members even though jsdom provides one at runtime. `../deck/deck-library.test.ts`
 * reaches an element the same way.
 */
interface ElementLike {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly className: string;
  querySelector(selector: string): ElementLike | null;
  querySelectorAll(selector: string): readonly ElementLike[];
}

function elementOf(value: unknown): ElementLike {
  return value as unknown as ElementLike;
}

/** The text of an element, narrowed by hand: no `lib: dom` in this workspace. */
function textOf(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('textContent' in value)) return '';
  const { textContent } = value as { textContent: unknown };
  return typeof textContent === 'string' ? textContent : '';
}

const FULL_PROPS: DeckGalleryProps = {
  state: { status: 'ready', deck: ARTIFACT },
  precons: { status: 'ready', file: PRECON },
  cards: SET,
  set: STAGED,
};

beforeEach((): void => {
  localStorage.clear();
  resetDeckKeeping();
});

afterEach((): void => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetDeckKeeping();
});

describe('the deck gallery', () => {
  it('lists a deck of every kind the lab has, not only the ones built from a description', async () => {
    writeSavedDecks([SAVED]);
    stubDeckServer();
    render(h(DeckGallery, FULL_PROPS));

    await waitFor(() => {
      expect(screen.getByRole('group', { name: DECK_GALLERY_LABEL })).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: deckGalleryTileLabel('The Tide Comes In') })).toBeTruthy();
    expect(screen.getByRole('link', { name: deckGalleryTileLabel(ARTIFACT.prompt) })).toBeTruthy();
    expect(screen.getByRole('link', { name: deckGalleryTileLabel('tide tempo') })).toBeTruthy();
    expect(screen.getByRole('link', { name: deckGalleryTileLabel('A deck kept here') })).toBeTruthy();
  });

  it('links each tile to the workbench, open on that one deck', async () => {
    writeSavedDecks([SAVED]);
    stubDeckServer();
    render(h(DeckGallery, FULL_PROPS));

    const precon = (await waitFor(() =>
      screen.getByRole('link', { name: deckGalleryTileLabel('The Tide Comes In') }),
    )) as unknown as ElementLike;
    expect(precon.getAttribute('href')).toBe(deckGalleryTileHref({ kind: 'precon', id: 'tide' }));
    expect(precon.getAttribute('href')).toBe(`#/customize/decks?${DECK_OPEN_PARAM}=precon%3Atide`);

    const artifact = screen.getByRole('link', {
      name: deckGalleryTileLabel(ARTIFACT.prompt),
    }) as unknown as ElementLike;
    expect(artifact.getAttribute('href')).toBe(deckGalleryTileHref({ kind: 'artifact' }));

    const variation = screen.getByRole('link', {
      name: deckGalleryTileLabel('tide tempo'),
    }) as unknown as ElementLike;
    expect(variation.getAttribute('href')).toBe(deckGalleryTileHref({ kind: 'variation', id: 'v1' }));

    const saved = screen.getByRole('link', {
      name: deckGalleryTileLabel('A deck kept here'),
    }) as unknown as ElementLike;
    expect(saved.getAttribute('href')).toBe(deckGalleryTileHref({ kind: 'build', savedId: 'saved-1' }));
  });

  it('says what kind of deck each tile is, its card count, and which set its cards come from', async () => {
    writeSavedDecks([SAVED]);
    stubDeckServer();
    render(h(DeckGallery, FULL_PROPS));

    const precon = textOf(
      await waitFor(() => screen.getByRole('link', { name: deckGalleryTileLabel('The Tide Comes In') })),
    );
    expect(precon).toContain(DECK_CARD_KIND_LABELS.precon);
    expect(precon).toContain(counted(60, 'card'));
    expect(precon).toContain(STAGED.name);

    const artifact = textOf(screen.getByRole('link', { name: deckGalleryTileLabel(ARTIFACT.prompt) }));
    expect(artifact).toContain(DECK_CARD_KIND_LABELS.artifact);
    expect(artifact).toContain(counted(ARTIFACT.totalCards, 'card'));
    expect(artifact).toContain(ARTIFACT.format);

    const variation = textOf(screen.getByRole('link', { name: deckGalleryTileLabel('tide tempo') }));
    expect(variation).toContain(DECK_CARD_KIND_LABELS.variation);
    expect(variation).toContain(deckCountsLine([counted(60, 'card'), 'TGR']));

    const saved = textOf(screen.getByRole('link', { name: deckGalleryTileLabel('A deck kept here') }));
    expect(saved).toContain(DECK_CARD_KIND_LABELS.saved);
    expect(saved).toContain(counted(4, 'card'));
    expect(saved).toContain(STAGED.name);
  });

  it('drops the plan sentence a precon carries, which used to be on every tile', async () => {
    stubDeckServer();
    render(h(DeckGallery, FULL_PROPS));

    const precon = elementOf(
      await waitFor(() => screen.getByRole('link', { name: deckGalleryTileLabel('The Tide Comes In') })),
    );
    expect(textOf(precon)).not.toContain('Hold the board and win late.');
    expect(precon.querySelectorAll('.mtg-deckcard__plan').length).toBe(0);
  });

  it('draws no underline on a tile, unlike a plain link', async () => {
    stubDeckServer();
    const { container } = render(h(DeckGallery, FULL_PROPS));

    const precon = elementOf(
      await waitFor(() => screen.getByRole('link', { name: deckGalleryTileLabel('The Tide Comes In') })),
    );
    // jsdom applies no stylesheet, so the rule itself is what is asserted:
    // `.mtg-deckcard` states `text-decoration: none` in `../../src/styles/deck-card.ts`.
    expect(precon.className).toContain('mtg-deckcard');
    expect(elementOf(container).querySelector('a.mtg-deckcard')).toBeTruthy();
  });

  it('draws a deck of two colors as two mana-registry pips, not the letters', async () => {
    stubDeckServer();
    render(h(DeckGallery, FULL_PROPS));

    // The variation names two colors (W, U). A raw-letter tile used to draw
    // "WU" as text; the pips it draws instead carry the glyph as an SVG path
    // rather than a text node, so the colors region's own text is empty.
    const variation = elementOf(
      await waitFor(() => screen.getByRole('link', { name: deckGalleryTileLabel('tide tempo') })),
    );
    const colors = variation.querySelectorAll('.mtg-deckcard__colors .mtg-pip');
    expect(colors.length).toBe(2);
    expect(textOf(variation)).not.toContain('WU');

    const pips = variation.querySelector('.mtg-deckcard__colors');
    expect(pips?.getAttribute('aria-label')).toBe('white, blue');
  });

  it('draws colorless as the word, for a deck with no colored mana', async () => {
    const colorless = { ...VARIATION_ROW, id: 'v2', name: 'the colorless one', colors: [] };
    vi.stubGlobal('fetch', (input: string) => {
      const url = String(input);
      const answer = (body: unknown): Promise<Response> =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
      if (url.endsWith('/deck-api/sets')) return answer({ sets: [], builds: false });
      if (url.endsWith('/deck-api/variations')) return answer({ variations: [colorless], unreadable: [] });
      return answer({});
    });
    render(h(DeckGallery, FULL_PROPS));

    const tile = textOf(
      await waitFor(() => screen.getByRole('link', { name: deckGalleryTileLabel('the colorless one') })),
    );
    expect(tile).toContain('colorless');
  });

  it('says how to build or describe a deck when the lab has none of the four kinds', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')));
    render(h(DeckGallery, { state: { status: 'absent' }, cards: SET }));

    await waitFor(() => {
      expect(screen.getByText(DECK_GALLERY_EMPTY_NOTE)).toBeTruthy();
    });
    expect(screen.queryByRole('group', { name: DECK_GALLERY_LABEL })).toBeNull();
  });
});
