// @vitest-environment jsdom
/**
 * A builder spends its window on cards, not on sentences about cards.
 *
 * `mtg-i195`. Above the panes the sealed screen carried a counts bar, a
 * paragraph naming the pool ("Six packs, one deck to build.") and, inside the
 * deck pane, a line explaining the gesture ("Click a copy to select it, then
 * return it to the pool."). Both are read once and then scrolled past on every
 * pick after that, on the screen whose whole activity is moving cards between
 * two panes.
 *
 * The note is not deleted -- it moves into the Game details disclosure the
 * seed already lives in, which is where this project puts a fact you go looking
 * for rather than one you work from. The gesture line is deleted: the selection
 * bar that appears on a click names the move in a button, so the sentence was
 * describing a control that describes itself.
 *
 * What this file holds is that the note is still reachable and the paragraphs
 * are gone. What the panes then do with the room is
 * `../deck/builder-workbench.browser.test.ts`'s.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DECK_LABEL, SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor, openSealed } from '../../src/routes/play/sealed';
import { GAME_DETAILS_LABEL, GAME_SETUP_LABEL } from '../../src/routes/game-details';

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

const SEED = 'lab/test/builder-chrome';
const NOTE = 'Six packs, one deck to build.';

/** No `lib: dom` in this workspace, so the shapes this file reaches for are spelled out. */
interface NodeLike {
  readonly textContent: string | null;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: NodeLike;
  };
}

function builder(): NodeLike {
  const build = openSealed(loadSet(), SEED);
  const { container } = render(
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
      source: 'sealed' as const,
    }),
  );
  return container as unknown as NodeLike;
}

function texts(root: NodeLike, selector: string): readonly string[] {
  const found = root.querySelectorAll(selector);
  return Array.from({ length: found.length }, (_, index) => found[index]?.textContent ?? '');
}

describe('the builder keeps its prose out of the workspace', () => {
  it('draws no paragraph above the panes carrying the pool note', () => {
    const root = builder();
    const above = root.querySelector('.mtg-builder__above');
    expect(above, 'the builder drew no box above its panes').not.toBeNull();
    expect(texts(above as NodeLike, 'p')).not.toContain(NOTE);
  });

  it('keeps the note reachable under Game details, beside the seed', () => {
    const root = builder();
    const details = root.querySelector('details.mtg-gamedetails');
    expect(details, 'the builder drew no Game details disclosure').not.toBeNull();
    const disclosure = details as NodeLike;
    expect(disclosure.textContent ?? '').toContain(GAME_DETAILS_LABEL);
    expect(texts(disclosure, 'dt')).toContain(GAME_SETUP_LABEL);
    expect(texts(disclosure, 'dd')).toContain(NOTE);
    // The seed it was folded in beside is still there: this moved a fact into
    // the disclosure rather than swapping one for another.
    expect(texts(disclosure, 'dd')).toContain(SEED);
  });

  it('leaves the gesture to the control that performs it', () => {
    const root = builder();
    expect(root.textContent ?? '').not.toContain('Click a copy to select it');
    expect(root.textContent ?? '').not.toContain('Click a card to cut it');
    // And the deck pane still says what it is, so nothing lost a label with
    // the line.
    expect(texts(root, '.mtg-deck__pane-title')).toContain(DECK_LABEL);
  });
});
