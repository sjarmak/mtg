// @vitest-environment jsdom
/**
 * The draft's preview panel is full whenever the pointer is over the pack.
 *
 * `mtg-pklv`. The rail is 280px of a 1440px window and it used to hold two
 * lines of instruction until the first press, which is a fifth of the screen
 * spent on a sentence. Pointing at a face now reads it into the panel without
 * choosing it, so the panel earns its column while the pack is being read.
 *
 * The order is the claim: chosen, then pointed at, then empty. A pointer
 * crossing the pack on its way somewhere else must not take the panel off the
 * card that was deliberately chosen, and the commit button must keep naming
 * what it would actually take -- a preview that could change the pick would be
 * a hover with an irreversible consequence.
 *
 * Focus is asserted beside the pointer because a keyboard reaches a face by
 * tabbing to it and sends no pointer event at all: without that arm the panel
 * would be a mouse feature on a surface whose one action is a button.
 */
import { createElement as h } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { DraftPack } from '../../src/routes/draft/DraftPack';

afterEach(() => {
  cleanup();
  screenRoot = null;
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

/** No `lib: dom` in this workspace, so the shapes this file reaches for are spelled out. */
interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: ElementLike;
  };
}

const SET = loadSet();
/** Distinct cards, so a name in the panel names exactly one face in the pack. */
const PACK: readonly Card[] = SET.slice(0, 6);

const NEXT: HumanDraftChoice = {
  round: 1,
  pickNumber: 1,
  packSize: PACK.length,
  openedBy: 0,
  cards: PACK,
};

const DRAFT: HumanDraftProgress = {
  seed: 'draft-preview-hover',
  humanSeat: 0,
  picks: [],
  seats: [],
  rounds: 3,
  directions: [],
  ratings: [],
  botPolicy: 'native-deck-conditioned/v1',
  nextPick: NEXT,
  result: null,
};

let screenRoot: ElementLike | null = null;

function mount(): void {
  const { container } = render(
    h(DraftPack, {
      draft: DRAFT,
      next: NEXT,
      pool: [],
      onPick: (): void => undefined,
      onNewDraft: (): void => undefined,
    }),
  );
  screenRoot = (container as unknown as ElementLike).querySelector('.mtg-draft');
  if (screenRoot === null) throw new Error('the draft screen did not render');
}

function root(): ElementLike {
  if (screenRoot === null) throw new Error('nothing is mounted');
  return screenRoot;
}

/** The pack's faces, in the order the pack deals them. */
function packFaces(): readonly ElementLike[] {
  const found = root().querySelectorAll('.mtg-thumbs > .mtg-card');
  return Array.from({ length: found.length }, (_, index) => {
    const face = found[index];
    if (face === undefined) throw new Error('a pack face went missing');
    return face;
  });
}

function faceAt(index: number): ElementLike {
  const face = packFaces()[index];
  if (face === undefined) throw new Error(`the pack has no face ${String(index)}`);
  return face;
}

/** What the rail is showing: a card's accessible name, or `null` when it is empty. */
function previewed(): string | null {
  const card = root().querySelector('.mtg-rail__body > .mtg-card');
  return card === null ? null : card.getAttribute('aria-label');
}

function emptyLine(): string | null {
  const empty = root().querySelector('.mtg-rail__empty');
  return empty === null ? null : empty.textContent;
}

/** The commit button, which names the card a press would actually take. */
function commitLabel(): string {
  const foot = root().querySelector('.mtg-rail__foot > button');
  if (foot === null) throw new Error('the rail has no commit button');
  return foot.textContent ?? '';
}

function nameOf(index: number): string {
  const card = PACK[index];
  if (card === undefined) throw new Error(`the fixture has no card ${String(index)}`);
  return card.name;
}

describe('the draft preview follows the pointer until something is chosen', () => {
  it('fills the panel from a face the pointer rests on, and empties it on the way out', () => {
    mount();
    expect(previewed()).toBeNull();
    expect(emptyLine() ?? '').toContain('Point at a card in the pack');

    fireEvent.pointerEnter(faceAt(1) as unknown as Element);
    expect(previewed() ?? '').toContain(nameOf(1));
    // Reading is not choosing: the one irreversible action on the screen still
    // names nothing.
    expect(commitLabel()).toBe('Pick a card');

    fireEvent.pointerLeave(faceAt(1) as unknown as Element);
    expect(previewed()).toBeNull();
    expect(emptyLine() ?? '').toContain('Point at a card in the pack');
  });

  it('gives the keyboard the same panel through focus and blur', () => {
    mount();
    fireEvent.focus(faceAt(2) as unknown as Element);
    expect(previewed() ?? '').toContain(nameOf(2));
    fireEvent.blur(faceAt(2) as unknown as Element);
    expect(previewed()).toBeNull();
  });

  it('keeps a chosen card in the panel while the pointer crosses the rest of the pack', () => {
    mount();
    fireEvent.click(faceAt(0) as unknown as Element);
    expect(previewed() ?? '').toContain(nameOf(0));
    expect(commitLabel()).toBe(`Pick ${nameOf(0)}`);

    fireEvent.pointerEnter(faceAt(3) as unknown as Element);
    expect(previewed() ?? '').toContain(nameOf(0));
    expect(commitLabel()).toBe(`Pick ${nameOf(0)}`);

    // And leaving the face it crossed does not empty a panel a selection is
    // holding.
    fireEvent.pointerLeave(faceAt(3) as unknown as Element);
    expect(previewed() ?? '').toContain(nameOf(0));
  });

  it('does not empty the panel when focus moves from one face to another', () => {
    mount();
    fireEvent.pointerEnter(faceAt(4) as unknown as Element);
    // A click focuses the pressed face before the old one blurs, so an
    // unguarded clear would blank the panel on the way into a card.
    fireEvent.pointerEnter(faceAt(5) as unknown as Element);
    fireEvent.pointerLeave(faceAt(4) as unknown as Element);
    expect(previewed() ?? '').toContain(nameOf(5));
  });

  it('names the pack it is reading, so the screen still says where the draft is', () => {
    mount();
    expect(screen.getByText('Pack 1 · Pick 1')).toBeTruthy();
  });
});
