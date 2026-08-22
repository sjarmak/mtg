// @vitest-environment jsdom
/**
 * The graveyard as a click-to-open browser rather than a standing list.
 *
 * `mtg-bc2.138`. Arena spends no board space on the graveyard: it opens into an
 * examinable browser on click, the browser scrolls, and its order is a defined
 * contract rather than whatever the zone array happened to be
 * (`docs/research/prior-art-board-layout.md`, Arena addendum; Patch Notes
 * 2022.13 is the ordering fix). These tests pin the four properties a person
 * checks by hand — it starts closed, one click opens it, it lists every card in
 * one stated order, and pointing at a card shows the whole card — plus the two
 * a person cannot check by hand and a keyboard user pays for when they are
 * missing: the same reveal on focus, and an accessible name on the face it
 * reveals.
 *
 * jsdom performs no layout, so nothing here measures the panel. What can be
 * asserted honestly is the markup, the focus, and the emitted rule; where the
 * property is a cascade property the test reads the rule and says so.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card as DslCard } from '@mtg/dsl';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Graveyard } from '../src/board/Graveyard';
import { faceAccessibleName, faceDetailText } from '../src/card/Card';
import { uiStyleSheet } from '../src/styles/index';

afterEach(cleanup);

const CSS = uiStyleSheet();

/** The kernel's graveyard array is oldest-first, and so is this. */
function pile(count: number): readonly { readonly key: string; readonly card: DslCard }[] {
  return EXAMPLE_CARDS.slice(0, count).map((card, index) => ({ key: `g${String(index)}`, card }));
}

/** Oldest-first in, newest-first out: the order the browser must draw. */
function newestFirst(count: number): readonly string[] {
  return [...pile(count)].reverse().map((entry) => entry.card.name);
}

interface NodeListLike {
  readonly length: number;
  readonly item: (index: number) => ElementLike | null;
}

interface ElementLike {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly hasAttribute: (name: string) => boolean;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => NodeListLike;
  readonly focus: () => void;
}

interface DocumentLike {
  readonly activeElement: unknown;
}

/**
 * What testing-library hands back, narrowed to the members these tests use and
 * checked at runtime. The workspace tsconfig has no `lib: dom`, so `HTMLElement`
 * carries none of them; `board.test.ts` and `theme.test.ts` declare their own
 * shapes for the same reason.
 */
function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.getAttribute !== 'function' ||
    typeof candidate.hasAttribute !== 'function' ||
    typeof candidate.querySelector !== 'function' ||
    typeof candidate.querySelectorAll !== 'function' ||
    typeof candidate.focus !== 'function' ||
    typeof candidate.tagName !== 'string'
  ) {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function documentLike(): DocumentLike {
  const candidate = (globalThis as { readonly document?: DocumentLike }).document;
  if (candidate === undefined) throw new Error('this test needs a jsdom window');
  return candidate;
}

function toggle(label: string): ElementLike {
  return asElement(screen.getByRole('button', { name: label }));
}

/** The card buttons inside the open panel, in the order they are drawn. */
function entries(): readonly ElementLike[] {
  return within(screen.getByRole('list'))
    .getAllByRole('button')
    .map((found) => asElement(found));
}

function attribute(element: ElementLike, name: string): string | null {
  return element.getAttribute(name);
}

function nodes(list: NodeListLike): readonly ElementLike[] {
  const found: ElementLike[] = [];
  for (let index = 0; index < list.length; index += 1) found.push(asElement(list.item(index)));
  return found;
}

describe('the graveyard browser opens and closes', () => {
  it('starts closed, with the count and nothing else', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(6) }));
    const head = toggle('Your graveyard, 6 cards');
    expect(attribute(head, 'aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('opens on one click and closes on the next', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(6) }));
    const head = toggle('Your graveyard, 6 cards');
    fireEvent.click(head);
    expect(attribute(head, 'aria-expanded')).toBe('true');
    expect(entries()).toHaveLength(6);
    fireEvent.click(head);
    expect(attribute(head, 'aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('points the toggle at the panel it opens', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(3) }));
    const head = toggle('Your graveyard, 3 cards');
    fireEvent.click(head);
    const panel = asElement(screen.getByRole('list'));
    expect(attribute(head, 'aria-controls')).toBe(panel.getAttribute('id'));
    expect(panel.getAttribute('id')).toBeTruthy();
  });

  it('counts one card as one card', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(1) }));
    expect(toggle('Your graveyard, 1 card')).toBeTruthy();
  });

  it('offers nothing to open when the zone is empty', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: [] }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('graveyard is empty')).toBeTruthy();
    expect(screen.getByLabelText('Your graveyard')).toBeTruthy();
  });

  /**
   * A closed browser costs one tab stop, not one per card. That is the whole
   * reason collapsed is the default state rather than a preference: a thirty-
   * card graveyard drawn open puts thirty stops between a keyboard user and
   * the next thing on the rail.
   */
  it('costs one tab stop closed and one per card open', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(6) }));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(toggle('Your graveyard, 6 cards'));
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });
});

describe('the sort contract', () => {
  /**
   * Newest first, in both places the zone is drawn. The kernel's array is
   * oldest-first and what a player wants at a glance is what just died, so the
   * browser reverses it once and the collapsed strip names the same first
   * entry. Patch Notes 2022.13 is the whole argument for stating it: Arena had
   * one browser going old to new, another new to old and a third random, and
   * the fix was a single order rather than a better default.
   */
  it('lists newest first', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(6) }));
    fireEvent.click(toggle('Your graveyard, 6 cards'));
    expect(entries().map((entry) => entry.textContent)).toEqual(
      newestFirst(6).map((name) => expect.stringContaining(name)),
    );
  });

  it('names the newest card while closed, and names it first when open', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(6) }));
    const newest = newestFirst(6)[0] ?? '';
    expect(newest).not.toBe('');
    expect(toggle('Your graveyard, 6 cards').textContent).toContain(newest);
    fireEvent.click(toggle('Your graveyard, 6 cards'));
    expect(entries()[0]?.textContent).toContain(newest);
  });
});

describe('a card in the browser can be examined', () => {
  it('is a button a keyboard can land on, named the way a card is read aloud', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(4) }));
    fireEvent.click(toggle('Your graveyard, 4 cards'));
    const drawn = entries();
    const expected = [...pile(4)].reverse();
    for (const [index, entry] of drawn.entries()) {
      const card = expected[index]?.card;
      expect(card).toBeTruthy();
      if (card === undefined) continue;
      expect(entry.tagName).toBe('BUTTON');
      expect(entry.hasAttribute('disabled')).toBe(false);
      expect(attribute(entry, 'aria-label')).toBe(faceAccessibleName(card));
      expect(attribute(entry, 'title')).toBe(faceDetailText(card));
      entry.focus();
      expect(documentLike().activeElement).toBe(entry);
    }
  });

  /**
   * The revealed face is the same full card the battlefield hover draws, and it
   * is `aria-hidden` for the same reason it is there: the button beside it
   * already carries the card's name and its detail text, so a screen reader
   * that read the panel too would read every card twice.
   */
  it('draws the whole card beside each entry, out of the accessibility tree', () => {
    render(h(Graveyard, { label: 'Your graveyard', cards: pile(2) }));
    fireEvent.click(toggle('Your graveyard, 2 cards'));
    const rows = nodes(asElement(screen.getByRole('list')).querySelectorAll('.mtg-browser__row'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // A child of the row and a sibling of the button, never a child of it:
      // an interactive element inside another is the defect
      // `../src/board/CardSlot.ts` records.
      const zoom = row.querySelector(':scope > .mtg-zoom');
      expect(zoom).not.toBeNull();
      expect(zoom?.getAttribute('aria-hidden')).toBe('true');
      expect(row.querySelector('.mtg-browser__card .mtg-zoom')).toBeNull();
      expect(zoom?.querySelector('.mtg-card[data-size="full"]')).not.toBeNull();
    }
  });

  /**
   * The reveal is the battlefield's mechanism rather than a second one: the
   * same `.mtg-zoom` panel, the same fixed placement, and the same pair of
   * triggers. `:focus-within` is the half a keyboard uses and a hover-only
   * affordance never has. jsdom evaluates neither pseudo-class, so this reads
   * the emitted rule.
   */
  it('reveals on focus as well as on hover', () => {
    expect(CSS).toContain('.mtg-browser__row:hover > .mtg-zoom');
    expect(CSS).toContain('.mtg-browser__row:focus-within > .mtg-zoom');
  });

  it('scrolls the panel rather than letting it grow', () => {
    const found = CSS.match(/\.mtg-browser__list\s*\{[^}]*\}/);
    expect(found).not.toBeNull();
    expect(found?.[0]).toContain('overflow-y: auto');
    expect(found?.[0]).toContain('min-height: 0');
  });
});
