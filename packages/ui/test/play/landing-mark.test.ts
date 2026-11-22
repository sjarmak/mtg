// @vitest-environment jsdom
/**
 * The mark in the corner, pressed while a game is on.
 *
 * `MTG Lab` is a control, not a caption (`../../src/app/Shell.ts`), and what it
 * means is *take me to the Play tab's landing screen*. It could not say that,
 * because the two screens it has to get past are React state under an unchanged
 * `#/play`: a sealed build and a dealt precon table. Assigning a hash that is
 * already the hash fires no `hashchange`, so the press did nothing at all from
 * the sealed builder, and from a precon table it did something worse — `?deck=`
 * and `?against=` are real params and they cleared, so the bar named no game while
 * the game was still on screen.
 *
 * `../../src/app/router.ts` argues why the ask is a number (`landing`) rather
 * than a hash, and each screen-holding component reads it. This file is the
 * acceptance for both halves, pressed the way a person presses them: the mark
 * is found by its accessible name in the banner, the same way `../app.test.ts`
 * finds it.
 *
 * Both arms end on the chooser and neither loses anything. A precon table is
 * not kept — the two deck ids and the seed are what always survived a reload,
 * and the hash carries them — while a sealed build is, because every edit is
 * written to the stored session, so the chooser it lands on offers Resume.
 */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card, CardInput } from '@mtg/dsl';
import { EXAMPLE_CARDS, parseCard } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { parsePreconFile } from '@mtg/deckbuild';
import { App } from '../../src/app/App';
import type { UiView, UiViews } from '../../src/app/App';
import { hashSource } from '../../src/app/router';
import { PlayRoute } from '../../src/routes/PlayRoute';
import type { PlaySetState, PreconState } from '../../src/routes/PlayRoute';
import { PLAY_DECKS_LABEL } from '../../src/routes/play/PlayChooser';
import { PLAY_SEALED_LABEL } from '../../src/routes/play/SealedChooser';
import { PRECON_PLAY_LABEL } from '../../src/routes/play/PreconPicker';
import { LEGAL_MOVES_LABEL } from '../../src/routes/play/rail';
import { DECK_LABEL } from '../../src/routes/play/SealedBuilder';
import { clearSealedSession } from '../../src/routes/play/sealed-session';
import { generateSealed, offersResume } from '../support/play-chooser';

afterEach(() => {
  cleanup();
  // A build left in the store by one test is a Resume offer in the next one.
  clearSealedSession();
});

beforeEach(() => {
  clearSealedSession();
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = '#/play';
});

/**
 * Six invented creatures and two decks over them, the way `./precon.test.ts`
 * invents them: this layer knows nothing about any set, and a fixture borrowed
 * from one would be testing that set. Too thin to fill a booster, which is
 * fine — the sealed half of this file uses the DSL's example cards instead.
 */
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

function ready(cards: readonly Card[]): PlaySetState {
  return { status: 'ready', cards };
}

function readyPrecons(file: PreconFile): PreconState {
  return { status: 'ready', file };
}

/**
 * The whole app around one Play view, because the mark is drawn by the shell
 * and the number it moves is the router's. Rendering `PlayRoute` alone would
 * pin the reset and skip the press that asks for it.
 */
const ELSEWHERE: UiView = () => h('p', null, 'another tab');

function appWith(play: UiView): ReactElement {
  const views: UiViews = {
    play,
    customize: ELSEWHERE,
    cards: ELSEWHERE,
    analysis: ELSEWHERE,
  };
  return h(App, { views });
}

/** Presses `MTG Lab`, by the name a screen reader announces for it. */
function pressMark(): void {
  fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'MTG Lab, Play' }));
}

function onChooser(): boolean {
  return (
    screen.queryByRole('region', { name: PLAY_DECKS_LABEL }) !== null ||
    screen.queryByRole('region', { name: PLAY_SEALED_LABEL }) !== null
  );
}

describe('the mark, pressed from inside a game', () => {
  it('puts the chooser back over a dealt precon table', () => {
    render(
      appWith((router) =>
        h(PlayRoute, {
          set: ready(SET),
          precons: { state: readyPrecons(FILE) },
          landing: router.landing,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
    expect(onChooser()).toBe(false);

    pressMark();

    // The section's own chooser, which under Constructed is the decks: the
    // sealed offer is the Sealed section's and is not drawn here (`mtg-a982g.1`).
    expect(screen.getByRole('region', { name: PLAY_DECKS_LABEL })).toBeTruthy();
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: LEGAL_MOVES_LABEL })).toBeNull();
  });

  it('puts the chooser back over the sealed builder, and offers the build again', () => {
    render(
      appWith((router) =>
        h(PlayRoute, {
          sub: 'sealed',
          set: ready(EXAMPLE_CARDS),
          landing: router.landing,
        }),
      ),
    );
    generateSealed();
    // The builder, by the pane a person builds in. Which panes are drawn at
    // once is a width decision this environment does not make (jsdom lays out
    // nothing), and the deck is the one that is always on screen.
    expect(screen.getByRole('region', { name: DECK_LABEL })).toBeTruthy();
    expect(onChooser()).toBe(false);

    pressMark();

    expect(screen.getByRole('region', { name: PLAY_SEALED_LABEL })).toBeTruthy();
    expect(screen.queryByRole('region', { name: DECK_LABEL })).toBeNull();
    // Going back is not throwing the pool away. The builder wrote every edit to
    // the stored session, so the screen it lands on offers it back.
    expect(offersResume()).toBe(true);
  });

  /**
   * The counter is what the press moves, and nothing else may move it. A render
   * that happens for another reason — a set arriving, a parent re-rendering —
   * must leave a game alone, which is the failure a `key`-based remount would
   * have shipped instead.
   */
  it('leaves the table alone when the app re-renders for other reasons', () => {
    const view = render(
      appWith((router) =>
        h(PlayRoute, {
          set: ready(SET),
          precons: { state: readyPrecons(FILE) },
          landing: router.landing,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: PRECON_PLAY_LABEL }));
    view.rerender(
      appWith((router) =>
        h(PlayRoute, {
          set: ready(SET),
          precons: { state: readyPrecons(FILE) },
          landing: router.landing,
        }),
      ),
    );
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
    expect(onChooser()).toBe(false);
  });
});
