// @vitest-environment jsdom
/**
 * Sealed, from a generated set to a game in progress.
 *
 * The acceptance this covers is a sequence rather than a property: open a pool
 * from a real set, get a build worth arguing with, change it, and start a game
 * against a bot without leaving the page. So the last test does exactly that,
 * by clicking.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { BASIC_LAND_TYPES, parseCard } from '@mtg/dsl';
import { PlayRoute } from '../../src/routes/PlayRoute';
import type { PlaySetState } from '../../src/routes/PlayRoute';
import {
  addBasicLabel,
  cutBasicLabel,
  MANA_BASE_LABEL,
  SUGGEST_BASICS_LABEL,
} from '../../src/routes/deck/BasicsPanel';
import { HOTSEAT_LABEL, SEALED_POOL_LABEL } from '../../src/routes/play/SealedBuilder';
import {
  adjustBasics,
  basicsFor,
  clearSelection,
  deckFor,
  openSealed,
  resuggest,
  resuggestBasics,
  toggle,
} from '../../src/routes/play/sealed';

afterEach(cleanup);

/**
 * A set already in hand, as the route's own state.
 *
 * Every test in this file is about what the builder does once it has a pool, so
 * they all hand the route the state it reaches after the fetch has landed. The
 * states before that one are `../lab/staged-play.test.ts`, which is where the
 * fetch is.
 */
function ready(cards: readonly Card[]): PlaySetState {
  return { status: 'ready', cards };
}

/**
 * `path.join` rather than `new URL(literal, import.meta.url)`: Vite rewrites
 * that pattern into an asset URL, which under jsdom resolves against the
 * document's `http://localhost` base instead of the file system. The analysis
 * and replay fixtures hit the same wall and document the same workaround.
 */
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
const SEED = 'sealed-test/v0';

/**
 * Narrows what testing-library hands back to the two members these assertions
 * use. The workspace tsconfig has no `lib: dom`, so `HTMLElement` carries
 * neither of them and the check has to happen at runtime, as `board.test.ts`
 * does for the same reason.
 */
interface ElementLike {
  readonly nextElementSibling: { readonly textContent: string | null } | null;
  readonly textContent: string | null;
  readonly hasAttribute: (name: string) => boolean;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: ElementLike;
  };
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.hasAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

/** The value beside a toolbar label: how the builder states a count on screen. */
function factValue(label: string): string {
  const value = asElement(screen.getByText(label)).nextElementSibling;
  if (value === null) throw new Error(`toolbar fact ${label} has no value`);
  return value.textContent ?? '';
}

/** True when a control is on screen and refusing to be pressed. */
function isDisabled(name: string): boolean {
  return asElement(screen.getByRole('button', { name })).hasAttribute('disabled');
}

describe('opening a sealed pool', () => {
  it('deals 72 cards and arrives with a build already suggested', () => {
    const build = openSealed(SET, SEED);
    expect(build.pool.length).toBe(72);
    expect(build.chosen.length).toBeGreaterThan(0);
  });

  it('suggests a legal deck straight away, so nobody starts from a blank pool', () => {
    const deck = deckFor(openSealed(SET, SEED));
    expect(deck.complete).toBe(true);
    expect(deck.deck.length).toBe(40);
    expect(deck.spellCount).toBe(deck.spellTarget);
  });

  it('computes the mana base rather than asking for it', () => {
    const deck = deckFor(openSealed(SET, SEED));
    expect(deck.lands.length).toBe(deck.config.landCount);
    const colored = Object.values(deck.manaBase.landsByColor).filter((count) => count > 0);
    expect(colored.length).toBeGreaterThan(0);
  });
});

describe('overriding the suggestion', () => {
  it('cuts a card and says the deck is now short rather than quietly refilling it', () => {
    const build = openSealed(SET, SEED);
    const first = build.chosen[0];
    if (first === undefined) throw new Error('expected a suggested build');
    const cut = toggle(build, first);
    const deck = deckFor(cut);

    expect(cut.chosen.length).toBe(build.chosen.length - 1);
    expect(deck.complete).toBe(false);
    expect(deck.spellCount).toBe(deck.spellTarget - 1);
  });

  it('treats duplicate copies as separate cards', () => {
    const build = openSealed(SET, SEED);
    // Six packs from a 90-card set open duplicates; cutting one copy must not
    // cut the others.
    const ids = build.pool.map((card) => card.id);
    const duplicated = ids.find((id, index) => ids.indexOf(id) !== index);
    expect(duplicated).toBeDefined();
    const copies = ids.flatMap((id, index) => (id === duplicated ? [index] : []));
    expect(copies.length).toBeGreaterThan(1);

    const withAll = copies.reduce(
      (current, index) => (current.chosen.includes(index) ? current : toggle(current, index)),
      build,
    );
    const firstCopy = copies[0];
    if (firstCopy === undefined) throw new Error('expected a duplicate');
    const cutOne = toggle(withAll, firstCopy);
    for (const index of copies.slice(1)) expect(cutOne.chosen).toContain(index);
    expect(cutOne.chosen).not.toContain(firstCopy);
  });

  it('restores the suggestion after clearing', () => {
    const build = openSealed(SET, SEED);
    const emptied = clearSelection(build);
    expect(emptied.chosen).toEqual([]);
    expect(deckFor(emptied).complete).toBe(false);
    expect(resuggest(emptied).chosen).toEqual(build.chosen);
  });

  it('adds a card back from the pool', () => {
    const build = openSealed(SET, SEED);
    const unchosen = build.pool.findIndex((_card, index) => !build.chosen.includes(index));
    expect(unchosen).toBeGreaterThanOrEqual(0);
    const added = toggle(build, unchosen);
    expect(added.chosen).toContain(unchosen);
    expect(deckFor(added).spellCount).toBe(deckFor(build).spellCount + 1);
  });
});

/**
 * Choosing the mana base, which `mtg-gnw` moved from the builder to the person.
 *
 * The land count used to be computed and never offered. It is still computed
 * until somebody says otherwise — a suggestion nobody has to take, the same
 * bargain the spell selection strikes — and from the first adjustment the count
 * on screen is theirs.
 */
describe('choosing the mana base', () => {
  it('starts from the computed base, so a first click edits a suggestion', () => {
    const build = openSealed(SET, SEED);
    expect(build.basics).toBeNull();

    const before = basicsFor(build);
    const added = adjustBasics(build, 'G', 1);
    const after = basicsFor(added);

    expect(after.G).toBe(before.G + 1);
    for (const color of ['W', 'U', 'B', 'R'] as const) expect(after[color]).toBe(before[color]);
  });

  it('overrides the computed base, deck size and all', () => {
    const build = adjustBasics(openSealed(SET, SEED), 'G', 1);
    const deck = deckFor(build);

    expect(build.basics).not.toBeNull();
    expect(deck.lands).toHaveLength(18);
    expect(deck.deck).toHaveLength(41);
    // Eighteen lands leaves room for twenty-two spells, and the deck holds 23.
    expect(deck.spellTarget).toBe(22);
    expect(deck.complete).toBe(false);
  });

  it('keeps the computed base available as a suggestion', () => {
    const build = openSealed(SET, SEED);
    const edited = adjustBasics(adjustBasics(build, 'G', 1), 'W', 1);
    const back = resuggestBasics(edited);

    expect(back.basics).toBeNull();
    expect(basicsFor(back)).toEqual(basicsFor(build));
    expect(deckFor(back).complete).toBe(true);
  });

  it('never counts a color below zero', () => {
    expect(basicsFor(adjustBasics(openSealed(SET, SEED), 'G', -50)).G).toBe(0);
  });

  it('leaves the mana base alone when the spells change', () => {
    // A base somebody counted out is not undone by cutting a card, which is the
    // whole difference between a chosen base and a computed one.
    const build = adjustBasics(openSealed(SET, SEED), 'G', 3);
    const first = build.chosen[0];
    if (first === undefined) throw new Error('expected a suggested build');
    expect(basicsFor(toggle(build, first))).toEqual(basicsFor(build));
  });
});

/**
 * The one block in this file that is slow by nature: each test opens a pool,
 * builds a deck and renders the table, and the last two play a whole game
 * through the click surface. Measured at 226ms quiet and 6555ms under 48 busy
 * loops against 16 cores, where the 5s default reported it as a hang — which is
 * the flake `mtg-bc2.101` names. The budget sits on the describe because the
 * cost belongs to the flow every test in it runs, not to any one of them, and
 * it is stated here rather than raised in `vitest.config.ts` so the rest of the
 * suite keeps failing a real hang in five seconds. The blocks above it are pure
 * `sealed.ts` calls and keep the default.
 */
const SEALED_FLOW_BUDGET_MS = 30_000;

describe('the whole sealed flow, by clicking', { timeout: SEALED_FLOW_BUDGET_MS }, () => {
  it('shows the deck curve, creature split, and full or compact card views before play', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    expect(Number(factValue('creatures'))).toBeGreaterThan(0);
    expect(Number(factValue('noncreature spells'))).toBeGreaterThan(0);

    const view = screen.getByRole('group', { name: 'Your deck, View' });
    expect(within(view).getByRole('button', { name: 'Full cards', pressed: true })).toBeTruthy();
    const deck = asElement(screen.getByRole('group', { name: 'Cards in your deck' }));
    expect(deck.querySelectorAll('[data-size="full"]').length).toBeGreaterThan(0);

    fireEvent.click(within(view).getByRole('button', { name: 'Compact list' }));
    const compactDeck = asElement(screen.getByRole('group', { name: 'Cards in your deck' }));
    const columns = compactDeck.querySelectorAll('[aria-label^="Mana value "]');
    expect(columns.length).toBeGreaterThan(1);
    const values = Array.from({ length: columns.length }, (_unused, index) => {
      const label = columns[index]?.getAttribute('aria-label') ?? '';
      return Number(label.match(/^Mana value (\d+)/u)?.[1]);
    });
    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  it('opens a pool, starts a game against a bot, and plays it', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));

    // Phase one: a pool and a suggested deck.
    expect(screen.getByText(SEALED_POOL_LABEL)).toBeTruthy();
    expect(screen.getByText('Your deck')).toBeTruthy();
    const play = screen.getByRole('button', { name: /Play this deck/ });

    // Phase two: a live game.
    fireEvent.click(play);
    expect(screen.queryByRole('button', { name: /Back to deckbuilding/ })).toBeNull();
    const moves = screen.getByRole('group', { name: 'Legal moves' });
    expect(within(moves).getAllByRole('button').length).toBeGreaterThan(0);

    // And it is really playable: take some turns.
    for (let step = 0; step < 25; step += 1) {
      const group = screen.queryByRole('group', { name: 'Legal moves' });
      if (group === null) break;
      const buttons = within(group).queryAllByRole('button');
      const first = buttons[0];
      if (first === undefined) break;
      fireEvent.click(first);
      expect(screen.queryByRole('alert')).toBeNull();
    }
    expect(screen.queryByText(SEALED_POOL_LABEL)).toBeNull();
  });

  it('keeps setup controls on the setup surface and removes them from the active table', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    expect(screen.getByText(SEALED_POOL_LABEL)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Play this deck/ }));
    expect(screen.queryByText(SEALED_POOL_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: /Back to deckbuilding/ })).toBeNull();
  });

  it('refuses to start on an illegal deck', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    fireEvent.click(screen.getByRole('button', { name: /^Clear/ }));
    const play = screen.getByRole('button', { name: /Play this deck/ });
    fireEvent.click(play);
    // Still on the builder: an empty selection is not a deck.
    expect(screen.getByText(SEALED_POOL_LABEL)).toBeTruthy();
  });

  /**
   * Two people, reachable.
   *
   * The seat-following board underneath this was built and tested against a
   * `PlayConfig` a library consumer would have had to write in code, which meant
   * `npm run play` — the one command that puts a game in front of a person —
   * could only ever deal a bot. This is the button that closes that gap, so the
   * test drives it the way a person does and never constructs a config.
   */
  it('starts a two-person game from this screen, which is the only way in from `npm run play`', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    fireEvent.click(screen.getByRole('button', { name: HOTSEAT_LABEL }));

    // Seats named rather than "You" and "Bot". That renaming only happens when
    // a person is sitting where the bot would have been. Only the player
    // currently holding the shared screen has a hand rail; the other public
    // count remains in their seat pod.
    expect(screen.getByLabelText("Player one's hand")).toBeTruthy();
    expect(screen.queryByLabelText("Player two's hand")).toBeNull();
    expect(
      within(screen.getByLabelText("Player two's status")).getByText('7', {
        selector: '[title="hand"]',
      }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Bot's hand")).toBeNull();
  });

  it('asks both people in turn, covering the table between them', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    fireEvent.click(screen.getByRole('button', { name: HOTSEAT_LABEL }));

    let handoffs = 0;
    for (let click = 0; click < 300 && handoffs < 3; click += 1) {
      const pass = screen.queryByRole('button', { name: /^I am Player/ });
      if (pass !== null) {
        // Nothing of either hand is readable by whoever is still holding it.
        expect(screen.queryByLabelText("Player one's hand")).toBeNull();
        expect(screen.queryByLabelText("Player two's hand")).toBeNull();
        handoffs += 1;
        fireEvent.click(pass);
      }
      const group = screen.queryByRole('group', { name: 'Legal moves' });
      if (group === null) break;
      const first = within(group).queryAllByRole('button')[0];
      if (first === undefined) break;
      fireEvent.click(first);
      expect(screen.queryByRole('alert')).toBeNull();
    }
    // Three passes back and forth is a game being played by two people rather
    // than a bot quietly answering for one of them.
    expect(handoffs).toBe(3);
  });

  /**
   * The mana base, by clicking.
   *
   * Every control is found by its accessible name rather than by class or
   * position, because a plus sign with no name is a button nobody using a
   * screen reader can tell from the four others beside it.
   */
  it('offers a basic of every color, each one named', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));

    expect(screen.getByRole('group', { name: MANA_BASE_LABEL })).toBeTruthy();
    for (const type of BASIC_LAND_TYPES) {
      expect(screen.getByRole('button', { name: addBasicLabel(type) })).toBeTruthy();
      expect(screen.getByRole('button', { name: cutBasicLabel(type) })).toBeTruthy();
    }
  });

  it('adds a land by clicking, and hands the computed base back', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    expect(factValue('lands')).toBe('17');

    fireEvent.click(screen.getByRole('button', { name: addBasicLabel('Mountain') }));
    expect(factValue('lands')).toBe('18');
    expect(factValue('deck')).toBe('41');
    // Forty-one cards is not a deck, so the game cannot start on one.
    expect(isDisabled('Play this deck')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: SUGGEST_BASICS_LABEL }));
    expect(factValue('lands')).toBe('17');
    expect(isDisabled('Play this deck')).toBe(false);
  });

  it('cannot cut a basic that is not there', () => {
    render(h(PlayRoute, { set: ready(SET), seed: SEED }));
    const missing = BASIC_LAND_TYPES.filter((type) => isDisabled(cutBasicLabel(type)));
    // The suggested build is two colors out of five, so some basic is at zero.
    expect(missing.length).toBeGreaterThan(0);
    expect(factValue('lands')).toBe('17');
  });

  it('explains itself when handed no set at all', () => {
    render(h(PlayRoute, { set: ready([]), sourceHint: 'generate one first' }));
    expect(screen.getByText('No game loaded')).toBeTruthy();
    expect(screen.getByText('generate one first')).toBeTruthy();
  });
});
