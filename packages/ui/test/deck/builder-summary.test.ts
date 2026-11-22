// @vitest-environment jsdom
/**
 * What the deck editor says about the deck it is holding, in the two places it
 * says it, and why every dark control on it names its own reason.
 *
 * `mtg-dcxg.7`, 2026-08-23. The screen carried two counts of the same deck: a
 * monospace strip reading `cards 24/60  spells 0/36  creatures 0  lands 24`
 * over a deck pane headed `Your deck · 0 cards · 0 creatures · 0 spells`. Both
 * were arithmetically right and they counted different piles, which a reader
 * cannot see. Commit `2736c335` fixed the same family of defect on the precon
 * tile the day before, and its rule is the one asserted here: the parts sum to
 * the total, the nouns do not overlap, and every surface counting this deck
 * reads one function.
 *
 * The other three assertions are the rest of the bead: the route names the deck
 * rather than the tab, a disabled control says what it is waiting for, and the
 * empty pane no longer sends somebody *beside this pane* on a phone where the
 * pool is below it.
 *
 * `mtg-aqxi.21`, 2026-09-04. The Sealed builder is the same editor on a dealt
 * pool and the fix above never reached it: its bar still carried seven
 * monospace counters, two of them the strings the rule names outright --
 * `spells 0/23`, a ratio against a target no other line on that screen knows,
 * and `colors none`, which reads as a field that failed to fill -- over a deck
 * pane printing its own creature/noncreature split. Both surfaces are asserted
 * here rather than in two files, because one rule kept in two places is how the
 * two came to disagree in the first place.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { BUILD_LABEL, DeckRoute, NEW_DECK_TITLE, builderTitle } from '../../src/routes/DeckRoute';
import {
  CLEAR_DECK_LABEL,
  ConstructedBuilder,
  DECK_LABEL,
  EMPTY_DECK_NOTE,
  PLAY_LABEL,
} from '../../src/routes/deck/ConstructedBuilder';
import { blockedNotes, clearBlocked, playBlocked } from '../../src/routes/deck/blocked';
import {
  builderCounts,
  builderCountsLine,
  deckColorsNote,
  poolPaneNote,
} from '../../src/routes/deck/deck-counts';
import { addCopy, chosenCards, deckFor, emptyBuild, selectable } from '../../src/routes/deck/build';
import type { ConstructedBuild } from '../../src/routes/deck/build';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { chosenCards as sealedCards, deckFor as sealedDeck, openSealed } from '../../src/routes/play/sealed';

afterEach(cleanup);
afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
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

const SET = loadSet();

/** A build holding a few real cards, so the partition has something to split. */
function withCards(copies: number): ConstructedBuild {
  const pool = selectable(SET).slice(0, copies);
  return pool.reduce((build, card) => addCopy(build, card.id), emptyBuild(SET));
}

function builderWith(build: ConstructedBuild): void {
  render(
    h(ConstructedBuilder, {
      build,
      deck: deckFor(build),
      onAdd: () => undefined,
      onCut: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onLoad: () => undefined,
      onPlay: () => undefined,
    }),
  );
}

interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly hasAttribute: (name: string) => boolean;
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.hasAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

describe('counting the deck being built', () => {
  it('splits it into three piles that sum to the deck itself', () => {
    for (const copies of [0, 1, 7]) {
      const build = withCards(copies);
      const counts = builderCounts(chosenCards(build), deckFor(build));
      expect(
        counts.creatures + counts.spells + counts.lands,
        `a ${String(copies)}-card build does not sum to its own deck`,
      ).toBe(counts.cards);
    }
  });

  it('says it once, in the deck pane, and not again in the toolbar', () => {
    const build = withCards(5);
    builderWith(build);
    const line = builderCountsLine(builderCounts(chosenCards(build), deckFor(build)));
    // `mtg-84703`. It used to be said twice, which is what `mtg-dcxg.7` above
    // settled: the two counts had to agree. the playtester then read the pair and
    // asked for the space back -- "the '40 of 40 cards · 14 creatures ...'
    // doesnt need to be at the top it's fine to include next ot the Your deck
    // portion only" -- so the agreement is now kept by there being one.
    expect(screen.getAllByText(line).length, 'the deck count is drawn twice again').toBe(1);
  });

  it('states no ratio of a target the deck pane does not know about', () => {
    builderWith(withCards(3));
    // The strip's own labels, which were the telemetry: a bare `spells` beside a
    // `0/36` is the log line this screen used to print.
    expect(screen.queryByText('spells'), 'the monospace fact strip is still drawn').toBeNull();
    expect(screen.queryByText('colors'), 'the monospace fact strip is still drawn').toBeNull();
  });

  it('names the colors in words, including when there are none', () => {
    expect(deckColorsNote([])).toBe('No colors yet');
    expect(deckColorsNote(['W'])).toBe('Colors: white');
    expect(deckColorsNote(['W', 'U', 'B'])).toBe('Colors: white, blue and black');
  });
});

describe('a control that refuses to be pressed', () => {
  it('carries its reason and repeats it under the row', () => {
    const build = emptyBuild(SET);
    const deck = deckFor(build);
    const playReason = playBlocked(deck);
    const clearReason = clearBlocked(0);
    if (playReason === null || clearReason === null) throw new Error('an empty deck is not playable');
    builderWith(build);
    for (const [label, reason] of [
      [CLEAR_DECK_LABEL, clearReason],
      [PLAY_LABEL, playReason],
    ] as const) {
      const control = asElement(screen.getByRole('button', { name: label }));
      expect(control.hasAttribute('disabled'), `${label} is not the dark control under test`).toBe(true);
      expect(control.getAttribute('title'), `${label} is dark and says nothing about why`).toBe(reason);
    }
    for (const note of blockedNotes([
      { label: CLEAR_DECK_LABEL, reason: clearReason },
      { label: PLAY_LABEL, reason: playReason },
    ])) {
      expect(screen.getByText(note), 'the reason is not on screen').toBeTruthy();
    }
  });

  it('names two controls held by one reason in one sentence rather than two', () => {
    const notes = blockedNotes([
      { label: CLEAR_DECK_LABEL, reason: 'a reason' },
      { label: PLAY_LABEL, reason: 'a reason' },
    ]);
    expect(notes).toEqual([`${CLEAR_DECK_LABEL} and ${PLAY_LABEL} are waiting: a reason`]);
  });
});

describe('the empty deck pane', () => {
  it('names the pool rather than pointing beside a pane the phone stacks', () => {
    expect(EMPTY_DECK_NOTE).not.toContain('beside');
    builderWith(emptyBuild(SET));
    expect(screen.getByText(EMPTY_DECK_NOTE), 'the empty pane says nothing').toBeTruthy();
    expect(screen.getByLabelText(DECK_LABEL), 'the deck pane lost its name').toBeTruthy();
  });
});

describe('the heading over the editor', () => {
  it('is the deck when one is open and a new deck when none is', () => {
    expect(builderTitle(null)).toBe(NEW_DECK_TITLE);
    expect(builderTitle('Wield the Obliterator')).toBe('Wield the Obliterator');
  });

  it('stops being the name of the tab as soon as the builder opens', () => {
    render(h(DeckRoute, { state: { status: 'absent' as const }, cards: SET }));
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const heading = screen.getByRole('heading', { level: 1 }) as unknown as {
      readonly textContent: string | null;
    };
    expect(heading.textContent, 'the editor is still titled with the tab it is on').toBe(NEW_DECK_TITLE);
  });
});

const SEALED_SEED = 'lab/test/builder-summary';

/** The sealed screen on a dealt pool, whose suggested selection is already a deck. */
function sealedBuilderWith(): { readonly pool: number; readonly deck: number } {
  const build = openSealed(SET, SEALED_SEED);
  render(
    h(SealedBuilder, {
      build,
      deck: sealedDeck(build),
      onToggle: () => undefined,
      onSuggest: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onPlay: () => undefined,
      contextNote: 'Six packs, one deck to build.',
      seed: SEALED_SEED,
      source: 'sealed' as const,
    }),
  );
  return { pool: build.pool.length, deck: sealedCards(build).length };
}

describe('counting the sealed deck being built', () => {
  it('says it once, in the deck pane, and not again in the bar', () => {
    const build = openSealed(SET, SEALED_SEED);
    const line = builderCountsLine(builderCounts(sealedCards(build), sealedDeck(build)));
    sealedBuilderWith();
    // `mtg-84703`, the same reclaim as the Constructed arm above. One editor,
    // one rule, and the bar is where the room was.
    expect(screen.getAllByText(line).length, 'the deck count is drawn twice again').toBe(1);
  });

  it('splits it into three piles that sum to the deck itself', () => {
    const build = openSealed(SET, SEALED_SEED);
    const counts = builderCounts(sealedCards(build), sealedDeck(build));
    expect(counts.creatures, 'a suggested sealed deck with no creatures is not the subject').toBeGreaterThan(
      0,
    );
    expect(counts.creatures + counts.spells + counts.lands, 'the sealed deck does not sum to itself').toBe(
      counts.cards,
    );
  });

  it('states no ratio of a target the deck pane does not know about', () => {
    sealedBuilderWith();
    // The seven monospace labels the bar used to carry. `spells` and `colors`
    // are the two the rule names; `creatures` and `noncreature spells` are the
    // split the deck pane was making a second time a pane away.
    for (const label of ['pool', 'spells', 'creatures', 'noncreature spells', 'lands', 'deck', 'colors']) {
      expect(screen.queryAllByText(label), `the monospace fact strip still draws ${label}`).toHaveLength(0);
    }
  });

  it('keeps the one fact that belongs to the pool, at the head of the pool', () => {
    const { pool, deck } = sealedBuilderWith();
    // Two populations on one line, because they are only checkable together:
    // the pool less what is not in the deck is what the deck's own sentence
    // counts as spells.
    expect(
      screen.getByText(poolPaneNote(pool, pool - deck)),
      'the pool pane no longer says how big the pool is',
    ).toBeTruthy();
    // `mtg-84703` drew the colors as pips rather than as words -- "no need to
    // put White , Blue , Black etc text labels but just a small indicator of the
    // count for each color would be sufficient" -- so the sentence is what the
    // row is *called* rather than what it prints. See `../../src/routes/deck/DeckColors.ts`.
    expect(
      screen.getByLabelText(deckColorsNote(sealedDeck(openSealed(SET, SEALED_SEED)).colors)),
      'the deck colors are no longer named to a screen reader',
    ).toBeTruthy();
  });
});
