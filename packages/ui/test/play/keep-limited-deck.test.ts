// @vitest-environment jsdom
/**
 * A sealed or drafted deck can be kept, and says which it was.
 *
 * `mtg-j1rg`. The lab could build a Limited deck four ways and keep none of
 * them: `../../src/routes/play/sealed-session.ts` writes the *pool* down so a
 * session resumes, and a finished 40-card deck had nowhere to go at all. The
 * constructed builder's save panel was the only surface in the lab that could
 * write a deck, so the deck library held one population out of three.
 *
 * What this file holds is the seam and the document it writes:
 *
 * - the copies are counted **by card id**, because a sealed pool has duplicates
 *   in it and six boosters put three copies of one common in front of you; the
 *   constructed builder's `savedEntries` counts a pool that lists each card
 *   once and would record that deck as three separate one-ofs;
 * - the basics are the ones the mana base counted out, recorded rather than
 *   left `null`, because `null` in that document means *re-suggest the base*
 *   and a 40-card Limited base re-suggested against a 60-card Constructed
 *   builder is a different deck;
 * - the source is on the document, so the library can say where the deck came
 *   from rather than filing three histories under one word;
 * - pressing the control twice updates one deck rather than making two, since
 *   the id is held for as long as the screen is.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card, Color } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor, openSealed } from '../../src/routes/play/sealed';
import type { SealedBuild } from '../../src/routes/play/sealed';
import {
  KEEP_DECK_LABEL,
  limitedBasics,
  limitedDeckName,
  limitedEntries,
  limitedSavedDeck,
} from '../../src/routes/play/keep-limited-deck';
import { readSavedDecks, savedCardCount } from '../../src/routes/deck/saved-decks';
import type { SavedDeck } from '../../src/routes/deck/saved-decks';
import { KEPT_BY_BROWSER_NOTE, resetDeckKeeping } from '../../src/routes/deck/deck-keeping';

afterEach(cleanup);

afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
  resetDeckKeeping();
  vi.restoreAllMocks();
});

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
const SEED = 'lab/sealed/qtxm4rknbcde';
const NOTE = 'Six packs, one deck to build.';

/** No `lib: dom` in this workspace, so the one shape this file reaches for is spelled out. */
interface NodeLike {
  readonly textContent: string | null;
}

/** A pool with a card in it twice, which is the case the id counting exists for. */
function doubledPool(): SealedBuild {
  const [first, second] = SET;
  if (first === undefined || second === undefined) throw new Error('the fixture set is too small');
  return {
    pool: [first, second, first],
    chosen: [0, 1, 2],
    basics: null,
    set: SET,
    foils: null,
  };
}

function keptDeck(): SavedDeck {
  const decks = readSavedDecks();
  const deck = decks[0];
  if (deck === undefined) throw new Error('nothing was kept');
  return deck;
}

function sealedScreen(source: 'sealed' | 'draft'): void {
  const build = openSealed(SET, SEED);
  render(
    h(SealedBuilder, {
      build,
      deck: deckFor(build),
      onToggle: () => undefined,
      onSuggest: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onPlay: () => undefined,
      contextNote: NOTE,
      seed: SEED,
      source,
      setRef: { name: 'Tideglass Reach', origin: 'custom' as const },
    }),
  );
}

describe('what a kept Limited deck records', () => {
  it('counts the copies by card id rather than by pool position', () => {
    const build = doubledPool();
    const entries = limitedEntries(build);
    expect(entries.length).toBe(2);
    const [first] = entries;
    expect(first?.id).toBe(build.pool[0]?.id);
    expect(first?.count).toBe(2);
    expect(entries[1]?.count).toBe(1);
  });

  it('records only the cards that were chosen', () => {
    const build = { ...doubledPool(), chosen: [1] };
    expect(limitedEntries(build).map((entry) => entry.id)).toEqual([build.pool[1]?.id]);
  });

  it('writes the basics that were counted out, dropping the colors with none', () => {
    const lands: Readonly<Record<Color, number>> = { W: 9, U: 0, B: 8, R: 0, G: 0 };
    expect(limitedBasics(lands)).toEqual([
      { color: 'W', count: 9 },
      { color: 'B', count: 8 },
    ]);
  });

  it('is never null, because null means re-suggest a base this deck does not want', () => {
    expect(limitedBasics({ W: 0, U: 0, B: 0, R: 0, G: 0 })).toEqual([]);
  });

  it('names the deck after the pool it was cut from, and does not reuse a name', () => {
    expect(limitedDeckName('sealed', SEED, [])).toBe('Sealed deck qtxm4rknbcde');
    expect(limitedDeckName('draft', 'lab/draft/abcdefghjkmn', [])).toBe('Draft deck abcdefghjkmn');
    const taken = [{ ...keptStub(), name: 'Sealed deck qtxm4rknbcde' }];
    expect(limitedDeckName('sealed', SEED, taken)).toBe('Sealed deck qtxm4rknbcde (2)');
    // A seed whose token is already the word does not say it twice.
    expect(limitedDeckName('sealed', 'ui/fixtures/sealed', [])).toBe('Sealed deck');
  });

  it('carries the source and the set on the document', () => {
    const build = doubledPool();
    const deck = limitedSavedDeck({
      id: 'deck-1',
      name: 'a kept pool',
      savedAt: '2026-09-02T00:00:00.000Z',
      build,
      landsByColor: { W: 0, U: 7, B: 0, R: 0, G: 0 },
      source: 'draft',
      set: { name: 'Tideglass Reach', origin: 'custom' },
    });
    expect(deck.source).toBe('draft');
    expect(deck.set).toEqual({ name: 'Tideglass Reach', origin: 'custom' });
    expect(deck.basics).toEqual([{ color: 'U', count: 7 }]);
    expect(savedCardCount(deck)).toBe(3);
  });
});

/** A saved deck to hang a name on, with nothing else true about it. */
function keptStub(): SavedDeck {
  return {
    version: 1,
    id: 'deck-stub',
    name: 'stub',
    savedAt: '2026-09-02T00:00:00.000Z',
    entries: [],
    basics: null,
  };
}

describe('keeping the deck from the Limited builder', () => {
  it('writes the deck the screen is showing, with the source it was built on', () => {
    sealedScreen('sealed');
    const build = openSealed(SET, SEED);
    fireEvent.click(screen.getByRole('button', { name: KEEP_DECK_LABEL }));
    const deck = keptDeck();
    expect(deck.source).toBe('sealed');
    expect(deck.entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(build.chosen.length);
    expect(deck.set).toEqual({ name: 'Tideglass Reach', origin: 'custom' });
    // The mana base is written down rather than left to be re-suggested.
    expect(deck.basics).not.toBeNull();
    expect((deck.basics ?? []).reduce((sum, basic) => sum + basic.count, 0)).toBeGreaterThan(0);
  });

  it('says the deck was kept, by name, in one sentence', () => {
    sealedScreen('sealed');
    fireEvent.click(screen.getByRole('button', { name: KEEP_DECK_LABEL }));
    const kept = keptDeck();
    const note = screen.getByRole('status') as unknown as NodeLike;
    const text = note.textContent ?? '';
    expect(text).toContain(kept.name);
    // No deck server answers under jsdom, so this is the browser-only case and
    // it says so — in a clause. Not the whole keeper paragraph: this line sits
    // above a frame that divides a fixed height, and photographed on a 844x390
    // phone the paragraph took two rows off the panes to repeat what the Decks
    // tab says permanently one press away.
    expect(text).toContain('this browser only');
    expect(text).not.toContain(KEPT_BY_BROWSER_NOTE);
  });

  it('updates the one deck rather than keeping a second copy of it', () => {
    sealedScreen('sealed');
    const keep = screen.getByRole('button', { name: KEEP_DECK_LABEL });
    fireEvent.click(keep);
    const first = keptDeck().id;
    fireEvent.click(keep);
    expect(readSavedDecks().length).toBe(1);
    expect(keptDeck().id).toBe(first);
  });

  it('records a drafted deck as drafted', () => {
    sealedScreen('draft');
    fireEvent.click(screen.getByRole('button', { name: KEEP_DECK_LABEL }));
    expect(keptDeck().source).toBe('draft');
  });
});
