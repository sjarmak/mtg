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
 *    the moment somebody presses Play. That is what makes `#/play?deck=&against=&
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
import { PLAY_DECKS_LABEL } from '../../src/routes/play/PlayChooser';
import { PLAY_GENERATE_LABEL, PLAY_SEALED_LABEL } from '../../src/routes/play/SealedChooser';
import { preconCountsLine } from '../../src/routes/deck/DeckCard';
import { dealPreconGame } from '../../src/routes/play/deal';
import { PreconGame } from '../../src/routes/play/PreconGame';
import type { PreconSelection } from '../../src/routes/play/PreconGame';
import {
  chooseTheirsLabel,
  chooseYoursLabel,
  OPPONENT_LABEL,
  PRECON_LABEL,
  PRECON_PLAY_LABEL,
} from '../../src/routes/play/PreconPicker';
import {
  PRECON_DETAILS_LABEL,
  PRECON_MENU_LABEL,
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

/** The line an `absent` set draws over the pool, named here so a test can find it. */
const STAND_IN_NOTE = 'These are the DSL example cards, not a staged set.';

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

  it('agrees with its own numbers, down to the deck that plays one rare', () => {
    // The shipped tile read "19 creatures · 36 spells · 24 lands · 14 rare",
    // because three of the four nouns were written plural and the fourth was
    // written singular. Both directions are pinned: the line is the four counts
    // the facts hold, and a count of one drops the `s` rather than keeping it.
    const facts = preconFacts(FIRST, SET);
    expect(preconCountsLine(facts)).toBe(
      `${String(facts.creatures)} creatures · ${String(facts.spells - facts.creatures)} noncreature spells · ${String(facts.lands)} lands · ${String(facts.rares)} rares`,
    );
    expect(preconCountsLine({ creatures: 1, spells: 2, lands: 1, rares: 1 })).toBe(
      '1 creature · 1 noncreature spell · 1 land · 1 rare',
    );
  });

  it('prints three numbers that sum to the deck the tile opens', () => {
    // The shipped tile counted the creatures twice: `spells` is every nonland
    // card, so Wield the Obliterator read "19 creatures · 36 spells · 24 lands"
    // and a reader adding them got 79 for a 60-card deck. The line has to be
    // arithmetic a person can do, and the deck's own summary one click away has
    // always subtracted.
    const facts = preconFacts(FIRST, SET);
    const line = preconCountsLine(facts);
    const numbers = [...line.matchAll(/(\d+) (?:creature|noncreature spell|land)s?\b/g)].map((match) =>
      Number(match[1]),
    );
    expect(numbers).toHaveLength(3);
    expect(numbers.reduce((sum, value) => sum + value, 0)).toBe(facts.spells + facts.lands);
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
  /**
   * `mtg-tewc.5` changed what "one press away" means. The two builders were
   * tabs, so whichever you were not looking at was not on the page at all;
   * they are two named sections now and both stand before anything is dealt.
   *
   * The set in this file is five commons short of a booster, which makes it the
   * cheapest place in the suite to pin the other half of that section: a set
   * that cannot deal a pool draws the reason where the button would go, rather
   * than a *Generate sealed pool* control that would fail when pressed. The
   * press itself is pinned in `test/lab/staged-play.test.ts`, over a set with
   * enough cards to answer it.
   */
  it('shows the decks under Constructed, and the sealed offer under Sealed and not beside them', () => {
    const constructed = render(h(PlayRoute, { set: ready(SET), precons: { state: readyPrecons(FILE) } }));
    expect(screen.getByRole('region', { name: PLAY_DECKS_LABEL })).toBeTruthy();
    expect(screen.getByRole('group', { name: PRECON_LABEL })).toBeTruthy();
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
    constructed.unmount();

    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), precons: { state: readyPrecons(FILE) } }));
    expect(screen.getByRole('region', { name: PLAY_SEALED_LABEL })).toBeTruthy();
    expect(screen.queryByRole('region', { name: PLAY_DECKS_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PLAY_GENERATE_LABEL })).toBeNull();
    expect(screen.getAllByText(/a booster needs \d+ common cards/).length).toBeGreaterThan(0);
  });

  it('removes the chooser around the decks after a preconstructed game starts', () => {
    render(h(PlayRoute, { set: ready(SET), precons: { state: readyPrecons(FILE) } }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(screen.queryByRole('region', { name: PLAY_DECKS_LABEL })).toBeNull();
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
  });

  /**
   * The playtester's instruction for M11 and M13, which ship no precons and never
   * will: "do not show an empty Preconstructed Decks section". Not an empty
   * one, not one that says none — no section and no heading.
   */
  it('draws no decks section at all when no decks are staged', () => {
    render(h(PlayRoute, { set: ready(SET), precons: { state: { status: 'absent' } } }));
    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    expect(screen.queryByRole('region', { name: PLAY_DECKS_LABEL })).toBeNull();
  });

  /**
   * `mtg-aqxi.16`. The lines above the builder are about the staged documents:
   * which file would not resolve, which collation could not be dealt, that
   * these cards are the DSL's examples standing in for a set. They are read
   * once, by somebody deciding what to open — and they used to stay on the page
   * for the whole game after that, above a board with 390 pixels of height on a
   * phone and no more use for the sentence on a desktop.
   *
   * The stand-in note is the one used here because it is the cheapest to reach:
   * an `absent` set state draws it and still offers the decks, so one render
   * has both halves. `PlayChooser` already drops its own headings the same
   * way, and this is the same rule applied to the same moment.
   */
  it('drops the notes about the staged documents once a game is on', () => {
    render(
      h(PlayRoute, {
        set: { status: 'absent', cards: SET },
        sourceHint: STAND_IN_NOTE,
        precons: { state: readyPrecons(FILE) },
      }),
    );
    expect(
      screen
        .getAllByRole('status')
        .map(textOf)
        .some((line) => line.includes(STAND_IN_NOTE)),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: chooseYoursLabel(FIRST.name) }));
    const opponents = within(screen.getByRole('group', { name: OPPONENT_LABEL }));
    fireEvent.click(opponents.getByRole('button', { name: chooseTheirsLabel(SECOND.name) }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));

    expect(screen.queryByRole('group', { name: PRECON_LABEL })).toBeNull();
    expect(
      screen
        .getAllByRole('status')
        .map(textOf)
        .some((line) => line.includes(STAND_IN_NOTE)),
    ).toBe(false);
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
    expect(published).toEqual([{ deck: 'second', against: 'first' }]);
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
  /**
   * Opens the table's `Game` menu, which is where the seed, the reshuffle and
   * the link live now: they are three things a player goes looking for once a
   * game and they used to sit across the top of the board for all of it. Idle
   * when it is already open, so a test can call it after a control inside it
   * dealt a new game without closing what it meant to read.
   */
  function openGameMenu(): void {
    if (screen.queryByRole('button', { name: PRECON_MENU_LABEL, expanded: true }) !== null) return;
    fireEvent.click(screen.getByRole('button', { name: PRECON_MENU_LABEL }));
  }

  /** The value beside a `Game ID` label, read structurally: no `dom` lib here. */
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
    openGameMenu();
    expect(seedBeside(PRECON_TABLE_SEED_LABEL)).toBe('precon-test/shown');
  });

  /**
   * Read off the table rather than off the picker, because the picker no longer
   * prints a seed: it is the name of a deal, and until Play is pressed there is
   * no deal. The claim is unchanged — two visits with nothing named deal two
   * different games — and it is now made about the games themselves.
   */
  it('deals a different game on a second visit, with no seed named', () => {
    render(h(PreconGame, { file: FILE, set: SET }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    const first = seedBeside(PRECON_TABLE_SEED_LABEL);
    cleanup();
    render(h(PreconGame, { file: FILE, set: SET }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    const second = seedBeside(PRECON_TABLE_SEED_LABEL);
    expect(second).not.toBe(first);
    expect(gameOf(second)).not.toBe(gameOf(first));
  });

  /** And the picker itself says nothing about a seed, which is the point of the move. */
  it('names no seed on the picker', () => {
    const { container } = render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/quiet' }));
    expect(screen.getByRole('group', { name: PRECON_LABEL })).toBeTruthy();
    expect(textOf(container)).not.toContain('precon-test/quiet');
    expect(textOf(container).toLowerCase()).not.toContain('seed');
  });

  it('deals the same game twice when the seed is stated', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/pinned' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    const shown = seedBeside(PRECON_TABLE_SEED_LABEL);
    cleanup();
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/pinned' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    expect(seedBeside(PRECON_TABLE_SEED_LABEL)).toBe(shown);
    expect(gameOf(shown)).toBe(gameOf('precon-test/pinned'));
  });

  it('asks before it throws a game away, and one press throws nothing away', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/armed' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
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
    openGameMenu();
    fireEvent.click(screen.getByRole('button', { name: PRECON_RESHUFFLE_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_RESHUFFLE_CONFIRM_LABEL }));
    openGameMenu();
    const dealt = seedBeside(PRECON_TABLE_SEED_LABEL);
    expect(dealt).not.toBe('precon-test/reshuffle');
    expect(dealt.startsWith('lab/precon/')).toBe(true);
    expect(gameOf(dealt)).not.toBe(gameOf('precon-test/reshuffle'));
    // And the hash stops naming the game nobody is playing any more.
    expect(published[published.length - 1]).toEqual({ deck: 'first', against: 'second' });
    // The control is back to asking, so the next press cannot deal by momentum.
    expect(screen.getByRole('button', { name: PRECON_RESHUFFLE_LABEL })).toBeTruthy();
  });

  it('pins the game on request, which is what puts a seed in the hash', () => {
    const published: PreconSelection[] = [];
    // No seed prop, which is the ordinary state of a table opened from the
    // picker: the hash names the two decks and nothing pins the deal.
    render(h(PreconGame, { file: FILE, set: SET, onSelect: (selection) => published.push(selection) }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    const shown = seedBeside(PRECON_TABLE_SEED_LABEL);
    fireEvent.click(screen.getByRole('button', { name: PRECON_PIN_LABEL }));
    // What is published is the seed on screen: the link reproduces this game
    // and no other.
    expect(published[published.length - 1]).toEqual({ deck: 'first', against: 'second', seed: shown });
  });

  it('says the game is already linked when the hash carries its seed', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/link', onSelect: () => undefined }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    // The seed prop is this deal's seed, so the hash already reproduces it.
    expect(screen.getByRole('button', { name: PRECON_PINNED_LABEL })).toBeTruthy();
  });

  it('offers no link control to a caller with no router to write one', () => {
    render(h(PreconGame, { file: FILE, set: SET, seed: 'precon-test/routerless' }));
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    openGameMenu();
    expect(screen.getByRole('group', { name: PRECON_DETAILS_LABEL })).toBeTruthy();
    expect(screen.queryByRole('button', { name: PRECON_PIN_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PRECON_PINNED_LABEL })).toBeNull();
  });
});
