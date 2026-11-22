// @vitest-environment jsdom
/**
 * A sealed pool draws one face per card and writes the copies beside it.
 *
 * `mtg-aqxi.4`. Six packs hand a player three of the same common often enough
 * that a seventy-two card pool is rarely seventy-two faces, and the pool pane
 * was drawing every copy: three identical tiles in a row, each one a separate
 * thing to read past on a 390px column. `../../src/routes/deck/
 * ConstructedBuilder.ts` settled this shape for the other builder — one face,
 * the count written on it — and this is the same reading of the same question.
 *
 * Copies are still indexes underneath, because that is what a sealed build is:
 * `chosen` holds pool positions, not card ids. What a click moves is one copy,
 * the first the pane is showing, and copies of a card differ in nothing else.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { SealedBuilder, SEALED_POOL_LABEL } from '../../src/routes/play/SealedBuilder';
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

const SEED = 'lab/test/sealed-copies';

interface NodeLike {
  readonly textContent: string | null;
  readonly querySelectorAll: (selector: string) => readonly NodeLike[];
}

function pane(label: string): NodeLike {
  return screen.getByRole('group', { name: label }) as unknown as NodeLike;
}

function count(label: string, selector: string): number {
  return pane(label).querySelectorAll(selector).length;
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

describe('the sealed pool collapses duplicate copies', () => {
  it('draws one face per distinct card left out of the deck', () => {
    const build = builder();
    const outside = build.pool
      .map((card, index) => ({ card, index }))
      .filter((entry) => !build.chosen.includes(entry.index));
    const distinct = new Set(outside.map((entry) => entry.card.id)).size;
    expect(outside.length, 'this pool holds no duplicates to collapse').toBeGreaterThan(distinct);
    expect(count(SEALED_POOL_LABEL, '.mtg-card')).toBe(distinct);
  });

  it('writes the copy count on a card it is showing more than one of', () => {
    const build = builder();
    const outside = build.pool
      .map((card, index) => ({ card, index }))
      .filter((entry) => !build.chosen.includes(entry.index));
    const repeated = new Set(
      outside
        .map((entry) => entry.card.id)
        .filter((id, _index, all) => all.filter((other) => other === id).length > 1),
    ).size;
    expect(count(SEALED_POOL_LABEL, '.mtg-copies__count')).toBe(repeated);
  });
});
