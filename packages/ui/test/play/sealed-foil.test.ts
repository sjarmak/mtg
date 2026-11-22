// @vitest-environment jsdom
/**
 * The sealed builder draws the foil its pool named, and only where one was named.
 *
 * `mtg-jpbv`, standing on `mtg-11yd`. That bead put provenance on the pool so a
 * foil stops arriving as an ordinary duplicate; this one spends it, and the
 * three things worth pinning are the three a later change could quietly undo.
 *
 *  1. **A pool that took no measurement publishes no answer.** `foilPositions`
 *     declines for a rarity recipe and for a collation that never stated the
 *     flag, and a face that drew `data-foil="false"` on such a pool would be
 *     asserting every copy is ordinary. Absent, not false.
 *  2. **A foil copy is its own face.** The pane collapses duplicate copies into
 *     one tile with a count on it, which is right while copies differ in
 *     nothing; a foil and an ordinary copy of one card differ, and collapsing
 *     them is `mtg-11yd`'s flattening reappearing one layer up.
 *  3. **The toggle only exists where there is something to toggle**, and turning
 *     it off gives back both the attribute and the collapse.
 *
 * jsdom performs no layout, so nothing here claims the sheen covers the art
 * window or sweeps across it. What it can say is which faces carry the overlay
 * and the attribute, which is the whole of what the pool decided;
 * `../../src/styles/card.ts` owns where the paint lands.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PackCollation } from '@mtg/deckbuild';
import { DECK_CARDS_LABEL, SEALED_POOL_LABEL, SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor, openSealed } from '../../src/routes/play/sealed';
import type { SealedBuild } from '../../src/routes/play/sealed';
import { FOIL_CONTROL_LABEL, FOIL_STORE_KEY } from '../../src/routes/play/foil-preference';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';

afterEach(cleanup);

/** One store serves the whole file, so each test starts on a browser that was never here. */
beforeEach(() => {
  const host = globalThis as {
    readonly localStorage?: { clear?: () => void; setItem?: (key: string, value: string) => void };
  };
  host.localStorage?.clear?.();
  // The deck pane only: these assertions concern its compact strips, not the
  // Limited panes' default view. The pool pane stays on its own default
  // (full cards), because the describe block below it is about the full-
  // density face's sheen and collapse -- `mtg-eeqnj` gave the pool a compact
  // strip too, and that behavior has its own describe block further down,
  // which sets the pool's density itself.
  host.localStorage?.setItem?.(deckViewStoreKey('limited-deck'), 'compact');
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

const SEED = 'lab/test/sealed-foil';

/**
 * A printing whose foil sheet is exactly its common sheet, over six cards.
 *
 * Deliberately narrow rather than realistic. Six packs deal twenty-four commons
 * and six foils off one six-card sheet, so every card in the pool is dealt both
 * ways and the overlap this file is about is a pigeonhole rather than a seed
 * that happened to cooperate. M11's own shape, where the foil sheet is the whole
 * set and nine packs in forty carry one, is measured in
 * `../../../deckbuild/test/provenance.test.ts`.
 */
function overlapping(set: readonly Card[]): PackCollation {
  const weights = Object.fromEntries(set.slice(0, 6).map((card) => [card.id, 1]));
  return {
    sheets: [
      { name: 'common', weights, foil: false },
      { name: 'foil', weights, foil: true },
    ],
    boosters: [{ contents: { common: 4, foil: 1 }, weight: 1 }],
  };
}

function mount(build: SealedBuild): Root {
  const { container } = render(
    h(SealedBuilder, {
      build,
      deck: deckFor(build),
      onToggle: () => undefined,
      onSuggest: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onPlay: () => undefined,
      contextNote: 'A sealed pool, mounted directly by a test.',
      seed: SEED,
      source: 'sealed' as const,
    }),
  );
  return container as unknown as Root;
}

/** The rendered tree, reached structurally: this workspace's tsconfig has no `lib: dom`. */
interface Root {
  readonly querySelectorAll: (query: string) => ArrayLike<unknown>;
}

/** One node, for the one question asked of an element rather than of the tree. */
interface Labeled {
  readonly getAttribute: (name: string) => string | null;
}

function faces(root: Root, selector: string): readonly unknown[] {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * How many faces the *pool* pane draws at full density, its default.
 *
 * The pool pane at full only: the deck pane draws strips at compact density
 * and a strip is a name bar rather than a card face, so it draws no
 * `.mtg-card` at all and a count of faces cannot reach it (`mtg-pmpu.1`). The
 * pool pane draws strips too since `mtg-eeqnj`, at its own compact density,
 * and that pane collapses nothing -- every position is already its own
 * strip, so there is no equivalent count to compute there; the describe block
 * further down measures that pane directly instead of through this function.
 * It answers the question a different way since `mtg-p3g5` for the deck pane
 * — a mark on the strip — and the describe block above the pool one measures
 * that.
 *
 * `foils` null asks the same question of a screen that is not drawing the
 * distinction, which is the toggle's off state.
 */
function expectedPoolFaces(build: SealedBuild, foils: ReadonlySet<number> | null): number {
  const chosen = new Set(build.chosen);
  const key = (index: number): string => {
    const card = build.pool[index];
    if (card === undefined) throw new Error('index outside the pool');
    return foils === null ? card.id : `${card.id}|${String(foils.has(index))}`;
  };
  const left = build.pool.flatMap((_, index) => (chosen.has(index) ? [] : [key(index)]));
  return new Set(left).size;
}

describe('a pool dealt off a printing that states its foil sheet', () => {
  function build(): SealedBuild {
    const set = loadSet();
    return openSealed(set, SEED, { collation: overlapping(set) });
  }

  it('names every face, and names some of them foil', () => {
    const opened = build();
    expect(opened.foils).not.toBeNull();
    expect(opened.foils?.length).toBeGreaterThan(0);
    const root = mount(opened);

    // Every face the builder drew answers the question, because the pool the
    // faces came out of answered it for every position.
    expect(faces(root, '.mtg-card').length).toBe(faces(root, '.mtg-card[data-foil]').length);
    expect(faces(root, '.mtg-card[data-foil="true"]').length).toBeGreaterThan(0);
    expect(faces(root, '.mtg-card[data-foil="false"]').length).toBeGreaterThan(0);
  });

  it('paints the sheen on exactly the faces it named foil', () => {
    const root = mount(build());

    expect(faces(root, '.mtg-card__sheen').length).toBe(faces(root, '.mtg-card[data-foil="true"]').length);
    expect(faces(root, '.mtg-card[data-foil="false"] .mtg-card__sheen')).toHaveLength(0);
  });

  it('draws a foil copy apart from an ordinary copy of the same card', () => {
    // Nothing chosen, because the pool pane is what draws faces and this
    // printing's whole point is that all six cards are dealt both ways: the
    // suggestion plays every one of them, so a pool pane behind a suggested
    // deck has nothing left to split. Emptying the deck puts the whole pool in
    // the pane under test and changes no fact about the printing.
    const opened = { ...build(), chosen: [] };
    const foils = new Set(opened.foils ?? []);
    const both = [...new Set(opened.pool.map((card) => card.id))].filter(
      (id) =>
        opened.pool.some((card, index) => card.id === id && foils.has(index)) &&
        opened.pool.some((card, index) => card.id === id && !foils.has(index)),
    );
    expect(both.length, 'this pool deals no card both ways').toBeGreaterThan(0);
    const root = mount(opened);

    // One face per card and foil answer rather than per card. The collapse still
    // holds within each half, so this is a split and not the pane giving up on
    // grouping: the count is exactly the number of distinct answers.
    expect(faces(root, '.mtg-card').length).toBe(expectedPoolFaces(opened, foils));
    expect(expectedPoolFaces(opened, foils)).toBeGreaterThan(expectedPoolFaces(opened, null));
  });

  it('offers the toggle, and gives back both the attribute and the collapse', () => {
    const opened = build();
    const root = mount(opened);

    fireEvent.click(screen.getByRole('button', { name: FOIL_CONTROL_LABEL }));

    // Off is a drawing decision and nothing more: the pool still knows which
    // copies are foil, and the screen has stopped saying so.
    expect(faces(root, '.mtg-card[data-foil]')).toHaveLength(0);
    expect(faces(root, '.mtg-card__sheen')).toHaveLength(0);
    expect(faces(root, '.mtg-card').length).toBe(expectedPoolFaces(opened, null));
    expect(opened.foils).not.toBeNull();
  });

  it('keeps the answer across a remount, under the key it stores it by', () => {
    mount(build());
    fireEvent.click(screen.getByRole('button', { name: FOIL_CONTROL_LABEL }));
    cleanup();

    const host = globalThis as {
      readonly localStorage?: { getItem?: (key: string) => string | null };
    };
    expect(host.localStorage?.getItem?.(FOIL_STORE_KEY)).toBe('off');
    // A second visit, which is what a reload is: the setting is read back from
    // the store rather than from the state the first mount left behind.
    const reopened = mount(build());
    expect(faces(reopened, '.mtg-card[data-foil]')).toHaveLength(0);
  });
});

describe('a pool dealt from what the card list prints', () => {
  it('publishes no answer at all, rather than answering every face "ordinary"', () => {
    const opened = openSealed(loadSet(), SEED);

    expect(opened.foils).toBeNull();
    const root = mount(opened);

    expect(faces(root, '.mtg-card').length).toBeGreaterThan(0);
    expect(faces(root, '.mtg-card[data-foil]')).toHaveLength(0);
    expect(faces(root, '.mtg-card__sheen')).toHaveLength(0);
  });

  it('offers no toggle, because both of its settings draw the same screen', () => {
    mount(openSealed(loadSet(), SEED));

    expect(screen.queryByRole('button', { name: FOIL_CONTROL_LABEL })).toBeNull();
  });
});

/**
 * The deck pane's strips, which are the whole of what that pane draws at the
 * density it opens in.
 *
 * Reached through the region's own accessible name rather than through
 * `.mtg-strips` alone, because the selector is a promise about this screen
 * having one such region and the label is a promise about *which* one. The
 * pool pane grew strips of its own at compact under `mtg-eeqnj`
 * (`poolStrips`, further down), so the scoped selector is what keeps the two
 * from being counted together.
 */
function deckStrips(root: Root, selector: string): readonly unknown[] {
  return Array.from(root.querySelectorAll(`.mtg-strips[aria-label="${DECK_CARDS_LABEL}"] ${selector}`));
}

/**
 * A foil copy is marked in the deck pane too, and marked in three channels.
 *
 * `mtg-p3g5`. The bead asked whether the deck pane should say it at all. What
 * decided it was that the pane already said it both ways: full density draws
 * faces and the face carries the sheen, compact draws bars and carried nothing,
 * so a view preference was changing what the pane claimed about the deck. It
 * says it, because `SealedBuild.foils` records which copy was played and the
 * battlefield face draws the sheen — with two copies of a card and one foil,
 * which one is in the deck decides what the player sees in the game.
 *
 * Three channels rather than one, and each is pinned separately here because
 * each fails on its own: the attribute is what a stylesheet reads, the star is
 * the carrier that is not a color, and the accessible name is the whole of what
 * a reader who sees neither gets. jsdom performs no layout, so nothing below
 * claims the wash lands anywhere; `../../src/styles/deck.ts` owns that.
 */
describe('a foil copy that has been played into the deck', () => {
  function build(): SealedBuild {
    const set = loadSet();
    return openSealed(set, SEED, { collation: overlapping(set) });
  }

  /** The played positions the pool measured as foil. The deck pane's subject. */
  function playedFoils(opened: SealedBuild): number {
    const foils = new Set(opened.foils ?? []);
    return opened.chosen.filter((index) => foils.has(index)).length;
  }

  it('marks each played foil, and says so on every strip rather than only the foil ones', () => {
    const opened = build();
    expect(playedFoils(opened), 'the suggestion played no foil out of this pool').toBeGreaterThan(0);
    const root = mount(opened);

    // Every strip answers, because the pool answered for every position. A
    // strip with no attribute at all would be the pane saying it does not know,
    // which here would be false.
    const strips = deckStrips(root, '.mtg-strips__card');
    expect(strips.length).toBe(opened.chosen.length);
    expect(deckStrips(root, '.mtg-strips__card[data-foil]').length).toBe(strips.length);
    expect(deckStrips(root, '.mtg-strips__card[data-foil="true"]').length).toBe(playedFoils(opened));
    expect(deckStrips(root, '.mtg-strips__card[data-foil="false"]').length).toBe(
      opened.chosen.length - playedFoils(opened),
    );
  });

  it('draws the star on exactly the strips it named foil, and speaks the word on them', () => {
    const opened = build();
    const root = mount(opened);

    expect(deckStrips(root, '.mtg-strips__foil').length).toBe(playedFoils(opened));
    expect(deckStrips(root, '.mtg-strips__card[data-foil="false"] .mtg-strips__foil')).toHaveLength(0);

    // The spoken channel, which is what a reader who cannot see the star gets.
    // Counted off the accessible name rather than off the markup, so a star
    // drawn with no word behind it fails here. Scoped to the deck pane, because
    // the pool pane's faces are buttons too and a page-wide count would pass on
    // a label the deck never spoke.
    const spoken = deckStrips(root, 'button.mtg-strips__card').filter((strip) => {
      const name = (strip as Labeled).getAttribute('aria-label');
      return name !== null && name.endsWith(', foil');
    });
    expect(spoken).toHaveLength(playedFoils(opened));
  });

  it('gives the marks back when the toggle is turned off', () => {
    const opened = build();
    const root = mount(opened);

    fireEvent.click(screen.getByRole('button', { name: FOIL_CONTROL_LABEL }));

    // Absent rather than `false`, which is the same distinction the faces draw:
    // the screen has stopped saying, not started saying every copy is ordinary.
    expect(deckStrips(root, '.mtg-strips__card').length).toBe(opened.chosen.length);
    expect(deckStrips(root, '.mtg-strips__card[data-foil]')).toHaveLength(0);
    expect(deckStrips(root, '.mtg-strips__foil')).toHaveLength(0);
    expect(opened.foils).not.toBeNull();
  });

  it('says nothing at all on a pool that measured nothing', () => {
    const opened = openSealed(loadSet(), SEED);
    const root = mount(opened);

    expect(opened.foils).toBeNull();
    expect(deckStrips(root, '.mtg-strips__card').length).toBeGreaterThan(0);
    expect(deckStrips(root, '.mtg-strips__card[data-foil]')).toHaveLength(0);
    expect(deckStrips(root, '.mtg-strips__foil')).toHaveLength(0);
  });
});

/** The pool pane's own strips, scoped the same way `deckStrips` scopes the deck's. */
function poolStrips(root: Root, selector: string): readonly unknown[] {
  return Array.from(root.querySelectorAll(`.mtg-strips[aria-label="${SEALED_POOL_LABEL}"] ${selector}`));
}

/**
 * A foil copy still sitting in the pool is marked on its strip too, once the
 * pool draws strips at all.
 *
 * `mtg-eeqnj` moved the pool pane onto `StripColumns` at compact, the same
 * component the deck pane already used, so the foil answer rides the same
 * `data-foil`/`.mtg-strips__foil`/accessible-name channels `mtg-p3g5` gave the
 * deck pane -- there is no second implementation of "how a strip says foil"
 * to keep in sync. What is worth pinning here and not inferable from the deck
 * pane's own tests is the one way the two panes differ: the pool never
 * collapses positions the way its full-density face does with `byCard`, foil
 * or not, because a strip is already a grabbable object per copy -- so the
 * strip count is the position count, unconditionally.
 */
describe('a foil copy still in the pool, drawn as a compact strip', () => {
  function build(): SealedBuild {
    const set = loadSet();
    return openSealed(set, SEED, { collation: overlapping(set) });
  }

  function mountCompactPool(opened: SealedBuild): Root {
    (
      globalThis as { readonly localStorage?: { setItem?: (key: string, value: string) => void } }
    ).localStorage?.setItem?.(deckViewStoreKey('limited-pool'), 'compact');
    return mount(opened);
  }

  it('draws one strip per unplayed position, whatever the card, with no picture', () => {
    const opened = build();
    const root = mountCompactPool(opened);

    const chosen = new Set(opened.chosen);
    const unplayed = opened.pool.length - chosen.size;
    expect(poolStrips(root, '.mtg-strips__card').length).toBe(unplayed);
    expect(poolStrips(root, '.mtg-card')).toHaveLength(0);
  });

  it('marks exactly the foil positions, apart from the ordinary ones', () => {
    const opened = build();
    const foils = new Set(opened.foils ?? []);
    const unplayedFoils = opened.pool.filter(
      (_, index) => foils.has(index) && !opened.chosen.includes(index),
    ).length;
    const unplayedOrdinary = opened.pool.filter(
      (_, index) => !foils.has(index) && !opened.chosen.includes(index),
    ).length;
    const root = mountCompactPool(opened);

    expect(poolStrips(root, '.mtg-strips__card[data-foil="true"]').length).toBe(unplayedFoils);
    expect(poolStrips(root, '.mtg-strips__card[data-foil="false"]').length).toBe(unplayedOrdinary);
    expect(poolStrips(root, '.mtg-strips__foil').length).toBe(unplayedFoils);
  });

  it('gives the marks back when the toggle is turned off, without changing the strip count', () => {
    const opened = build();
    const root = mountCompactPool(opened);
    const before = poolStrips(root, '.mtg-strips__card').length;

    fireEvent.click(screen.getByRole('button', { name: FOIL_CONTROL_LABEL }));

    expect(poolStrips(root, '.mtg-strips__card').length).toBe(before);
    expect(poolStrips(root, '.mtg-strips__card[data-foil]')).toHaveLength(0);
    expect(poolStrips(root, '.mtg-strips__foil')).toHaveLength(0);
  });

  it('says nothing at all on a pool that measured nothing', () => {
    const opened = openSealed(loadSet(), SEED);
    const root = mountCompactPool(opened);

    expect(opened.foils).toBeNull();
    expect(poolStrips(root, '.mtg-strips__card').length).toBeGreaterThan(0);
    expect(poolStrips(root, '.mtg-strips__card[data-foil]')).toHaveLength(0);
    expect(poolStrips(root, '.mtg-strips__foil')).toHaveLength(0);
  });
});
