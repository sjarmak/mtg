// @vitest-environment jsdom
/**
 * Preconstructed decks: picking one, and the game that comes out of it.
 *
 * Three claims are worth pinning here and none of them is about a particular
 * set. The cards are invented, the way `@mtg/deckbuild`'s own precon test
 * invents them, because this layer knows nothing about any set and a test that
 * borrowed one would be testing that set instead.
 *
 * 1. **The selection is a deal input.** A game is a pure function of the seed
 *    and the two deck ids — neither side is opened from a pool — so two deals
 *    at one seed produce the same table, and the component publishes the triple
 *    the moment somebody presses Play. That is what makes `#/play?deck=&vs=&
 *    seed=` a link to a game rather than to a page.
 * 2. **A list the set does not print fails before anything is dealt.** The
 *    failure this guards against is a precon file staged beside the wrong set,
 *    which resolves to a deck with cards missing rather than to an error.
 * 3. **A person can get from arriving to playing by pressing things.** The last
 *    block clicks: choose a deck, choose the opponent, start the game.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card, CardInput } from '@mtg/dsl';
import { createSession, stateFingerprint } from '@mtg/kernel';
import { parseCard } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { parsePreconFile } from '@mtg/deckbuild';
import { LEGAL_MOVES_LABEL } from '../../src/routes/play/rail';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { PRECON_MISMATCH_TITLE } from '../../src/routes/PlayRoute';
import type { PlaySetState, PreconState } from '../../src/routes/PlayRoute';
import { PRECON_TAB_LABEL, SEALED_TAB_LABEL } from '../../src/routes/play/BuilderSwitch';
import { dealPreconGame } from '../../src/routes/play/deal';
import { PreconGame } from '../../src/routes/play/PreconGame';
import type { PreconSelection } from '../../src/routes/play/PreconGame';
import {
  chooseTheirsLabel,
  chooseYoursLabel,
  OPPONENT_LABEL,
  PRECON_LABEL,
  PRECON_PLAY_LABEL,
  PRECON_SEED_LABEL,
} from '../../src/routes/play/PreconPicker';
import {
  PRECON_PIN_LABEL,
  PRECON_PINNED_LABEL,
  PRECON_RESHUFFLE_CONFIRM_LABEL,
  PRECON_RESHUFFLE_LABEL,
  PRECON_TABLE_SEED_LABEL,
} from '../../src/routes/play/precon-strip';
import { preconFacts, preconProblem } from '../../src/routes/play/precon-facts';

afterEach(cleanup);

function creature(index: number, manaValue: number): Card {
  return parseCard({
    kind: 'creature',
    id: `stand-in-${String(index)}`,
    name: `Understudy ${String(index)}`,
    rarity: index === 0 ? 'rare' : 'common',
    set: { code: 'STA', collectorNumber: index + 1 },
    manaCost: { generic: manaValue - 1, G: 1 },
    colors: ['G'],
    power: manaValue,
    toughness: manaValue,
  } satisfies CardInput);
}

/** Six distinct cards at mana values 1 through 6, which is a whole curve. */
const SET: readonly Card[] = Array.from({ length: 6 }, (_unused, index) => creature(index, index + 1));

const FILE: PreconFile = parsePreconFile({
  formatVersion: 1,
  setCode: 'STA',
  decks: [
    {
      id: 'first',
      name: 'The Understudies',
      plan: 'Cast the six-drop and swing.',
      payoff: 'stand-in-0',
      deckSize: 60,
      basics: { G: 24 },
      spells: SET.map((card) => ({ id: card.id, count: 6 })),
    },
    {
      id: 'second',
      name: 'The Other Understudies',
      plan: 'Cast the one-drop and swing sooner.',
      payoff: 'stand-in-1',
      deckSize: 60,
      basics: { G: 24 },
      spells: SET.map((card) => ({ id: card.id, count: 6 })),
    },
  ],
});

const [FIRST, SECOND] = FILE.decks;
if (FIRST === undefined || SECOND === undefined) throw new Error('the fixture holds two decks');

/**
 * The text of an element, narrowed by hand.
 *
 * The workspace tsconfig has no `lib: dom`, so `HTMLElement` carries no
 * `textContent` here and the read has to be checked at runtime, the way
 * `board.test.ts` does for the same reason.
 */
function textOf(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('textContent' in value)) return '';
  const { textContent } = value as { textContent: unknown };
  return typeof textContent === 'string' ? textContent : '';
}

function ready(cards: readonly Card[]): PlaySetState {
  return { status: 'ready', cards };
}

function readyPrecons(file: PreconFile): PreconState {
  return { status: 'ready', file };
}

describe('dealing two written decks opposite each other', () => {
  it('seats two legal 60s and names each one for its list', () => {
    const dealt = dealPreconGame(FIRST, SECOND, SET, { seed: 'precon-test/v0' });
    const [seatZero, seatOne] = dealt.config.setup.decks;
    expect(seatZero.cards).toHaveLength(60);
    expect(seatOne.cards).toHaveLength(60);
    expect(seatZero.name).toBe(FIRST.name);
    expect(seatOne.name).toBe(SECOND.name);
  });

  it('is a pure function of the seed and the two lists', () => {
    const once = dealPreconGame(FIRST, SECOND, SET, { seed: 'precon-test/v0' });
    const twice = dealPreconGame(FIRST, SECOND, SET, { seed: 'precon-test/v0' });
    expect(twice.config.setup.seed).toBe(once.config.setup.seed);
    expect(twice.config.setup.decks.map((deck) => deck.cards.map((card) => card.id))).toEqual(
      once.config.setup.decks.map((deck) => deck.cards.map((card) => card.id)),
    );
  });

  it('puts the viewer where they are sitting, so seat 1 is still their deck', () => {
    const dealt = dealPreconGame(FIRST, SECOND, SET, { seed: 'precon-test/v1', viewer: 1 });
    expect(dealt.config.viewer).toBe(1);
    expect(dealt.config.setup.decks[1].name).toBe(FIRST.name);
    expect(dealt.config.setup.decks[0].name).toBe(SECOND.name);
  });

  it('seats a second person with a finished deck, which sealed cannot do', () => {
    const dealt = dealPreconGame(FIRST, SECOND, SET, { seed: 'precon-test/v2', opponent: 'human' });
    expect(dealt.config.names).toEqual(['Player one', 'Player two']);
    expect(dealt.config.seats.every((seat) => seat.kind === 'human')).toBe(true);
  });

  it('refuses a list naming a card the set does not print, by name', () => {
    const stale = { ...FIRST, spells: [...FIRST.spells, { id: 'stand-in-absent', count: 1 }] };
    expect(() => dealPreconGame(stale, SECOND, SET)).toThrow(/stand-in-absent/);
  });
});

describe('what a tile says about a deck', () => {
  it('measures the deck rather than repeating the file', () => {
    const facts = preconFacts(FIRST, SET);
    expect(facts.spells).toBe(36);
    expect(facts.lands).toBe(24);
    expect(facts.creatures).toBe(36);
    expect(facts.rares).toBe(6);
    expect(facts.colors).toEqual(['G']);
    expect(facts.payoffName).toBe('Understudy 0');
    expect(facts.complete).toBe(true);
  });

  it('counts a promoted mythic among the top-tier cards', () => {
    // The count was an equality on the word "rare", so promoting a card to
    // mythic made the tile report one fewer top-tier card than the deck plays.
    const before = preconFacts(FIRST, SET).rares;
    expect(before).toBeGreaterThan(0);
    const played = new Set(FIRST.spells.map((spell) => spell.id));
    const promotedId = SET.find((card) => card.rarity === 'rare' && played.has(card.id))?.id;
    expect(promotedId).toBeDefined();
    const promoted = SET.map((card) =>
      card.id === promotedId ? { ...card, rarity: 'mythic' as const } : card,
    );
    expect(preconFacts(FIRST, promoted).rares).toBe(before);
  });

  it('names the missing ids when the file was cut from another set', () => {
    const other = [...SET].slice(0, 3);
    const problem = preconProblem(FILE, other);
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/stand-in-3/);
  });

  it('says nothing when every id resolves', () => {
    expect(preconProblem(FILE, SET)).toBeNull();
  });
});

describe('the play route with decks staged', () => {
  it('opens on the decks, with the sealed pool one press away', () => {
    render(h(PlayRoute, { set: ready(SET), precons: { state: readyPrecons(FILE) } }));
    expect(screen.getByRole('group', { name: PRECON_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: PRECON_TAB_LABEL })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SEALED_TAB_LABEL }));
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
  });

  it('removes the setup switch after a preconstructed game starts', () => {
    render(h(PlayRoute, { set: ready(SET), precons: { state: readyPrecons(FILE) } }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(screen.queryByRole('button', { name: PRECON_TAB_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: SEALED_TAB_LABEL })).toBeNull();
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
  });

  it('is the sealed builder and nothing else when no decks are staged', () => {
    render(h(PlayRoute, { set: ready(SET), precons: { state: { status: 'absent' } } }));
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PRECON_TAB_LABEL })).toBeNull();
  });

  it('refuses to offer decks the staged set cannot print, and says which', () => {
    render(h(PlayRoute, { set: ready([...SET].slice(0, 3)), precons: { state: readyPrecons(FILE) } }));
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    const said = screen.getAllByRole('status').map(textOf);
    expect(said.some((line) => line.includes(PRECON_MISMATCH_TITLE))).toBe(true);
    expect(said.some((line) => line.includes('stand-in-3'))).toBe(true);
  });
});

describe('picking a deck and playing it', () => {
  it('publishes both deck ids, and no seed, when the game starts', () => {
    const published: (PreconSelection | null)[] = [];
    render(
      h(PreconGame, {
        file: FILE,
        set: SET,
        seed: 'precon-test/pick',
        onSelect: (selection) => published.push(selection),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: chooseYoursLabel(SECOND.name) }));
    const opponents = within(screen.getByRole('group', { name: OPPONENT_LABEL }));
    fireEvent.click(opponents.getByRole('button', { name: chooseTheirsLabel(FIRST.name) }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    // Both deck ids and no seed: the link is to a table, not to one shuffle.
    expect(published).toEqual([{ deck: 'second', vs: 'first' }]);
  });

  it('reaches a board with legal moves on it', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/board' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
  });

  it('opens the table straight away when the hash already names both decks', () => {
    render(
      h(PreconGame, {
        file: FILE,
        set: SET,
        seed: 'precon-test/link',
        deckId: 'second',
        opponentDeckId: 'first',
      }),
    );
    // No picker: a link that names a table is a link to that table.
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
  });

  it('falls back to the picker when the hash names a deck the file does not hold', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/bad', deckId: 'no-such-deck' }));
    expect(screen.getByRole('group', { name: PRECON_LABEL })).toBeTruthy();
  });
});

/**
 * Sitting down again deals a different game, and any game can still be got back.
 *
 * The defect this block pins is the one that was reported from play: a precon
 * is a deck somebody plays repeatedly, and every game of it was the same game.
 * Pressing Play wrote `?seed=` beside the two deck ids, so the link the picker
 * produced named one shuffle — a reload, or the same link tomorrow, replayed
 * the identical opening hand and nothing on the page dealt another one.
 *
 * The three requirements are separate tests here because they are separate
 * claims and the fix is only correct if all three hold at once:
 *
 * 1. two mounts with no seed deal different games,
 * 2. a stated seed deals the same game twice,
 * 3. the reshuffle control draws a seed different from the current one, and the
 *    new seed is what the game reports.
 *
 * `dealPreconGame` is called directly for the "different game" half, the way
 * `seed.test.ts` calls `openSealed` directly and for the same reason: that
 * function's totality in the seed is the actual claim, and the render tests
 * then prove the component reaches it with the seed it says it did. Comparing
 * two boards through the rail would prove less and flake more — two opening
 * turns of one deck offer the same handful of moves whatever was shuffled.
 */
describe('playing a precon again', () => {
  /** The value beside a `seed` label, read structurally: no `dom` lib here. */
  function seedBeside(label: string): string {
    const found: unknown = screen.getByText(label);
    const fact = found as { readonly nextElementSibling?: { readonly textContent?: string | null } };
    const value = fact.nextElementSibling;
    if (value === undefined || value === null) throw new Error(`no value beside the ${label} label`);
    return value.textContent ?? '';
  }

  /**
   * The game a seed deals, as one string.
   *
   * The deck *lists* are fixed here — that is what a precon is — so the shuffle
   * is the kernel's, taken from `setup.seed` at `createSession`. The comparison
   * therefore has to be made on the opened position rather than on the lists,
   * and `stateFingerprint` is the value the kernel already uses to say two
   * positions are the same position.
   */
  const gameOf = (seed: string): string => {
    const { config } = dealPreconGame(FIRST, SECOND, SET, { seed });
    return stateFingerprint(createSession(config.setup, config.seats).state);
  };

  it('shows the seed of the game being played, not only the picker', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/shown' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(seedBeside(PRECON_TABLE_SEED_LABEL)).toBe('precon-test/shown');
  });

  it('deals a different game on a second visit, with no seed named', () => {
    render(h(PreconGame, { file: FILE, set: SET }));
    const first = seedBeside(PRECON_SEED_LABEL);
    cleanup();
    render(h(PreconGame, { file: FILE, set: SET }));
    const second = seedBeside(PRECON_SEED_LABEL);
    expect(second).not.toBe(first);
    expect(gameOf(second)).not.toBe(gameOf(first));
  });

  it('deals the same game twice when the seed is stated', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/pinned' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    const shown = seedBeside(PRECON_TABLE_SEED_LABEL);
    cleanup();
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/pinned' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(seedBeside(PRECON_TABLE_SEED_LABEL)).toBe(shown);
    expect(gameOf(shown)).toBe(gameOf('precon-test/pinned'));
  });

  it('asks before it throws a game away, and one press throws nothing away', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/armed' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_RESHUFFLE_LABEL }));
    // Armed, not dealt: the seed on screen is still the game being played.
    expect(seedBeside(PRECON_TABLE_SEED_LABEL)).toBe('precon-test/armed');
    expect(screen.getByRole('button', { name: PRECON_RESHUFFLE_CONFIRM_LABEL })).toBeTruthy();
  });

  it('reshuffles to a seed different from the current one, and reports it', () => {
    const published: PreconSelection[] = [];
    render(
      h(PreconGame, {
        file: FILE,
        set: SET,
        seed: 'precon-test/reshuffle',
        onSelect: (selection) => published.push(selection),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_RESHUFFLE_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_RESHUFFLE_CONFIRM_LABEL }));
    const dealt = seedBeside(PRECON_TABLE_SEED_LABEL);
    expect(dealt).not.toBe('precon-test/reshuffle');
    expect(dealt.startsWith('lab/precon/')).toBe(true);
    expect(gameOf(dealt)).not.toBe(gameOf('precon-test/reshuffle'));
    // And the hash stops naming the game nobody is playing any more.
    expect(published[published.length - 1]).toEqual({ deck: 'first', vs: 'second' });
    // The control is back to asking, so the next press cannot deal by momentum.
    expect(screen.getByRole('button', { name: PRECON_RESHUFFLE_LABEL })).toBeTruthy();
  });

  it('pins the game on request, which is what puts a seed in the hash', () => {
    const published: PreconSelection[] = [];
    // No seed prop, which is the ordinary state of a table opened from the
    // picker: the hash names the two decks and nothing pins the deal.
    render(h(PreconGame, { file: FILE, set: SET, onSelect: (selection) => published.push(selection) }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    const shown = seedBeside(PRECON_TABLE_SEED_LABEL);
    fireEvent.click(screen.getByRole('button', { name: PRECON_PIN_LABEL }));
    // What is published is the seed on screen: the link reproduces this game
    // and no other.
    expect(published[published.length - 1]).toEqual({ deck: 'first', vs: 'second', seed: shown });
  });

  it('says the game is already linked when the hash carries its seed', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/link', onSelect: () => undefined }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    // The seed prop is this deal's seed, so the hash already reproduces it.
    expect(screen.getByRole('button', { name: PRECON_PINNED_LABEL })).toBeTruthy();
  });

  it('offers no link control to a caller with no router to write one', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/routerless' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(screen.queryByRole('button', { name: PRECON_PIN_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PRECON_PINNED_LABEL })).toBeNull();
  });
});
