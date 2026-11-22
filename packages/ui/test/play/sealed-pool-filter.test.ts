// @vitest-environment jsdom
/**
 * The sealed pool narrows by color, and the deck pane is left alone.
 *
 * `mtg-aqxi.4`. Seventy-two cards is small enough that `../../src/routes/deck/
 * pool-filter.ts` argued sealed "needs no search", and that argument stands:
 * what is offered here is the color facets and a count, not the search box the
 * Constructed pool has over 368 cards. Reading a pool is a color question
 * before it is a text one, and on a 390px column seventy-two faces is eight
 * screens of scrolling whichever way it is held.
 *
 * The filter is the pool pane's alone. A deck is a decision already made, so
 * hiding half of it behind a facet would be hiding the thing being built; the
 * pane that narrows is the one being searched through.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { colorFacetsOf } from '../../src/routes/deck/pool-filter';
import {
  EMPTY_SEALED_DECK_NOTE,
  EMPTY_SEALED_FILTER_NOTE,
  DECK_CARDS_LABEL,
  SealedBuilder,
  SEALED_POOL_LABEL,
} from '../../src/routes/play/SealedBuilder';
import { deckFor, openSealed } from '../../src/routes/play/sealed';

afterEach(cleanup);

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

const SEED = 'lab/test/sealed-filter';

interface NodeLike {
  readonly querySelectorAll: (selector: string) => { readonly length: number };
}

interface FacetLike {
  readonly querySelector: (selector: string) => unknown;
}

/**
 * Faces, which since the duplicate collapse is distinct cards rather than
 * copies: `./sealed-copies.test.ts` owns that reading, and what this file asks
 * is which cards a facet leaves on screen.
 */
function faces(label: string): number {
  return (screen.getByRole('group', { name: label }) as unknown as NodeLike).querySelectorAll('.mtg-card')
    .length;
}

/** Copies, counted as strips: the deck pane's drawing since `mtg-pmpu.1`. */
function copies(label: string): number {
  return (screen.getByRole('group', { name: label }) as unknown as NodeLike).querySelectorAll(
    '.mtg-strips__card',
  ).length;
}

function distinct(cards: readonly { readonly card: Card }[]): number {
  return new Set(cards.map((entry) => entry.card.id)).size;
}

function builder(): { readonly pool: readonly Card[]; readonly chosen: readonly number[] } {
  const build = openSealed(loadSet(), SEED);
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
      contextNote: 'A sealed pool, mounted directly by a test.',
      seed: SEED,
      source: 'sealed' as const,
    }),
  );
  return build;
}

describe('a pane that draws no faces draws a sentence', () => {
  /**
   * The Constructed builder learned this in the 2026-08-23 cleanup wave
   * (requirement 6, no empty section over a blank page). The sealed panes had no
   * empty state at all, because until the color facets landed neither pane could
   * be empty: the pool is what the suggestion did not play, and the suggestion
   * never plays all of it.
   *
   * Built by hand rather than dealt, so the emptiness is the subject rather than
   * a property of a seed. One white card, nothing chosen: press Blue and the
   * pool has nothing in it, and the deck pane started with nothing in it.
   */
  function oneWhiteCard(): void {
    const white = loadSet().find((card) => colorFacetsOf(card).includes('W'));
    if (white === undefined) throw new Error('the fixture set has no white card');
    const build = { ...openSealed(loadSet(), SEED), pool: [white], chosen: [] };
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
        contextNote: 'A sealed pool, mounted directly by a test.',
        seed: SEED,
        source: 'sealed' as const,
      }),
    );
  }

  it('explains a pool the facets have emptied', () => {
    oneWhiteCard();
    expect(faces(SEALED_POOL_LABEL)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(faces(SEALED_POOL_LABEL)).toBe(0);
    expect(screen.queryByText(EMPTY_SEALED_FILTER_NOTE)).not.toBeNull();
  });

  it('explains a deck with nothing in it yet', () => {
    oneWhiteCard();
    expect(screen.queryByText(EMPTY_SEALED_DECK_NOTE)).not.toBeNull();
  });
});

describe('the sealed pool narrows by color', () => {
  it('draws the color facets with the shared mana-symbol vocabulary', () => {
    builder();
    for (const [name, token] of [
      ['White', 'W'],
      ['Blue', 'U'],
      ['Black', 'B'],
      ['Red', 'R'],
      ['Green', 'G'],
    ] as const) {
      const facet = screen.getByRole('button', { name }) as unknown as FacetLike;
      expect(facet.querySelector(`[data-symbol="{${token}}"]`), name).not.toBeNull();
    }
  });

  it('shows only the white cards left out of the deck when White is pressed', () => {
    const build = builder();
    const outside = build.pool
      .map((card, index) => ({ card, index }))
      .filter((entry) => !build.chosen.includes(entry.index));
    const white = distinct(outside.filter((entry) => colorFacetsOf(entry.card).includes('W')));
    expect(white, 'this pool has no white cards outside the deck to filter to').toBeGreaterThan(0);
    expect(faces(SEALED_POOL_LABEL)).toBe(distinct(outside));

    fireEvent.click(screen.getByRole('button', { name: 'White' }));
    expect(faces(SEALED_POOL_LABEL)).toBe(white);
  });

  it('leaves the deck pane whole, because a deck is a decision already made', () => {
    const build = builder();
    // Strips, not faces: since `mtg-pmpu.1` the deck pane draws one per copy,
    // so the number to compare against is the size of the deck rather than the
    // number of distinct cards in it.
    const before = copies(DECK_CARDS_LABEL);
    fireEvent.click(screen.getByRole('button', { name: 'White' }));
    expect(copies(DECK_CARDS_LABEL)).toBe(before);
    expect(before).toBe(build.chosen.length);
  });
});
