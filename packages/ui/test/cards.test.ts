// @vitest-environment jsdom
/**
 * The Cards tab as a review surface.
 *
 * `routes.test.ts` pins what the three default views do with their URL: filter,
 * count, write back. This file is the other half — what the gallery says to a
 * person judging a generated set in it, and what it says to one who is not
 * looking at the screen.
 *
 * Measured in chrome-headless-shell 151.0.7922.34 at 1440x900 against the
 * committed `tideglass-reach` fixture, 90 cards with 12 of them in the art
 * manifest: five faces per row, every face 341px tall whether its art resolved
 * or not, page scroll height 6628 against a viewport of 900. So the gallery
 * scrolls rather than clipping, a partial manifest leaves the rows aligned, and
 * an activated ability's rules text is drawn in full — a Fuse card measured
 * 374px against its row-mates' 341, with `scrollHeight` equal to `clientHeight`
 * in its rules box. At 900px wide the row holds three faces and the document
 * does not scroll sideways. Those numbers are not asserted here, because jsdom
 * performs no layout; the route-level facts underneath them are.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS, parseCard, setBasics, setTokenCards } from '@mtg/dsl';
import {
  CARDS_CLEAR_LABEL,
  CARDS_FILTERS_LABEL,
  CARDS_LOADING_TITLE,
  CARDS_SEARCH_LABEL,
  CARDS_UNREADABLE_TITLE,
  CardsRoute,
} from '../src/routes/CardsRoute';
import { cardManaValue } from '../src/routes/deck/build';
import { ART_PENDING_LABEL } from '../src/card/ArtSlot';
import { cardColorIdentity } from '../src/card/identity';
import type { UiRoute } from '../src/app/router';

afterEach(cleanup);

/** The DOM this workspace can name: no `lib: dom`, so the shape is spelled out. */
interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly textContent: string | null;
  // The workspace tsconfig has no `lib: dom`, so an attribute is read through a
  // stated shape the way `./card.test.ts` reads one.
  readonly getAttribute: (name: string) => string | null;
}

const route = (params: Readonly<Record<string, string>> = {}): UiRoute => ({
  mode: 'cards',
  sub: 'gallery',
  params,
});

/**
 * the flagship set's first named mechanic, as a printed card. Not one of
 * `EXAMPLE_CARDS`' seventeen carries an ability, so the tab a generated set's
 * rules text is judged in had never been rendered against one.
 */
const TROPHY_HORN = parseCard({
  id: 'xmp-trophy-horn',
  name: 'Silver Direhorn Trophy Horn',
  kind: 'artifact',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 900 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

describe('CardsRoute, empty', () => {
  // An empty gallery has two causes, and they want opposite things from the
  // reader. The route told both of them to widen a filter, which is advice
  // nobody can take when no filter is set: Any/Any/All produces the whole set,
  // so a route rendering nothing under it was handed nothing.
  it('says it was handed no cards rather than blaming the filters', () => {
    render(h(CardsRoute, { cards: [], route: route(), onSetParams: () => undefined }));
    expect(screen.queryByText('No cards match these filters')).toBeNull();
    expect(screen.getByText('No set loaded')).toBeTruthy();
    expect(screen.getByText(/npm run play/)).toBeTruthy();
  });

  it('still blames the filters when the set has cards and the filters hid them', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS.filter((card) => cardColorIdentity(card) === 'r'),
        route: route({ identity: 'u' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText('No cards match these filters')).toBeTruthy();
    expect(screen.queryByText('No set loaded')).toBeNull();
  });
});

describe('CardsRoute, announced', () => {
  // Every filter on this page is a control whose only effect is elsewhere on the
  // page: the count line, and the gallery under it. A pointer follows that
  // because it is already looking at the gallery. Nothing else did — the count
  // was a plain span, so pressing Blue changed the screen and said nothing.
  it('reports the count where a filter change is announced', () => {
    const total = String(EXAMPLE_CARDS.length);
    const { rerender } = render(
      h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }),
    );
    expect(within(screen.getByRole('status')).getByText(`${total} of ${total} shown`)).toBeTruthy();

    const reds = EXAMPLE_CARDS.filter((card) => cardColorIdentity(card) === 'r');
    expect(reds.length).toBeGreaterThan(0);
    rerender(
      h(CardsRoute, { cards: EXAMPLE_CARDS, route: route({ identity: 'r' }), onSetParams: () => undefined }),
    );
    expect(
      within(screen.getByRole('status')).getByText(`${String(reds.length)} of ${total} shown`),
    ).toBeTruthy();
  });

  // The two rows of toggles are mutually exclusive choices, and the word saying
  // which choice each row makes — "Identity", "Size" — was a decorative span
  // beside them. Read aloud, the page was ten pressed and unpressed buttons in a
  // line with nothing saying what any of them narrowed.
  it('names the identity row as one group', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    const group = screen.getByRole('group', { name: 'Identity' });
    const names = ['All', 'White', 'Blue', 'Black', 'Red', 'Green', 'Colorless', 'Multicolor'];
    expect(within(group).getAllByRole('button')).toHaveLength(names.length);
    for (const name of names) expect(within(group).getByRole('button', { name })).toBeTruthy();
  });

  it('names the size row as one group', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    const group = screen.getByRole('group', { name: 'Size' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    for (const name of ['Full', 'Compact']) {
      expect(within(group).getByRole('button', { name })).toBeTruthy();
    }
  });
});

describe('CardsRoute, whose cards these are', () => {
  // `mtg-ihtz`. The heading said "Cards" over whatever list it was handed, so
  // the example cards and a 249-card generated set were the same page with
  // different pictures on it. A reviewer scrolling a gallery is judging a set,
  // and the set is the one fact the page never carried.
  it('names the staged set over the gallery', () => {
    render(
      h(CardsRoute, {
        cards: [TROPHY_HORN],
        route: route(),
        onSetParams: () => undefined,
        source: { status: 'ready', name: 'the flagship set' },
      }),
    );
    expect(screen.getByText('the flagship set')).toBeTruthy();
    expect(screen.getByText('Silver Direhorn Trophy Horn')).toBeTruthy();
  });

  it('says the cards are the DSL examples when no set is staged', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route(),
        onSetParams: () => undefined,
        source: { status: 'absent' },
      }),
    );
    expect(screen.getByText(/DSL example cards/)).toBeTruthy();
    // Still a gallery: the stand-in pool is real and worth looking at, the way
    // the Play tab deals it and says so.
    expect(screen.getAllByText(ART_PENDING_LABEL)).toHaveLength(EXAMPLE_CARDS.length);
  });

  it('draws no gallery while the staged set is still on its way', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route(),
        onSetParams: () => undefined,
        source: { status: 'loading' },
      }),
    );
    expect(screen.getByText(CARDS_LOADING_TITLE)).toBeTruthy();
    expect(screen.queryAllByText(ART_PENDING_LABEL)).toHaveLength(0);
  });

  it('draws no gallery over a staged set it could not read, and carries the reason', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route(),
        onSetParams: () => undefined,
        source: { status: 'failed', message: 'set.json could not be read: bad card at 3' },
      }),
    );
    expect(screen.getByText(CARDS_UNREADABLE_TITLE)).toBeTruthy();
    expect(screen.getByText(/bad card at 3/)).toBeTruthy();
    expect(screen.queryAllByText(ART_PENDING_LABEL)).toHaveLength(0);
  });

  // The tools render this route over a card list they assembled themselves
  // (`tools/text-box.ts`, `tools/face-census.ts`), and there is no set behind
  // it to name. Those callers get the gallery they always got.
  it('draws the plain gallery for a caller that names no source', () => {
    render(h(CardsRoute, { cards: [TROPHY_HORN], route: route(), onSetParams: () => undefined }));
    expect(screen.getByText('1 of 1 shown')).toBeTruthy();
    expect(screen.queryByText(CARDS_LOADING_TITLE)).toBeNull();
  });
});

describe('CardsRoute, the review surface', () => {
  // The tab a generated set's rules text is read in, rendering the first thing
  // the flagship set needs it to.
  it('prints an activated ability in full on the face', () => {
    const view = render(
      h(CardsRoute, { cards: [TROPHY_HORN], route: route(), onSetParams: () => undefined }),
    );
    // Read off the rendered text rather than through a text query: the `{1}` is
    // painted as a symbol now (`card/SymbolText.ts`), so the line is several
    // nodes and Testing Library compares a node's direct text children. The
    // token is still there, which is the assertion worth making.
    const printed = (view.container as unknown as { readonly textContent: string | null }).textContent ?? '';
    expect(printed).toContain(
      '{1}, Sacrifice Silver Direhorn Trophy Horn: Put a horn counter on target creature. ' +
        '(A creature with a horn counter gets +1/+1 and has first strike.)',
    );
  });

  // A pending frame not labeled with the card it is pending *for* is a gray box,
  // and a screenshot of a set part-way through its art run stops describing
  // itself. `ArtSlot` writes whatever subject it is handed; this is the test
  // that the gallery hands it the card's own id.
  it('labels every pending frame with the card it is waiting on', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    expect(screen.getAllByText(ART_PENDING_LABEL)).toHaveLength(EXAMPLE_CARDS.length);
    for (const card of EXAMPLE_CARDS) {
      expect(screen.getByLabelText(`${ART_PENDING_LABEL} for ${card.id}`)).toBeTruthy();
    }
  });
});

describe('CardsRoute, the surfaces a set is played with', () => {
  /**
   * A set's art run covers its cards, the tokens its cards create and the five
   * basics it is played with — the art pipeline's `artSurfaces` is that walk — and the
   * gallery drew only the first of the three. So 33 of the flagship's 405
   * illustrations could be seen only if a game happened to mint one, which is
   * how the playtester came to ask for token art that had already been bought.
   *
   * Minted through `setTokenCards` and `setBasics`, which are the functions the
   * manifest is keyed by, so the id the gallery asks for and the id the picture
   * is filed under are one derivation rather than two.
   */
  const MAKER = parseCard({
    id: 'xmp-marshal',
    name: 'Field Marshal',
    kind: 'creature',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
    colors: ['W'],
    supertypes: [],
    subtypes: ['Soldier'],
    keywords: [],
    effects: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 1, W: 1 } },
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Vantan Soldier', power: 1, toughness: 1, subtypes: ['Soldier'] },
          },
        ],
      },
    ],
    power: 2,
    toughness: 2,
    artifact: false,
    oracleText: '{1}{W}: Create a 1/1 colorless Soldier creature token.',
  });

  it('draws the tokens its cards create, and the basics it is played with', () => {
    render(
      h(CardsRoute, {
        cards: [MAKER],
        library: {
          selected: 'xmp',
          sets: [{ stem: 'xmp', name: 'the flagship set', origin: 'custom', cards: [MAKER] }],
        },
        route: route(),
        onSetParams: () => {},
      }),
    );
    expect(screen.getByText('Field Marshal')).toBeTruthy();
    expect(screen.getByText('Vantan Soldier')).toBeTruthy();
    expect(screen.getByText('Plains')).toBeTruthy();
    // One card, one token and the five basics it is played with.
    expect(setTokenCards([MAKER])).toHaveLength(1);
    expect(setBasics([MAKER])).toHaveLength(5);
    expect((screen.getByRole('status') as unknown as ElementLike).textContent).toBe('7 of 7 shown');
  });
});

describe('CardsRoute, the filter bank behind one control', () => {
  // `mtg-dcxg.9`. On a phone the bar is five rows of 44px controls and 321.6px
  // of the route ran above the first card, so the bank is collapsible. What is
  // testable without layout is the state the two CSS rules key on: the toggle
  // says whether the bank is open, names the bank it opens, and the bank
  // carries the same answer as an attribute.
  it('opens and shuts the bank, and says how many filters are on', () => {
    const view = render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ rarity: 'common', mv: '3' }),
        onSetParams: () => undefined,
      }),
    );
    const container = view.container as unknown as ElementLike;
    const toggle = screen.getByRole('button', { name: `${CARDS_FILTERS_LABEL} (2)` });
    const bank = container.querySelector('.mtg-cardbar__bank');
    expect(bank).not.toBeNull();
    const element = bank as ElementLike;
    const spoken = toggle as unknown as ElementLike;
    expect(spoken.getAttribute('aria-controls')).toBe(element.getAttribute('id'));
    expect(spoken.getAttribute('aria-expanded')).toBe('false');
    expect(element.getAttribute('data-open')).toBe('false');

    // Shut is a state of the sheet, not of the DOM: every control is still
    // there, which is what lets one stylesheet decide whether it is drawn.
    expect(within(bank as unknown as HTMLElement).getByRole('group', { name: 'Identity' })).toBeTruthy();

    fireEvent.click(toggle);
    expect(spoken.getAttribute('aria-expanded')).toBe('true');
    expect(element.getAttribute('data-open')).toBe('true');
  });

  it('counts no filters when none are on', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    expect(screen.getByRole('button', { name: CARDS_FILTERS_LABEL })).toBeTruthy();
  });
});

describe('CardsRoute, one bar', () => {
  // Requirement 9 of the interface pass, and the reason it is one: identity sat
  // in a row of its own above a second row holding the selects, so a page whose
  // whole interaction is narrowing a gallery drew four labeled blocks between
  // the heading and the first card.
  it('holds every filter, the search and the size in the same bar', () => {
    const view = render(
      h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }),
    );
    const bar = (view.container as unknown as ElementLike).querySelector('.mtg-cardbar');
    expect(bar).not.toBeNull();
    const inside = within(bar as unknown as HTMLElement);
    expect(inside.getByRole('searchbox', { name: CARDS_SEARCH_LABEL })).toBeTruthy();
    expect(inside.getByRole('group', { name: 'Identity' })).toBeTruthy();
    expect(inside.getByRole('group', { name: 'Size' })).toBeTruthy();
    for (const label of ['Type', 'Rarity', 'Mana value']) {
      expect(inside.getByRole('combobox', { name: label })).toBeTruthy();
    }
  });

  // The identity buttons draw the pip and the letter rather than the spelled
  // color, which is what fits seven of them on a line beside everything else.
  // Their spoken names do not change, because "W" is not a color anybody says.
  it('speaks the color it draws as a pip', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    const white = screen.getByRole('button', { name: 'White' });
    expect((white as unknown as ElementLike).textContent).toBe('W');
  });
});

describe('CardsRoute, search', () => {
  // The page had no search at all: finding one card in a 249-card set meant
  // scrolling it. The box reads the same haystack the deck builder's pool
  // search reads -- name, type line and rules text -- so the same word finds the
  // same cards on both pages.
  it('narrows the gallery to the cards that carry the word', () => {
    render(
      h(CardsRoute, {
        cards: [TROPHY_HORN, ...EXAMPLE_CARDS],
        route: route(),
        onSetParams: () => undefined,
      }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: CARDS_SEARCH_LABEL }), {
      target: { value: 'direhorn' },
    });
    expect(screen.getByText(`1 of ${String(EXAMPLE_CARDS.length + 1)} shown`)).toBeTruthy();
    expect(screen.getByText('Silver Direhorn Trophy Horn')).toBeTruthy();
  });

  it('matches rules text, not only the name', () => {
    render(
      h(CardsRoute, {
        cards: [TROPHY_HORN, ...EXAMPLE_CARDS],
        route: route(),
        onSetParams: () => undefined,
      }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: CARDS_SEARCH_LABEL }), {
      target: { value: 'horn counter' },
    });
    expect(screen.getByText(`1 of ${String(EXAMPLE_CARDS.length + 1)} shown`)).toBeTruthy();
  });

  // The search is component state and the filters are URL parameters, so the
  // one control that clears everything has to do both. It appears only when
  // something is narrowed, because a clear button over an unfiltered set is a
  // button that does nothing.
  it('clears the typed word and the parameters together', () => {
    const written: Record<string, string>[] = [];
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ identity: 'r' }),
        onSetParams: (params) => {
          written.push({ ...params });
        },
      }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: CARDS_SEARCH_LABEL }), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText(`0 of ${String(EXAMPLE_CARDS.length)} shown`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: CARDS_CLEAR_LABEL }));
    expect(written).toEqual([{ identity: '', rarity: '', type: '', mv: '', set: '' }]);
    // The parameters are the caller's to clear -- this route asked and the URL
    // is what answers -- while the typed word is this route's own, and the box
    // is empty without waiting for anybody.
    expect(
      (screen.getByRole('searchbox', { name: CARDS_SEARCH_LABEL }) as unknown as { value: string }).value,
    ).toBe('');
  });

  it('offers nothing to clear over an unnarrowed set', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    expect(screen.queryByRole('button', { name: CARDS_CLEAR_LABEL })).toBeNull();
  });
});

describe('CardsRoute, mana value', () => {
  it('filters to one rung of the curve', () => {
    const ones = EXAMPLE_CARDS.filter((card) => cardManaValue(card) === 1);
    expect(ones.length).toBeGreaterThan(0);
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route({ mv: '1' }), onSetParams: () => undefined }));
    expect(screen.getByText(`${String(ones.length)} of ${String(EXAMPLE_CARDS.length)} shown`)).toBeTruthy();
  });

  // The top band is a floor rather than a value, because a set prints few cards
  // there and nobody asking for them means exactly six.
  it('reads the top band as six and up', () => {
    const big = EXAMPLE_CARDS.filter((card) => cardManaValue(card) >= 6);
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route({ mv: '6+' }), onSetParams: () => undefined }));
    expect(screen.getByText(`${String(big.length)} of ${String(EXAMPLE_CARDS.length)} shown`)).toBeTruthy();
  });
});
