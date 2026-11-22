// @vitest-environment jsdom
/**
 * The Cards tab over every staged set rather than over the one on screen.
 *
 * `mtg-tewc.8`. The tab used to be handed one set's cards and said so in its own
 * docblock: "a picker offering all sets would be a control over a pool the route
 * does not have." The launcher stages every set it finds now
 * (`../src/lab/set-index.ts`), so the pool exists, and a person who types a word
 * into a card browser means every card the lab holds — not the ones belonging to
 * whichever build the header happens to name.
 *
 * Two facts are pinned here and they fail differently. The set filter is drawn
 * from the same grouped taxonomy every other set-aware surface uses, so a
 * heading it invents on its own is a regression this file catches. The search
 * spans the whole library, so a result that stops at the selected set is one
 * this file catches — and each face is painted by its *own* set's resolver,
 * because card ids are per-set and a shared one would draw the wrong picture.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { CARDS_CLEAR_LABEL, CARDS_SEARCH_LABEL, CARDS_SET_LABEL, CardsRoute } from '../src/routes/CardsRoute';
import type { CardsLibrary } from '../src/routes/CardsRoute';
import type { UiRoute } from '../src/app/router';

afterEach(cleanup);

/** The DOM this workspace can name: no `lib: dom`, so the shape is spelled out. */
interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
}

const el = (node: unknown): ElementLike => node as ElementLike;

const route = (params: Readonly<Record<string, string>> = {}): UiRoute => ({
  mode: 'cards',
  sub: 'gallery',
  params,
});

function bear(id: string, name: string, code: string): DslCard {
  return parseCard({
    id,
    name,
    kind: 'creature',
    rarity: 'common',
    set: { code, collectorNumber: 1 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    power: 2,
    toughness: 2,
  });
}

const XMP = [bear('xmp-direhorn', 'Silver Direhorn', 'XMP'), bear('xmp-grizzly', 'Grizzly Bears', 'XMP')];
const M11 = [bear('m11-bear', 'Runeclaw Bear', 'M11')];

const LIBRARY: CardsLibrary = {
  selected: 'flagship-set-253',
  sets: [
    { stem: 'flagship-set-253', name: 'the flagship set', origin: 'custom', cards: XMP },
    { stem: 'M11', name: 'Magic 2011', origin: 'official', cards: M11 },
  ],
};

function draw(params: Readonly<Record<string, string>> = {}, library: CardsLibrary = LIBRARY): void {
  render(
    h(CardsRoute, {
      cards: XMP,
      library,
      route: route(params),
      onSetParams: () => undefined,
    }),
  );
}

describe('CardsRoute, the set filter', () => {
  it('groups the staged sets the way every other set-aware surface does', () => {
    draw();
    const select = screen.getByLabelText(CARDS_SET_LABEL);
    const groups = within(select).getAllByRole('group');
    expect(groups.map((group) => el(group).getAttribute('label'))).toEqual(['Custom', 'Magic']);
    expect(within(select).getByRole('option', { name: 'the flagship set' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Magic 2011' })).toBeTruthy();
  });

  it('opens on the set the header is on rather than on the whole library', () => {
    draw();
    const select = screen.getByLabelText(CARDS_SET_LABEL) as unknown as { readonly value: string };
    expect(select.value).toBe('flagship-set-253');
    // Two printed cards and the five basics the set is played with: the gallery
    // browses a set's surfaces, which is what its art run covers.
    expect(el(screen.getByRole('status')).textContent).toBe('7 of 7 shown');
    expect(screen.queryByText('Runeclaw Bear')).toBeNull();
  });

  it('browses the whole library when asked for it outright', () => {
    draw({ set: 'all' });
    expect(screen.getByText('Runeclaw Bear')).toBeTruthy();
    expect(screen.getByText('Silver Direhorn')).toBeTruthy();
    // Three printed cards across two sets, and five basics for each of them.
    expect(el(screen.getByRole('status')).textContent).toBe('13 of 13 shown');
  });

  it('narrows the gallery to one set, by its stem rather than its code', () => {
    draw({ set: 'M11' });
    expect(screen.getByText('Runeclaw Bear')).toBeTruthy();
    expect(screen.queryByText('Silver Direhorn')).toBeNull();
    expect(el(screen.getByRole('status')).textContent).toBe('6 of 6 shown');
  });
});

describe('CardsRoute, search across the library', () => {
  it('finds a card in a set the header is not naming', () => {
    draw();
    fireEvent.change(screen.getByLabelText(CARDS_SEARCH_LABEL), { target: { value: 'runeclaw' } });
    expect(screen.getByText('Runeclaw Bear')).toBeTruthy();
    expect(screen.queryByText('Silver Direhorn')).toBeNull();
    // And says so over the gallery, because a search that quietly left the set
    // the header names is a set of results a person cannot account for.
    expect(screen.getByText('every staged set, 2 of them')).toBeTruthy();
  });

  it('keeps the search inside the set when one is chosen', () => {
    draw({ set: 'flagship-set-253' });
    fireEvent.change(screen.getByLabelText(CARDS_SEARCH_LABEL), { target: { value: 'bear' } });
    expect(screen.getByText('Grizzly Bears')).toBeTruthy();
    expect(screen.queryByText('Runeclaw Bear')).toBeNull();
  });

  it('counts the chosen set among the filters the clear control undoes', () => {
    draw({ set: 'M11' });
    expect(screen.getByRole('button', { name: CARDS_CLEAR_LABEL })).toBeTruthy();
  });
});

describe('CardsRoute, art across sets', () => {
  it('paints each card with its own set’s resolver', () => {
    const library: CardsLibrary = {
      selected: 'flagship-set-253',
      sets: [
        {
          ...LIBRARY.sets[0]!,
          artFor: (card) => ({ src: `xmp/${card.id}.png`, alt: 'flagship set art' }),
        },
        {
          ...LIBRARY.sets[1]!,
          artFor: (card) => ({ src: `m11/${card.id}.png`, alt: 'magic 2011 art' }),
        },
      ],
    };
    draw({ set: 'all' }, library);
    const sources = screen
      .getAllByRole('img')
      .map((image) => el(image).getAttribute('src'))
      .filter((src): src is string => src !== null);
    expect(sources).toContain('xmp/xmp-direhorn.png');
    expect(sources).toContain('m11/m11-bear.png');
  });
});
