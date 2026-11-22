// @vitest-environment jsdom
/**
 * A deck the workbench built, picked from the Play tab beside the written ones.
 *
 * The playtester, 2026-09-01: *"I just want to be able to do a selectable deck like
 * from the play tab the same way we can easily play a paired game of sky
 * islands vs down in the gloom, where it's either against a bot or on the LAN"*,
 * and in the same breath *"we need to make sure the art is available."*
 *
 * Both are one change. The picker was `PreconDeck`-shaped end to end, so a deck
 * that was not in the set's written file could not be named in it; and a built
 * deck may hold cards from more than one staged set, so resolving it against
 * the browsed set alone loses half of it and drawing it with the browsed set's
 * art resolver puts the pending frame on cards whose pictures are one manifest
 * over. The union answers both.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard, setBasics } from '@mtg/dsl';
import {
  ALL_SETS_LABEL,
  PreconPicker,
  chooseTheirsLabel,
  chooseYoursLabel,
} from '../../src/routes/play/PreconPicker';
import { isMissing, playableVariation } from '../../src/routes/play/playable-deck';
import type { PlayableDeck } from '../../src/routes/play/playable-deck';
import type { Variation } from '../../src/routes/deck/workbench/client';

afterEach(cleanup);

/** The members these assertions read. The workspace tsconfig has no `lib: dom`. */
interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => readonly ElementLike[];
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
}

function element(container: unknown): ElementLike {
  return container as ElementLike;
}

function creature(id: string, name: string): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Soldier'],
    power: 2,
    toughness: 2,
  } satisfies CardInput);
}

function WRITTEN_DECK(): PlayableDeck {
  return {
    id: 'sky-islands',
    name: 'The Sky Islands',
    plan: 'fliers and time',
    cards: [SCOUT, SCOUT],
    colors: ['W'],
    spells: 2,
    lands: 0,
    creatures: 2,
    rares: 2,
    centerpiece: 'Skyborn Scout',
    complete: true,
    origin: 'precon',
    sets: ['XMP'],
  };
}

const SOLDIER = creature('xmp-soldier', 'Vantan Soldier');
const SCOUT = creature('xmp-scout', 'Skyborn Scout');
const BASICS = setBasics([SOLDIER, SCOUT]);
const POOL: readonly Card[] = [SOLDIER, SCOUT, ...BASICS];

function plainsId(): string {
  const plains = BASICS.find((card) => card.name === 'Plains');
  if (plains === undefined) throw new Error('setBasics returned no Plains');
  return plains.id;
}

function variation(overrides: Partial<Variation> = {}): Variation {
  return {
    version: 1,
    id: 'v-alaric',
    name: 'Alaric, Hero of Hours',
    builtAt: '2026-09-01T10:00:00.000Z',
    parentId: null,
    criteria: {
      prompt: 'a mono-white weenie deck around Alaric',
      sets: ['XMP'],
      colors: ['W'],
      size: 8,
      maxCopies: 4,
      themes: [],
    },
    statedCriteria: [],
    plan: 'curve out and attack',
    spells: [
      {
        id: 'xmp-soldier',
        name: 'Vantan Soldier',
        count: 4,
        manaCost: '{1}{W}',
        manaValue: 2,
        typeLine: 'Creature — Soldier',
        criteria: [],
        reason: 'a two-drop that attacks',
      },
    ],
    lands: [],
    basics: [{ color: 'W', count: 4, id: plainsId() }],
    manaBase: {
      totalLands: 4,
      nonBasicLands: 0,
      castabilityTarget: 0.9,
      heavyCastabilityTarget: 0.8,
      colors: [{ color: 'W', pipCount: 4, sources: 4, sourceFloor: 3, castability: 0.95, meetsTarget: true }],
      landReason: 'a mono-white curve',
      landSource: 'model',
    },
    universeSize: 40,
    shortfalls: [],
    ...overrides,
  } as Variation;
}

function playable(overrides: Partial<Variation> = {}): PlayableDeck {
  const resolved = playableVariation(variation(overrides), POOL);
  if (isMissing(resolved)) throw new Error(`the fixture did not resolve: ${resolved.missing.join(', ')}`);
  return resolved;
}

describe('resolving a built deck for the picker', () => {
  it('deals the cards the variation wrote down, basics included', () => {
    const deck = playable();
    expect(deck.cards).toHaveLength(8);
    expect(deck.cards.filter((card) => card.id === 'xmp-soldier')).toHaveLength(4);
    // The set's own Plains, by the id the variation recorded. This is the half
    // `reopenVariation` cannot do: it keys basics by color, so the deck comes
    // back holding whichever Plains the union offers first (`mtg-ac0h`), which
    // is how a XMP deck ends up drawing M11 lands with no art.
    expect(deck.cards.filter((card) => card.id === plainsId())).toHaveLength(4);
  });

  it('reads its colors off the mana base rather than off the criteria', () => {
    // The criteria are what somebody asked for and are empty whenever they let
    // the model choose; the mana base is what the deck actually casts.
    const deck = playableVariation(variation({ criteria: { ...variation().criteria, colors: [] } }), POOL);
    expect(isMissing(deck)).toBe(false);
    if (!isMissing(deck)) expect(deck.colors).toStrictEqual(['W']);
  });

  it('reports what is missing rather than dealing a short deck', () => {
    // A list four cards down is a different deck from the one somebody named,
    // and dealing it quietly makes the game evidence about a deck nobody built.
    const result = playableVariation(variation(), [SCOUT, ...BASICS]);
    expect(isMissing(result)).toBe(true);
    if (isMissing(result)) expect(result.missing).toStrictEqual(['Vantan Soldier']);
  });

  it('names a missing basic too, which is the id nothing else would report', () => {
    const result = playableVariation(variation(), [SOLDIER, SCOUT]);
    expect(isMissing(result)).toBe(true);
    if (isMissing(result)) expect(result.missing).toStrictEqual([plainsId()]);
  });
});

const WRITTEN_FOR_FILTER: PlayableDeck = WRITTEN_DECK();

describe('the picker', () => {
  const WRITTEN: PlayableDeck = {
    id: 'sky-islands',
    name: 'The Sky Islands',
    plan: 'fliers and time',
    cards: [SCOUT, SCOUT],
    colors: ['W'],
    spells: 2,
    lands: 0,
    creatures: 2,
    rares: 2,
    centerpiece: 'Skyborn Scout',
    complete: true,
    origin: 'precon',
    sets: ['XMP'],
  };

  function pick(decks: readonly PlayableDeck[]): void {
    render(
      h(PreconPicker, {
        decks,
        yourDeckId: decks[0]?.id ?? '',
        opponentDeckId: decks[1]?.id ?? '',
        onChooseYours: () => undefined,
        onChooseTheirs: () => undefined,
        onPlay: () => undefined,
      }),
    );
  }

  it('offers both named Hero of Hours decks as yours and as the opponent', () => {
    const alaric = playable();
    const vessari = playable({ id: 'v-vessari', name: 'Vessari, Hero of Hours' });
    pick([WRITTEN, alaric, vessari]);
    expect(screen.getByRole('button', { name: chooseYoursLabel('Alaric, Hero of Hours') })).toBeTruthy();
    expect(screen.getByRole('button', { name: chooseTheirsLabel('Alaric, Hero of Hours') })).toBeTruthy();
    expect(screen.getByRole('button', { name: chooseYoursLabel('Vessari, Hero of Hours') })).toBeTruthy();
    expect(screen.getByRole('button', { name: chooseTheirsLabel('Vessari, Hero of Hours') })).toBeTruthy();
    expect(screen.getByRole('button', { name: chooseYoursLabel('The Sky Islands') })).toBeTruthy();
  });

  it('reports each requested deck identity when it is selected', () => {
    const chosen: string[] = [];
    const alaric = playable();
    const vessari = playable({ id: 'v-vessari', name: 'Vessari, Hero of Hours' });
    render(
      h(PreconPicker, {
        decks: [alaric, vessari],
        yourDeckId: alaric.id,
        opponentDeckId: vessari.id,
        onChooseYours: (id) => chosen.push(id),
        onChooseTheirs: (id) => chosen.push(id),
        onPlay: () => undefined,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: chooseYoursLabel('Vessari, Hero of Hours') }));
    fireEvent.click(screen.getByRole('button', { name: chooseTheirsLabel('Alaric, Hero of Hours') }));
    expect(chosen).toEqual(['v-vessari', 'v-alaric']);
  });

  it('states the matchup across the two kinds', () => {
    const { container } = render(
      h(PreconPicker, {
        decks: [WRITTEN, playable()],
        yourDeckId: WRITTEN.id,
        opponentDeckId: 'v-alaric',
        onChooseYours: () => undefined,
        onChooseTheirs: () => undefined,
        onPlay: () => undefined,
      }),
    );
    const line = element(container).querySelector('.mtg-matchup__line');
    expect(line?.textContent).toBe('The Sky IslandsvsHenry, Hero of Hours');
  });

  it('badges where each deck came from, because they are different promises', () => {
    // A written deck and a deck somebody described are different claims about
    // what is inside, and a row of tiles that did not say which was which is the
    // Decks tab's `mtg-tewc.6` again.
    const { container } = render(
      h(PreconPicker, {
        decks: [WRITTEN, playable()],
        yourDeckId: WRITTEN.id,
        opponentDeckId: 'v-alaric',
        onChooseYours: () => undefined,
        onChooseTheirs: () => undefined,
        onPlay: () => undefined,
      }),
    );
    const kinds = [...element(container).querySelectorAll('[data-kind]')].map((node) =>
      node.getAttribute('data-kind'),
    );
    expect(kinds).toStrictEqual(['precon', 'variation']);
  });
});

describe('the set filter', () => {
  const M11: PlayableDeck = {
    id: 'm11-deck',
    name: 'An M11 build',
    plan: 'a described deck from another set',
    cards: [SCOUT],
    colors: ['W'],
    spells: 1,
    lands: 0,
    creatures: 1,
    rares: 1,
    centerpiece: null,
    complete: true,
    origin: 'built',
    sets: ['M11'],
  };

  function renderPicker(decks: readonly PlayableDeck[]): ElementLike {
    const { container } = render(
      h(PreconPicker, {
        decks,
        yourDeckId: decks[0]?.id ?? '',
        opponentDeckId: decks[1]?.id ?? '',
        onChooseYours: () => undefined,
        onChooseTheirs: () => undefined,
        onPlay: () => undefined,
      }),
    );
    return element(container);
  }

  it('narrows the row to one set, and back', () => {
    // The playtester: "the play tab seems to be tied to a set so since these decks
    // aren't, how is that going to work? we should have a way to just show all
    // the playable decks and filter by set if we want."
    renderPicker([WRITTEN_FOR_FILTER, M11]);
    expect(screen.getByRole('heading', { level: 3, name: 'Decks from' })).toBeTruthy();
    expect(screen.getByRole('button', { name: chooseYoursLabel('An M11 build') })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'XMP' }));
    expect(screen.queryByRole('button', { name: chooseYoursLabel('An M11 build') })).toBeNull();
    expect(screen.getByRole('button', { name: chooseYoursLabel('The Sky Islands') })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ALL_SETS_LABEL }));
    expect(screen.getByRole('button', { name: chooseYoursLabel('An M11 build') })).toBeTruthy();
  });

  it('keeps a chosen matchup while the row is narrowed away from it', () => {
    // Filtering is a way to find a deck, not a way to unchoose one: the matchup
    // line still names both, and pressing Play still deals them.
    const container = renderPicker([WRITTEN_FOR_FILTER, M11]);
    fireEvent.click(screen.getByRole('button', { name: 'M11' }));
    expect(container.querySelector('.mtg-matchup__line')?.textContent).toBe('The Sky IslandsvsAn M11 build');
  });

  it('draws no filter when every deck is from one set', () => {
    renderPicker([WRITTEN_FOR_FILTER]);
    expect(screen.queryByRole('button', { name: ALL_SETS_LABEL })).toBeNull();
  });
});
