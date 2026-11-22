// @vitest-environment jsdom
/**
 * A tapped card is read in the rail, and the player still owns the rail.
 *
 * `mtg-aqxi.1`. The reveal is the inspected card's key rather than a "show the
 * card" flag, and the difference is the whole design: a flag is true for as long
 * as a card is selected, so a player who then presses Log is pushed straight
 * back to Info by the next render. A key switches the section when it *changes*
 * and says nothing at all while it holds, which is what a person tapping a
 * second card means and is not what pressing Log means.
 *
 * The other half of the same bead is in the sheet rather than in the tree: on a
 * coarse pointer the played table's fixed zoom stands down, because the rail is
 * now the place a tapped card is read and two answers to one tap is one answer
 * too many. It stays for a fine pointer, where it costs nothing beside the
 * board, and it stays on every other surface — the Cards gallery has no rail to
 * hand the reading to.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS } from '@mtg/kernel';
import type { LogNames } from '../../src/log/narrate';
import { uiStyleSheet } from '../../src/styles';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { INFO_EMPTY, PlayRail } from '../../src/routes/play/PlayRail';

afterEach(cleanup);

const SEATS = ['You', 'Bot'] as const;
const NAMES: LogNames = {
  player: (id: PlayerId): string => SEATS[id] ?? 'Someone',
  card: (oid: string): string => oid,
  target: (oid: string): string => oid,
};

function session(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const opened = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
  return opened.pending?.kind === 'mulligan' ? choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS }) : opened;
}

function card(at: number): DslCard {
  const found = EXAMPLE_CARDS[at];
  if (found === undefined) throw new Error('the example set is too short');
  return found;
}

function rail(key: string, at: number): { readonly rerender: (key: string, at: number) => void } {
  const played = session();
  const props = (k: string, i: number): Parameters<typeof PlayRail>[0] => ({
    entries: [],
    events: played.events,
    names: NAMES,
    viewer: 0,
    inspected: { key: k, card: card(i), art: null },
    reveal: k,
  });
  const view = render(h(PlayRail, props(key, at)));
  return { rerender: (k: string, i: number): void => view.rerender(h(PlayRail, props(k, i))) };
}

describe('the rail reads the card a finger reached for', () => {
  it('opens on the inspected card when a reveal arrives', () => {
    rail('k1', 0);
    expect(screen.queryByText(INFO_EMPTY)).toBeNull();
    expect(screen.queryAllByText(card(0).name).length).toBeGreaterThan(0);
  });

  it('follows the finger to the next card', () => {
    const view = rail('k1', 0);
    view.rerender('k2', 1);
    expect(screen.queryAllByText(card(1).name).length).toBeGreaterThan(0);
  });

  it('leaves the log up when the player chose the log and the selection has not moved', () => {
    const view = rail('k1', 0);
    fireEvent.click(screen.getByRole('button', { name: /^Log/ }));
    view.rerender('k1', 0);
    expect(screen.queryAllByText(card(0).name).length).toBe(0);
  });
});

describe('the played table hands the reading to the rail on a coarse pointer', () => {
  it('stands the fixed zoom down there and nowhere else', () => {
    const sheet = uiStyleSheet();
    // The unconditional rules stay: a fine pointer keeps the hover zoom, and so
    // does every surface that is not the played table.
    expect(sheet).toContain('.mtg-slot:focus-within > .mtg-zoom { display: block; }');
    // Scoped to the board rather than to .mtg-play, which the sealed builder's
    // root also carries: that screen is card faces with no rail beside them.
    expect(sheet).toContain('.mtg-board .mtg-slot:focus-within > .mtg-zoom { display: none; }');
  });
});
