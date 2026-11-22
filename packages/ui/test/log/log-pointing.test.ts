// @vitest-environment jsdom
/**
 * Pointing: a log line names an object, and the board says which one.
 *
 * `mtg-47o` and `mtg-exe`, which were one question wearing two hats. Two of one
 * seat's Gloom Hands are the same name on the board and the same name in the
 * log, and neither surface could say which was which. The decision recorded on
 * both beads is that the log *points* rather than that either surface prints an
 * identity mark: hovering or pressing the sentence lights the objects it names,
 * where the player is already looking.
 *
 * That makes three claims, and each has a block below.
 *
 *  - **The ids fall out of the sentence.** `../../src/log/group.ts` collects them
 *    by watching the names book the sentence is written with, so a line can only
 *    point at what it actually said. The alternative was a second exhaustive
 *    switch over `GameEvent`, which is two functions that can disagree about what
 *    an event names.
 *  - **A line that says nothing points at nothing.** A step passing is not a
 *    control, and neither is a line whose names this seat may not read: the
 *    redaction is per event (`../../src/log/visibility.ts`), so a redacted line
 *    has to come back with an empty list rather than with the ids behind the
 *    hidden names.
 *  - **The press reaches the board.** Which is the acceptance criterion in the
 *    bead's own terms: one of two identically named permanents lights and the
 *    other does not.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { PlayerId } from '@mtg/kernel';
import { botSeat, choose, createSession, FULL_CONTROL, humanSeat, simpleAgent } from '@mtg/kernel';
import { Battlefield } from '../../src/board/Battlefield';
import type { BoardPermanent } from '../../src/board/Battlefield';
import { GameLog } from '../../src/log/GameLog';
import { buildLog } from '../../src/log/group';
import type { LogLine, LogTurn } from '../../src/log/group';
import type { LogNames } from '../../src/log/narrate';
import { namesVisibleTo } from '../../src/log/visibility';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { twoHumanMirror } from '../support/two-human';
import { ownedName } from '../../src/routes/play/naming';
import { nameOf } from '../../src/routes/play/position';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const SEATS = ['You', 'Bot'] as const;

/** A whole game against a bot, so the events are the reducer's own. */
function playedGame(): ReturnType<typeof createSession> {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  let session = createSession(game.config.setup, [humanSeat('You'), botSeat(simpleAgent('Bot'))]);
  for (let step = 0; step < 10_000 && session.pending !== null; step += 1) session = choose(session, 0);
  return session;
}

const SESSION = playedGame();
const EVENTS = SESSION.events;

/** The names book a live surface builds: the game's own object table. */
const NAMES: LogNames = {
  player: (id: PlayerId): string => SEATS[id],
  card: (oid: string): string => nameOf(SESSION.state, oid),
  target: (oid: string): string => ownedName(SESSION.state, SEATS, oid),
};

function allLines(turns: readonly LogTurn[]): readonly LogLine[] {
  return turns.flatMap((turn) => turn.steps.flatMap((step) => step.lines));
}

const LINES = allLines(buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'everything' }));

/** The two node members these assertions read; the workspace tsconfig has no DOM lib. */
interface NodeLike {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
}

interface RootLike {
  readonly querySelectorAll: (selector: string) => ArrayLike<NodeLike>;
}

function nodes(root: unknown, selector: string): readonly NodeLike[] {
  return Array.from((root as RootLike).querySelectorAll(selector));
}

function attr(value: unknown, name: string): string | null {
  return (value as NodeLike).getAttribute(name);
}

describe('a line points at the objects its own sentence named', () => {
  it('names ids the game actually created, in the order the sentence says them', () => {
    const pointing = LINES.filter((line) => line.objects.length > 0);
    expect(pointing.length).toBeGreaterThan(20);
    for (const line of pointing) {
      for (const oid of line.objects) {
        // `nameOf` answers with the object's own name, and the sentence contains
        // it: that is what makes this the id *behind the words on screen* rather
        // than an id from somewhere else in the event.
        expect(line.text).toContain(nameOf(SESSION.state, oid));
      }
    }
  });

  it('lists an object once however many times the sentence says it', () => {
    for (const line of LINES) {
      expect(new Set(line.objects).size).toBe(line.objects.length);
    }
  });

  it('points at both ends of a sentence that has two', () => {
    // A source and a target are two different questions and lighting one of them
    // answers half. Any two-object line proves the book is watched on both of its
    // naming methods rather than only on `card`.
    expect(LINES.some((line) => line.objects.length > 1)).toBe(true);
  });

  it('points at nothing on a line this seat may not read', () => {
    const hidden = EVENTS.filter((event) => !namesVisibleTo(event, 0));
    expect(hidden.length).toBeGreaterThan(0);
    const hiddenAt = new Set(hidden.map((event) => EVENTS.indexOf(event)).filter((index) => index >= 0));
    const redacted = LINES.filter((line) => hiddenAt.has(line.index));
    expect(redacted.length).toBeGreaterThan(0);
    for (const line of redacted) expect(line.objects).toEqual([]);
  });
});

describe('a line that names an object is a control, and one that names none is not', () => {
  function showLog(onPoint?: (objects: readonly string[] | null) => void): unknown {
    const { container } = render(
      h(GameLog, {
        events: EVENTS,
        names: NAMES,
        viewer: 0,
        disclosure: { open: true, toggle: (): void => undefined },
        ...(onPoint === undefined ? {} : { onPoint }),
      }),
    );
    return container;
  }

  it('draws exactly the naming lines as buttons, and the rest as text', () => {
    const container = showLog((): void => undefined);
    const drawn = allLines(buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'story' }));
    const naming = drawn.filter((line) => line.objects.length > 0).length;
    expect(naming).toBeGreaterThan(0);
    expect(nodes(container, 'button.mtg-log__point').length).toBe(naming);
    expect(nodes(container, 'span.mtg-log__text').length).toBe(drawn.length - naming);
  });

  it('draws no controls at all for a surface that passes nowhere to point', () => {
    // A log on a surface with no board is the list of sentences it always was;
    // a control that answers a press with nothing is worse than no control.
    expect(nodes(showLog(), 'button.mtg-log__point').length).toBe(0);
    expect(nodes(showLog(), 'span.mtg-log__text').length).toBeGreaterThan(0);
  });

  it('is a toggle that says which line the reader latched, and clears on a second press', () => {
    const said: (readonly string[] | null)[] = [];
    const container = showLog((objects): void => {
      said.push(objects);
    });
    const [first, second] = nodes(container, 'button.mtg-log__point');
    if (first === undefined || second === undefined) throw new Error('expected two pointable lines');
    expect(attr(first, 'aria-pressed')).toBe('false');

    fireEvent.click(first);
    expect(attr(first, 'aria-pressed')).toBe('true');
    expect(said.at(-1)?.length).toBeGreaterThan(0);

    // A press elsewhere moves the latch rather than adding a second one.
    fireEvent.click(second);
    expect(attr(first, 'aria-pressed')).toBe('false');
    expect(attr(second, 'aria-pressed')).toBe('true');

    fireEvent.click(second);
    expect(attr(second, 'aria-pressed')).toBe('false');
    expect(said.at(-1)).toBeNull();
  });

  it('previews on hover and falls back to the latch rather than to nothing', () => {
    const said: (readonly string[] | null)[] = [];
    const container = showLog((objects): void => {
      said.push(objects);
    });
    const [first, second] = nodes(container, 'button.mtg-log__point');
    if (first === undefined || second === undefined) throw new Error('expected two pointable lines');
    fireEvent.click(first);
    const latched = said.at(-1);

    fireEvent.pointerOver(second);
    expect(said.at(-1)).not.toEqual(latched);
    // Coming off the previewed line leaves the reader where they put themselves,
    // not where the pointer last was.
    fireEvent.pointerOut(second);
    expect(said.at(-1)).toEqual(latched);
  });

  it('drops the latch when the line it is on leaves the screen', () => {
    const said: (readonly string[] | null)[] = [];
    const container = showLog((objects): void => {
      said.push(objects);
    });
    const [first] = nodes(container, 'button.mtg-log__point');
    if (first === undefined) throw new Error('expected a pointable line');
    fireEvent.click(first);
    expect(said.at(-1)).not.toBeNull();
    // Changing the level redraws the list, and a highlight that nothing on
    // screen explains is a stuck pixel as far as the reader can tell.
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    expect(said.at(-1)).toBeNull();
  });
});

describe('the board tells two of one name apart', () => {
  function guardian(): DslCard {
    const card = EXAMPLE_CARDS.find((entry) => entry.name === 'Thornhide Guardian');
    if (card === undefined) throw new Error('the DSL example set has no Thornhide Guardian');
    return card;
  }

  it('lights the pointed copy and leaves its twin alone', () => {
    const twins: readonly BoardPermanent[] = [
      { key: 'o1', card: guardian() },
      { key: 'o2', card: guardian() },
    ];
    const { container } = render(
      h(Battlefield, { label: 'Battlefield', permanents: twins, pointed: new Set(['o2']) }),
    );
    const lit = nodes(container, '.mtg-slot[data-pointed]');
    expect(lit.length).toBe(1);
    expect(attr(lit[0], 'data-permanent-key')).toBe('o2');
  });

  it('lights nothing when nobody is pointing', () => {
    const { container } = render(
      h(Battlefield, {
        label: 'Battlefield',
        permanents: [{ key: 'o1', card: guardian() }],
        pointed: new Set<string>(),
      }),
    );
    expect(nodes(container, '.mtg-slot[data-pointed]').length).toBe(0);
  });
});

describe('pressing a line in a played table lights the table', () => {
  it('reaches the board from the rail, and lets go of it', () => {
    const game = twoHumanMirror(EXAMPLE_CARDS);
    let session = createSession(game.setup, game.seats);
    const choices: number[] = [];
    while (session.pending !== null && choices.length < 120) {
      choices.push(0);
      session = choose(session, 0);
    }
    const { container } = render(h(PlayRoute, { config: { ...game, choices, autoPass: FULL_CONTROL } }));
    expect(nodes(container, '[data-permanent-key]').length).toBeGreaterThan(0);

    const buttons = nodes(container, 'button.mtg-log__point');
    expect(buttons.length).toBeGreaterThan(0);
    // Which sentence names a card still on the table is a fact about the game
    // that was played, not one this test may assume, so it presses until one
    // does and fails if none of them ever reaches the board.
    let pressed: NodeLike | null = null;
    for (const button of buttons) {
      fireEvent.click(button);
      if (nodes(container, '.mtg-slot[data-pointed]').length > 0) {
        pressed = button;
        break;
      }
    }
    if (pressed === null) throw new Error('no log line in this game pointed at a card on the table');
    fireEvent.click(pressed);
    expect(nodes(container, '.mtg-slot[data-pointed]').length).toBe(0);
  });
});

describe('the highlight is drawn on two channels and collides with no other state', () => {
  const CSS = uiStyleSheet();

  it('rings the pointed slot solidly where the aim reticle is dashed', () => {
    const ring = CSS.match(/\.mtg-slot\[data-pointed='true'\]::before \{[^}]*\}/)?.[0] ?? '';
    expect(ring).toContain('border: 2px solid');
    expect(ring).toContain('pointer-events: none');
    // Inside the border box, because ../zone.ts's overflow: auto clips anything
    // drawn outside it.
    expect(ring).toContain('inset: 0');
    const reticle = CSS.match(/\.mtg-slot:has\(> \.mtg-slot__marks[^{]*\)::after \{[^}]*\}/)?.[0] ?? '';
    expect(reticle).toContain('dashed');
  });

  it('lifts the face as its second channel, which a viewer who sees no color still reads', () => {
    expect(CSS).toMatch(/\.mtg-slot\[data-pointed='true'\] > \.mtg-card \{ scale:/);
  });

  it('takes the chrome off the line so a history still reads as a history', () => {
    const control = CSS.match(/\.mtg-log__point \{[^}]*\}/)?.[0] ?? '';
    expect(control).toContain('background: none');
    expect(control).toContain('border: 0');
    expect(control).toContain('text-align: left');
    expect(control).toContain('cursor: pointer');
    // The latched rail is a border on the line itself rather than a pseudo-element
    // precisely so that latching cannot change the box and reflow the column.
    expect(control).toContain('border-inline-start: 2px solid transparent');
    expect(CSS).toMatch(/\.mtg-log__point\[aria-pressed='true'\] \{[^}]*border-inline-start-color/);
  });
});
