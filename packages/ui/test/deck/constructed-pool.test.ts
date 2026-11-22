// @vitest-environment jsdom
/**
 * The Constructed pool is every staged set (`mtg-nwn1`).
 *
 * The builder's pool pane has always carried a set facet drawn only when the
 * pool names more than one code, and the pool it was handed was one set's card
 * list, so the row had never been drawn. The union is `set-index.ts`'s sets
 * rather than a second staged document listing the same cards.
 *
 * The union itself is a function and is checked as one; what the render checks
 * is the wire and the facet, which is the half a unit test of the function
 * cannot see.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseCard, tokenCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  POOL_COPIES_NOTE,
  constructedPool,
  deckSetOf,
  withMintedBasics,
} from '../../src/routes/deck/constructed-pool';
import { ConstructedGame } from '../../src/routes/deck/ConstructedGame';
import { DeckRoute } from '../../src/routes/DeckRoute';
import { BUILD_LABEL } from '../../src/routes/deck/DeckLibrary';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';

afterEach(cleanup);

let position = 0;

function card(set: string, id: string, name: string): Card {
  position += 1;
  return parseCard({
    id,
    name,
    rarity: 'common',
    set: { code: set, collectorNumber: position },
    colors: ['W'],
    supertypes: [],
    subtypes: ['Bear'],
    keywords: [],
    effects: [],
    abilities: [],
    power: 1,
    toughness: 1,
    kind: 'creature',
    manaCost: { generic: 0, W: 1, U: 0, B: 0, R: 0, G: 0 },
    artifact: false,
    oracleText: '',
  });
}

const FIRST = [card('AAA', 'aaa-1', 'First Bear'), card('AAA', 'aaa-2', 'First Snake')];
/** A card whose ability mints a token, so the union has a token surface to key. */
const MAKER: Card = parseCard({
  id: 'aaa-3',
  name: 'First Marshal',
  rarity: 'common',
  set: { code: 'AAA', collectorNumber: 3 },
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
  kind: 'creature',
  manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
  artifact: false,
  oracleText: '{1}{W}: Create a 1/1 colorless Soldier creature token.',
});

/** The card that token becomes, built the one way everything else builds it. */
const SOLDIER: Card = tokenCard({
  name: 'Vantan Soldier',
  power: 1,
  toughness: 1,
  subtypes: ['Soldier'],
  colors: [],
  keywords: [],
  abilities: [],
});

const SECOND = [card('BBB', 'bbb-1', 'Second Bear')];

describe('the union of the staged sets', () => {
  it('is one pool with every set in it, in the index order', () => {
    const pool = constructedPool([
      { name: 'First Set', cards: FIRST },
      { name: 'Second Set', cards: SECOND },
    ]);

    expect(pool.cards.map((entry) => entry.id)).toEqual(['aaa-1', 'aaa-2', 'bbb-1']);
    expect(pool.refused).toBe(0);
    expect(pool.note).toBe(`${POOL_COPIES_NOTE}, across 2 staged sets`);
  });

  it('reads exactly as it did for one staged set', () => {
    const pool = constructedPool([{ name: 'First Set', cards: FIRST }]);
    expect(pool.note).toBe(POOL_COPIES_NOTE);
    expect(pool.cards).toEqual(FIRST);
  });

  it('keeps the first set to print an id and says how many it left out', () => {
    // A card id is unique inside a set and nothing makes it unique across sets;
    // the builder counts copies by id, so a collision would be one card with two
    // faces and a four-of reached twice as fast.
    const pool = constructedPool([
      { name: 'First Set', cards: FIRST },
      { name: 'Second Set', cards: [card('BBB', 'aaa-1', 'Second Bear'), ...SECOND] },
    ]);

    expect(pool.cards.map((entry) => entry.name)).toEqual(['First Bear', 'First Snake', 'Second Bear']);
    expect(pool.refused).toBe(1);
    expect(pool.note).toContain('1 card is left out');
    expect(pool.note).toContain('counts copies by id');
  });
});

describe('which set a deck was cut from', () => {
  /** The two sets as the page hands them over, each shelved under its own group. */
  const BOTH = constructedPool([
    { name: 'First Set', cards: FIRST, origin: 'custom' },
    { name: 'Second Set', cards: SECOND, origin: 'official' },
  ]);

  it('is the set every chosen card came from', () => {
    expect(deckSetOf(BOTH.setOf, ['aaa-1', 'aaa-2'])).toEqual({
      name: 'First Set',
      origin: 'custom',
    });
    expect(deckSetOf(BOTH.setOf, ['bbb-1'])).toEqual({ name: 'Second Set', origin: 'official' });
  });

  it('is nothing at all when the cards came from two sets', () => {
    // Not the first one, and not the staged one: a deck of two sets is a deck
    // whose set is not known, and the library already draws that.
    expect(deckSetOf(BOTH.setOf, ['aaa-1', 'bbb-1'])).toBeNull();
  });

  it('is nothing for an empty deck, and for a card the pool does not hold', () => {
    expect(deckSetOf(BOTH.setOf, [])).toBeNull();
    expect(deckSetOf(BOTH.setOf, ['ccc-1'])).toBeNull();
  });

  it('leaves out a set that named no origin, rather than shelving it under a guess', () => {
    // A page opened on a flat set document has no index row behind it and so no
    // origin to give; a deck built there records no set, which is what is true.
    const flat = constructedPool([{ name: 'the staged set', cards: FIRST }]);
    expect(flat.setOf.size).toBe(0);
    expect(deckSetOf(flat.setOf, ['aaa-1'])).toBeNull();
  });
});

describe('the builder over a multi-set pool', () => {
  it('draws every set and the set facet the row was written for', () => {
    const pool = constructedPool([
      { name: 'First Set', cards: FIRST },
      { name: 'Second Set', cards: SECOND },
    ]);
    render(h(ConstructedGame, { pool: pool.cards, poolNote: pool.note }));

    expect(screen.getByText(`${POOL_COPIES_NOTE}, across 2 staged sets`)).toBeTruthy();
    // The facet row is drawn only when the pool names more than one code.
    expect(screen.getByRole('button', { name: /AAA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /BBB/ })).toBeTruthy();
  });

  it('keeps a started deck when the rest of the sets arrive', () => {
    // The sets are fetched one document at a time, so a builder opened first
    // holds the pool that existed then. Widening it must not clear the deck.
    const first = constructedPool([{ name: 'First Set', cards: FIRST }]);
    const both = constructedPool([
      { name: 'First Set', cards: FIRST },
      { name: 'Second Set', cards: SECOND },
    ]);
    const view = render(h(ConstructedGame, { pool: first.cards, poolNote: first.note }));

    const inPool = screen.getAllByRole('button', { name: /First Bear/ }).length;
    // The `+` under the face: a click in the collection reads a card and a
    // double click plays one (`mtg-d0y1`).
    fireEvent.click(screen.getByRole('button', { name: 'Play another First Bear' }));
    const played = screen.getAllByRole('button', { name: /First Bear/ }).length;
    expect(played).toBeGreaterThan(inPool);

    view.rerender(h(ConstructedGame, { pool: both.cards, poolNote: both.note }));

    expect(screen.getByRole('button', { name: /BBB/ })).toBeTruthy();
    // Still played, which is what re-seating is for: the deck pane draws the
    // card as well as the pool, so the face count stays where the click put it.
    expect(screen.getAllByRole('button', { name: /First Bear/ }).length).toBe(played);
  });

  it('draws no set facet over one staged set', () => {
    const pool = constructedPool([{ name: 'First Set', cards: FIRST }]);
    render(h(ConstructedGame, { pool: pool.cards, poolNote: pool.note }));

    expect(screen.getByText(POOL_COPIES_NOTE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /AAA/ })).toBeNull();
  });
});

describe('art over a pool the header set does not own', () => {
  /**
   * `mtg-pzpz`. The pool is the union of every staged set and the resolver the
   * builder was handed is the header set's one manifest, so with the picker on
   * Return to Ravnica the pool painted Azorius Guildgate and drew the labeled
   * pending frame on Arbor Elf, Serra Angel and every other card of the three
   * sets beside it. `CardsRoute` had already answered this for the gallery: a
   * card is painted by the set that owns it, never by the set the header is on.
   *
   * Per card id rather than per set object, because that is the key the pool
   * already refuses a collision on: the first set to print an id keeps the card,
   * so it keeps the picture too, and the two decisions cannot disagree.
   */
  const firstArt = (card: Card): { src: string; alt: string } | null => ({
    src: `first/${card.id}.png`,
    alt: card.name,
  });
  const secondArt = (card: Card): { src: string; alt: string } | null => ({
    src: `second/${card.id}.png`,
    alt: card.name,
  });

  it('paints each card with its own set', () => {
    const pool = constructedPool([
      { name: 'First Set', cards: FIRST, artFor: firstArt },
      { name: 'Second Set', cards: SECOND, artFor: secondArt },
    ]);
    const resolve = pool.artFor;
    expect(resolve).not.toBeNull();
    expect(resolve?.(FIRST[0] as Card)?.src).toBe('first/aaa-1.png');
    expect(resolve?.(SECOND[0] as Card)?.src).toBe('second/bbb-1.png');
  });

  it('is null when no staged set has art, and pending for a set that has none', () => {
    expect(constructedPool([{ name: 'First Set', cards: FIRST }]).artFor).toBeNull();
    const mixed = constructedPool([
      { name: 'First Set', cards: FIRST, artFor: firstArt },
      { name: 'Second Set', cards: SECOND },
    ]);
    expect(mixed.artFor?.(SECOND[0] as Card)).toBeNull();
  });

  it("paints a token its set creates, which is in no set's card list", () => {
    // A token is minted at run time and appears in no `set.json`, so keying the
    // union's art off the pool's cards alone left every token on every table
    // dealt from this resolver wearing the pending frame — while the same
    // permanent in the replay viewer, drawn by the set's own resolver, was
    // painted. the playtester found it on Alaric's Vantan Soldiers.
    const pool = constructedPool([
      { name: 'First Set', cards: [...FIRST, MAKER], artFor: firstArt },
      { name: 'Second Set', cards: SECOND, artFor: secondArt },
    ]);
    expect(pool.cards.map((entry) => entry.id)).not.toContain(SOLDIER.id);
    expect(pool.artFor?.(SOLDIER)?.src).toBe(`first/${SOLDIER.id}.png`);
  });

  it('keeps the picture with the card the collision kept', () => {
    // `bbb-1` printed twice: the first set keeps the card, so it keeps the art.
    const clash = card('BBB', 'aaa-1', 'Second Bear');
    const pool = constructedPool([
      { name: 'First Set', cards: FIRST, artFor: firstArt },
      { name: 'Second Set', cards: [clash], artFor: secondArt },
    ]);
    expect(pool.refused).toBe(1);
    expect(pool.artFor?.(FIRST[0] as Card)?.src).toBe('first/aaa-1.png');
  });
});

/** The workspace tsconfig has no `lib: dom`, so `getAttribute` is not typed here. */
interface Attributed {
  readonly getAttribute: (name: string) => string | null;
}

describe('the builder the route hands that art', () => {
  /**
   * The wire, which the function above cannot see. `DeckRoute` is what carries
   * the header set's resolver, and until `mtg-pzpz` that is what reached the
   * pool: this renders the two-set pool the lab stages and reads the `src` off
   * a face of the set the header is *not* on.
   */
  const artOf = (prefix: string) => (subject: Card) => ({
    src: `${prefix}/${subject.id}.png`,
    alt: subject.name,
  });

  function openTwoSets(): void {
    // Full cards, because a compact pane draws no art window at all: the
    // pending frame and the picture are both things only the full face has.
    localStorage.setItem(deckViewStoreKey('constructed-pool'), 'full');
    render(
      h(DeckRoute, {
        state: { status: 'absent' as const },
        cards: FIRST,
        artFor: artOf('header'),
        poolSets: [
          { name: 'First Set', cards: FIRST, artFor: artOf('first') },
          { name: 'Second Set', cards: SECOND, artFor: artOf('second') },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
  }

  it('paints a card of the set the header is not on', () => {
    openTwoSets();
    const shown = screen
      .getAllByRole('img')
      .map((node) => (node as unknown as Attributed).getAttribute('src'))
      .filter((src): src is string => src !== null);

    expect(shown).toContain('second/bbb-1.png');
    expect(shown).toContain('first/aaa-1.png');
    expect(shown.some((src) => src.startsWith('header/'))).toBe(false);
  });
});

describe('the basics a staged set is played with', () => {
  /**
   * `mtg-ac0h`. A set document prints no basic lands, so a union built from the
   * documents alone holds no `xmp-plains` and a deck that recorded one resolves
   * it to nothing — the mana base then mints its Plains out of the union, and
   * whichever set sorts first supplies it. This is the rule both unions need and
   * only one of them had.
   */
  it('mints each set its own five, under the ids the art manifest is keyed by', () => {
    const flagship = [card('XMP', 'xmp-1', 'Kingdom Scout')];
    const reference = [card('M11', 'm11-1', 'Runeclaw Bear')];

    const pool = constructedPool(
      withMintedBasics([
        { name: 'the flagship set', cards: flagship },
        { name: 'Magic 2011', cards: reference },
      ]),
    );
    const basics = pool.cards.filter((entry) => entry.kind === 'land').map((entry) => entry.id);

    expect(basics).toContain('xmp-plains');
    expect(basics).toContain('m11-plains');
    expect(basics).toHaveLength(10);
  });

  it('keeps a set’s own printing rather than minting a second one beside it', () => {
    const printed = parseCard({
      kind: 'land',
      id: 'm11-230',
      name: 'Plains',
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 230 },
      supertypes: ['basic'],
      basicLandType: 'Plains',
      producesMana: ['W'],
    });
    const [set] = withMintedBasics([{ name: 'Magic 2011', cards: [card('M11', 'm11-1', 'Bear'), printed] }]);
    const plains = (set?.cards ?? []).filter(
      (entry) => entry.kind === 'land' && entry.basicLandType === 'Plains',
    );

    expect(plains.map((entry) => entry.id)).toStrictEqual(['m11-230']);
  });
});
