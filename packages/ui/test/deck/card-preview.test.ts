// @vitest-environment jsdom
/**
 * The floating card face: where it lands, and what puts it on screen.
 *
 * `mtg-nyeo`. The placement is arithmetic over three rectangles, so it is
 * checked as arithmetic; what needs a render is the wiring, which is that
 * pointing at a card in either pane draws the face and leaving it takes the face
 * away. That it costs no layout is the point of it being fixed and is asserted
 * by the absence of any permanent element, not by a measurement.
 *
 * No card name is written down: every subject is picked out of the committed
 * prototype set by shape, so this file stays a public document.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { CARD_TRIM_MM, FULL_FACE_WIDTH_REM, READING_FACE_WIDTH_REM } from '@mtg/card-geometry';
import {
  PREVIEW_GAP_PX,
  PREVIEW_WIDTH_REM,
  previewPlacement,
  previewSize,
} from '../../src/routes/deck/CardPreview';
import {
  ConstructedBuilder,
  CONSTRUCTED_POOL_LABEL,
  DECK_CARDS_LABEL,
  SEARCH_LABEL,
  addCopyLabel,
} from '../../src/routes/deck/ConstructedBuilder';
import { deckRowLabel } from '../../src/routes/deck/DeckListRows';
import { addCopy, deckFor, emptyBuild, selectable } from '../../src/routes/deck/build';
import type { ConstructedBuild } from '../../src/routes/deck/build';

afterEach(cleanup);
afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
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

function subject(at = 0): Card {
  const card = selectable(SET)[at];
  if (card === undefined) throw new Error('the prototype set has no selectable card');
  return card;
}

const DESK = { width: 1600, height: 1000 };

describe('where the preview lands', () => {
  const size = previewSize(16);

  it('is a whole card face, at the width a face is read at', () => {
    expect(PREVIEW_WIDTH_REM).toBe(READING_FACE_WIDTH_REM);
    expect(PREVIEW_WIDTH_REM).toBeGreaterThan(FULL_FACE_WIDTH_REM);
    expect(size.height / size.width).toBeCloseTo(CARD_TRIM_MM.height / CARD_TRIM_MM.width, 4);
  });

  it('sits to the right of the pointer when the window has room', () => {
    const at = previewPlacement({ left: 300, top: 500 }, DESK, size);
    expect(at.left).toBe(300 + PREVIEW_GAP_PX);
    // Centered on the pointer, which is what puts the middle of the card where
    // the reader is already looking.
    expect(at.top).toBeCloseTo(500 - size.height / 2, 4);
  });

  it('flips to the left rather than running off the right edge', () => {
    const at = previewPlacement({ left: DESK.width - 40, top: 500 }, DESK, size);
    expect(at.left + size.width).toBeLessThanOrEqual(DESK.width - 40);
    expect(at.left).toBeGreaterThanOrEqual(PREVIEW_GAP_PX);
  });

  it('never runs past the top or the bottom of the window', () => {
    for (const y of [0, 12, 500, DESK.height - 4, DESK.height]) {
      const at = previewPlacement({ left: 300, top: y }, DESK, size);
      expect(at.top, `pointer at y=${String(y)}`).toBeGreaterThanOrEqual(PREVIEW_GAP_PX);
      expect(at.top + size.height, `pointer at y=${String(y)}`).toBeLessThanOrEqual(DESK.height);
    }
  });

  /**
   * A window shorter than a card is a real state -- a landscape phone is 390px
   * tall against a 341px face at the default root size, and a scaled root makes
   * it likelier. The face is then cut, and it is cut at the bottom, where a
   * reader who wants the rest can point at something else.
   */
  it('clamps to the top on a window too short to hold a whole face', () => {
    const at = previewPlacement({ left: 100, top: 200 }, { width: 844, height: 200 }, size);
    expect(at.top).toBe(PREVIEW_GAP_PX);
  });
});

/** The rendered tree, so the floating face can be found without a global. */
interface Host {
  readonly querySelectorAll: (selector: string) => { readonly length: number };
  readonly querySelector: (
    selector: string,
  ) => { readonly getAttribute: (name: string) => string | null } | null;
}

let host: Host | null = null;

function builderWith(build: ConstructedBuild): void {
  const view = render(
    h(ConstructedBuilder, {
      build,
      deck: deckFor(build),
      onAdd: () => undefined,
      onCut: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onLoad: () => undefined,
      onPlay: () => undefined,
    }),
  );
  host = view.container as unknown as Host;
}

function rendered(): Host {
  if (host === null) throw new Error('nothing has been rendered');
  return host;
}

function peek(): { readonly length: number } {
  return rendered().querySelectorAll('.mtg-cardpeek');
}

describe('what puts the preview on screen', () => {
  it('draws nothing until something is pointed at', () => {
    builderWith(emptyBuild(SET));
    expect(peek().length).toBe(0);
  });

  /**
   * The anchor is the card's own right edge, never the pointer's x: a pointer
   * entering a face at its left would otherwise put a 244px preview on top of
   * the card it is describing.
   */
  it('draws the face while the pointer rests on a card in the collection', () => {
    builderWith(emptyBuild(SET));
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: subject().name } });
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    const face = within(pool).getAllByRole('button', { name: addCopyLabel(subject().name) })[0];
    if (face === undefined) throw new Error('the narrowed pool drew no face');
    const wrapper = (face as unknown as { closest: (selector: string) => Element | null }).closest(
      '.mtg-copies',
    );
    if (wrapper === null) throw new Error('the face has no copies wrapper');

    fireEvent.mouseEnter(wrapper, { clientX: 400, clientY: 300 });
    expect(peek().length).toBe(1);
    fireEvent.mouseLeave(wrapper);
    expect(peek().length).toBe(0);
  });

  /**
   * A click reads a card and outlines it; a second click on the same card does
   * not un-outline it. `mtg-d0y1`'s gesture is click, click, double click, and a
   * toggle would leave the reader with no outline at the end of playing a card.
   */
  it('keeps the collection outline on the card that was clicked', () => {
    builderWith(emptyBuild(SET));
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: subject().name } });
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    const step = within(pool).getAllByRole('button', { name: addCopyLabel(subject().name) })[0];
    if (step === undefined) throw new Error('the narrowed pool drew no face');
    const wrapper = (step as unknown as { closest: (selector: string) => Element | null }).closest(
      '.mtg-copies',
    );
    if (wrapper === null) throw new Error('the face has no copies wrapper');
    const face = within(wrapper as HTMLElement).getAllByRole('button', {
      name: new RegExp(subject().name, 'u'),
    })[0];
    if (face === undefined) throw new Error('the wrapper drew no face');

    fireEvent.click(face);
    fireEvent.click(face);
    expect(
      (wrapper as unknown as { getAttribute: (name: string) => string | null }).getAttribute('data-picked'),
    ).toBe('true');
  });

  it('draws it from a decklist row too, which carries less of a card than a face', () => {
    let build = emptyBuild(SET);
    build = addCopy(build, subject().id);
    builderWith(build);
    const row = within(screen.getByRole('group', { name: DECK_CARDS_LABEL })).getByRole('button', {
      name: deckRowLabel(subject(), 1),
    });

    fireEvent.mouseEnter(row, { clientX: 1200, clientY: 400 });
    expect(peek().length).toBe(1);
    fireEvent.mouseLeave(row);
    expect(peek().length).toBe(0);
  });

  /** The keyboard's own way of pointing: the row's box is the anchor. */
  it('draws it on focus and takes it away on blur', () => {
    let build = emptyBuild(SET);
    build = addCopy(build, subject().id);
    builderWith(build);
    const row = within(screen.getByRole('group', { name: DECK_CARDS_LABEL })).getByRole('button', {
      name: deckRowLabel(subject(), 1),
    });

    fireEvent.focus(row);
    expect(peek().length).toBe(1);
    fireEvent.blur(row);
    expect(peek().length).toBe(0);
  });

  /**
   * It says nothing to a screen reader. The element the pointer or the focus is
   * on already states the whole card (`../../src/card/Card.ts`), so announcing
   * the preview would read every card twice.
   */
  it('is hidden from the accessibility tree', () => {
    let build = emptyBuild(SET);
    build = addCopy(build, subject().id);
    builderWith(build);
    const row = within(screen.getByRole('group', { name: DECK_CARDS_LABEL })).getByRole('button', {
      name: deckRowLabel(subject(), 1),
    });
    fireEvent.focus(row);
    const shown = rendered().querySelector('.mtg-cardpeek');
    expect(shown?.getAttribute('aria-hidden')).toBe('true');
  });
});
