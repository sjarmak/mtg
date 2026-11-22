// @vitest-environment jsdom
/**
 * The side rail carries three sections instead of one: the stack in detail, the
 * inspected card, and the history.
 *
 * `mtg-aqxi.2`. The rail was the log and nothing else, so the two questions a
 * player asks mid-decision that are not "what happened" — what is about to
 * resolve, and what does this card actually say — had nowhere in the column to
 * be answered. Both are answered by covering the board today, which is the thing
 * the landscape-phone epic exists to stop.
 *
 * It is built on `../../src/panel/ContextRail.ts` rather than beside it, which is
 * what that component's docblock predicted: three surfaces wanted the same
 * furniture and this is the second to take it.
 *
 * # The stack is drawn twice and announced once
 *
 * `../../src/board/StackZone.ts`'s strip stays on the seam, and it is complete:
 * one labeled group, in resolution order, each entry naming its controller and
 * its target, with the resolve control on the top entry. A second list in this
 * rail with the same contents would be read as a second stack — the hazard the
 * bead names outright.
 *
 * So the rail's copy is `aria-hidden`, exactly as `../../src/card/ZoomPanel.ts`
 * is: it holds no control of its own, adds no fact the strip does not carry, and
 * exists because the strip spends width and ellipsizes under a deep stack while
 * this column has height to spend. The sentence above it says where the spoken
 * one is, so nothing about the arrangement is hidden from a reader who wants it.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS } from '@mtg/kernel';
import type { StackItem } from '../../src/board/StackZone';
import { GAME_LOG_LABEL } from '../../src/log/GameLog';
import type { LogNames } from '../../src/log/narrate';
import { dealMirrorGame } from '../../src/routes/play/deal';
import {
  INFO_EMPTY,
  PLAY_RAIL_LABEL,
  PlayRail,
  STACK_ELSEWHERE,
  STACK_EMPTY,
} from '../../src/routes/play/PlayRail';

afterEach(cleanup);

/**
 * The two structural readings this file needs, spelled out because the workspace
 * tsconfig has no `lib: dom` — the same reason `./rail-split.test.ts` declares
 * its own element shape rather than importing one.
 */
interface NodeLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => NodeLike | null;
}

function text(node: unknown): string {
  return (node as NodeLike).textContent ?? '';
}

function query(root: unknown, selector: string): NodeLike {
  const found = (root as NodeLike).querySelector(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

const SEATS = ['You', 'Bot'] as const;

/** The log's naming seam, at its simplest: no board, so no object has a name. */
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

function entries(): readonly StackItem[] {
  const card = EXAMPLE_CARDS[0];
  if (card === undefined) throw new Error('the example set is empty');
  return [{ key: 'e1', card, controller: 'You', targetLabel: 'Bot' }];
}

function rail(stack: readonly StackItem[] = []): void {
  const played = session();
  render(h(PlayRail, { entries: stack, events: played.events, names: NAMES, viewer: 0 }));
}

describe('the play rail is a tabbed context panel', () => {
  it('opens on the log, which is what the rail was before it had tabs', () => {
    rail();
    // The log's named region, which is the panel rather than the section around
    // it: `../../src/log/GameLog.ts` leaves the outer element unnamed on purpose,
    // so a landmark is not nested inside a landmark of the same name.
    expect(screen.queryByRole('region', { name: GAME_LOG_LABEL })).not.toBeNull();
  });

  it('offers all three sections whether or not they hold anything', () => {
    rail();
    for (const name of ['Stack', 'Info', 'Log']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).not.toBeNull();
    }
  });

  it('counts the stack on its control and says so when it is empty', () => {
    rail(entries());
    const control = screen.getByRole('button', { name: /^Stack/ });
    // The count is drawn beside the name, in its own span (`ContextRail`), and
    // read structurally: this workspace has no `lib: dom`.
    expect(text(control)).toContain('1');
    fireEvent.click(control);
    expect(screen.queryByText(STACK_ELSEWHERE)).not.toBeNull();

    cleanup();
    rail();
    fireEvent.click(screen.getByRole('button', { name: /^Stack/ }));
    expect(screen.queryByText(STACK_EMPTY)).not.toBeNull();
  });

  it('holds an info section that waits for a card', () => {
    rail(entries());
    fireEvent.click(screen.getByRole('button', { name: /^Info/ }));
    expect(screen.queryByText(INFO_EMPTY)).not.toBeNull();
  });

  /**
   * The rule the bead names: the rail draws the stack, and the accessible tree
   * gains no second copy of it. The strip on the seam is not rendered by this
   * component at all, so what is asserted here is the half this component owns —
   * its own list is hidden, and the region around it is still named.
   */
  it('draws the stack without announcing a second one', () => {
    rail(entries());
    fireEvent.click(screen.getByRole('button', { name: /^Stack/ }));
    expect(screen.queryAllByRole('group', { name: 'Stack' }).length).toBe(1);
    const list = query(screen.getByRole('region', { name: PLAY_RAIL_LABEL }), '.mtg-rail-stack');
    expect(list.getAttribute('aria-hidden')).toBe('true');
    expect(list.querySelector('button')).toBeNull();
  });

  it('names the rail as a whole', () => {
    rail();
    expect(screen.queryByRole('region', { name: PLAY_RAIL_LABEL })).not.toBeNull();
  });
});
