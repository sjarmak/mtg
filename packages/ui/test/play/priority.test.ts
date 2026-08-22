// @vitest-environment jsdom
/**
 * Priority, on the surface a person reads, and where it went (`mtg-crw`).
 *
 * Priority was already on this table as a `Priority` badge in each seat's status
 * strip, and a badge is a marker rather than a statement. `mtg-bz2.4` answered
 * that with a sentence in a band at the foot of the table, beside the fixed
 * pass. the playtester, 2026-08-14, asked for the band back: "we can get rid of the
 * large 'you have priority pass' button area at the bottom now that we have the
 * pass button on the left".
 *
 * So the visible sentence is gone and the *announcement* is not, and this file
 * is where that distinction is held. The ask column already prints who is being
 * asked, in a fuller sentence (`prompt.ts`'s `explainFor`), under a headline
 * that reads `Priority`; a second copy of it two inches below was the thing
 * `mtg-1th` had to keep in agreement. What no visible panel can do is *announce*
 * a change, because `.mtg-prompt__explain` is ordinary text a reader passes
 * once — so the `role="status"` region survives, saying the holder, the depth
 * and the step, in the seat's own label.
 *
 * One clause is still drawn: `HELD_OVER_YOUR_OWN`. The ask column says a seat
 * may respond and never says the object on top is *theirs*, which is the whole
 * of "you may answer your own spell".
 *
 * ## The four named live regions
 *
 * The played table carries four `role="status"` regions: the phase bar's
 * `Stop changes`, the log's `Newest log entry`, and this file's two. Two lanes
 * of this epic already collided by each adding an unnamed one, and the fix was
 * to name both rather than to narrow the query — so one test below asserts the
 * property directly: every status region on this table has a name, and no two
 * share one.
 *
 * ## Measured in a browser, because jsdom lays nothing out
 *
 * The pass's promise is that it does not move, and that is geometry this file
 * cannot check. `../../tools/priority-stack.ts` writes the real page and
 * `window.mtgPriorityStack()` reads it; driven in chrome-headless-shell
 * 151.0.7922.47 over CDP at 1440x900, 1280x800, 1024x768 and 810x1080, on a
 * position with two objects on the stack, the pass is in the `pods` column and
 * fully inside the viewport at every one of them, with the page overflowing at
 * none. What the move bought the board is in `src/styles/board/rail.ts`.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState } from '@mtg/kernel';
import {
  DEFAULT_AUTO_PASS,
  holdsOwnTopOfStack,
  humanSeat,
  legalActions,
  passIndex,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { GAME_LOG_STATUS_LABEL } from '../../src/log/GameLog';
import { PHASE_BAR_STATUS_LABEL } from '../../src/routes/play/PhaseBar';
import {
  HELD_OVER_YOUR_OWN,
  PASS_KEY_STATUS_LABEL,
  PASS_LABEL,
  PlayView,
  PRIORITY_LABEL,
  PRIORITY_STATUS_LABEL,
} from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];

const MOUNTAIN = basicLand('Mountain', 'XMP', 250);

const BOLT: Card = parseCard({
  kind: 'instant',
  id: 'xmp-shock-arrow',
  name: 'Shock Arrow',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 100 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
});

/** Four Mountains and two bolts, so a cast still leaves an answer in hand. */
function openState(): GameState {
  return scenario({
    battlefield: Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[BOLT, BOLT], []],
  }).state;
}

function afterOneCast(): GameState {
  const state = openState();
  const cast = legalActions(state).find((action) => action.type === 'castSpell');
  if (cast === undefined) throw new Error('the fixture has nothing to cast');
  return reduce(state, cast).state;
}

function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/**
 * What a sighted player reads, which is the text with the announcement regions
 * taken out.
 *
 * jsdom's `textContent` cannot tell a visually hidden live region from a
 * printed line, and after `mtg-crw` that is exactly the distinction under test:
 * the holder sentence is announced and no longer drawn. So the two are separated
 * here rather than by trusting one string to answer both questions.
 */
function shownText(node: unknown): string {
  const host = node as { querySelectorAll(selector: string): ArrayLike<unknown> };
  const hidden = [...Array.from(host.querySelectorAll('.mtg-sr-only'))].map(textOf);
  return hidden.reduce((said, part) => said.replace(part, ''), textOf(node));
}

function closest(node: unknown, selector: string): unknown {
  return (node as { closest(selector: string): unknown }).closest(selector);
}

function renderAt(
  state: GameState,
  viewer: 0 | 1,
  onChoose: (choice: Choice) => void = () => undefined,
): void {
  render(h(PlayView, { session: sessionAt(state), viewer, names: NAMES, onChoose }));
}

function bar(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: PRIORITY_LABEL });
}

describe('priority, announced rather than printed twice', () => {
  it('names the seat that holds priority, in the words that seat is called', () => {
    // `mtg-1th`: the announcement reads the label rather than comparing the
    // holder to the viewer, and on an ordinary table those agree by construction
    // — the near seat is called `You`, so this sentence is what it always was.
    renderAt(openState(), 0);
    expect(textOf(bar())).toContain('You have priority');
  });

  /**
   * `mtg-crw`. The sentence is announced and not drawn, and the drawn copy is
   * the one that went: the ask column above says the same thing in more words,
   * and two statements of one fact a hand's width apart is what `mtg-1th` had to
   * keep in agreement. A test that only read `textContent` would pass either
   * way, which is why `shownText` exists.
   */
  it('prints the holder nowhere a sighted player reads, and says it in the ask column', () => {
    const state = openState();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    renderAt(state, 0);
    expect(shownText(bar())).not.toContain('has priority');
    expect(shownText(bar())).not.toContain('have priority');
    expect(shownText(bar())).not.toContain('the stack is empty');
    // And the fact is still on the screen, one block up, where it always was.
    expect(buildPrompt(state, decision, NAMES).explain).toContain('You may act');
    expect(textOf(closest(screen.getByRole('group', { name: 'Legal moves' }), '.mtg-prompt'))).toContain(
      'You may act',
    );
  });

  it('names the other seat by name when priority is theirs', () => {
    // The board follows the seat being asked, so the viewer is the one holding
    // priority in an ordinary game; this is the position the handoff card sits
    // in front of, and the bar has to read correctly from either side of it.
    const state = reduce(openState(), { type: 'passPriority', player: 0 }).state;
    expect(state.turn.priority).toBe(1);
    renderAt(state, 0);
    expect(textOf(bar())).toContain(`${NAMES[1]} has priority`);
    expect(textOf(bar())).not.toContain('You have priority');
  });

  /**
   * `mtg-1th`. The bug was two sentences on one screen about one seat at one
   * moment: the ask column said `Player two may act, or pass and move the game
   * on.` and the bar under it said `You have priority`, because the column
   * decided at the label and the bar decided at the seat id. On a hotseat table
   * neither seat is second person, so only one of those can be right.
   */
  it('agrees with the ask column on a hotseat table, where neither seat is you', () => {
    const hotseat: SeatNames = ['Player one', 'Player two'];
    const state = reduce(openState(), { type: 'passPriority', player: 0 }).state;
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    expect(state.turn.priority).toBe(1);
    // Drawn for the seat being asked, which is what a hotseat game does: the
    // session stops in front of whoever owes the next decision.
    render(h(PlayView, { session: sessionAt(state), viewer: 1, names: hotseat, onChoose: () => undefined }));
    const asked = buildPrompt(state, decision, hotseat).explain;
    expect(asked).toContain('Player two may act');
    expect(textOf(bar())).toContain('Player two has priority');
    // The whole surface, not just the two strings: no second person survives
    // anywhere on a table with no seat by that name.
    expect(textOf(bar())).not.toMatch(/\byou\b/i);
  });

  it('says how deep the stack is while nothing of yours is on top', () => {
    renderAt(openState(), 0);
    expect(textOf(bar())).toContain('the stack is empty');
    expect(textOf(bar())).not.toContain(HELD_OVER_YOUR_OWN);
  });

  it('holds the four named status regions apart', () => {
    // The full strip, because the phase bar's region is drawn only for a caller
    // that owns the settings, and this is the collision that has to be ruled out
    // on the table a player actually gets.
    render(
      h(PlayView, {
        session: sessionAt(openState()),
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    );
    const regions = screen.getAllByRole('status');
    const names = regions.map((region) =>
      (region as { getAttribute(name: string): string | null }).getAttribute('aria-label'),
    );
    expect(names).toHaveLength(4);
    expect(new Set(names).size, 'two status regions share a name').toBe(4);
    expect(names).toContain(PRIORITY_STATUS_LABEL);
    expect(names).toContain(PHASE_BAR_STATUS_LABEL);
    expect(names).toContain(GAME_LOG_STATUS_LABEL);
    // The fourth is `mtg-s9p`'s: the pass key answers for itself when it has no
    // pass to spend, and it answers in a region of its own rather than in the
    // running commentary above it.
    expect(names).toContain(PASS_KEY_STATUS_LABEL);
  });

  it('announces the holder, the stack and the step, with no serial number', () => {
    renderAt(openState(), 0);
    const region = screen.getByRole('status', { name: PRIORITY_STATUS_LABEL });
    const said = textOf(region);
    expect(said).toContain('You have priority');
    expect(said).toContain('the stack is empty');
    expect(said).toContain('main phase');
  });
});

describe('holding priority over your own spell', () => {
  it('is a position the kernel hands back, and the bar says so', () => {
    const state = afterOneCast();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    // CR 117.3c: the caster keeps priority, and the top of the stack is theirs.
    expect(state.turn.priority).toBe(0);
    expect(holdsOwnTopOfStack(state, decision)).toBe(true);

    renderAt(state, 0);
    expect(textOf(bar())).toContain('You have priority');
    expect(textOf(bar())).toContain(HELD_OVER_YOUR_OWN);
    expect(textOf(screen.getByRole('status', { name: PRIORITY_STATUS_LABEL }))).toContain(HELD_OVER_YOUR_OWN);
  });

  it('leaves the answer on the move list rather than only in a sentence', () => {
    // The claim the sentence makes has to be true of the enumeration too: the
    // second bolt is castable in response to the first, which is the whole of
    // "you may respond to it".
    const state = afterOneCast();
    renderAt(state, 0);
    const moves = screen.getByRole('group', { name: 'Legal moves' });
    expect(within(moves).getAllByRole('button').length).toBeGreaterThan(1);
    expect(textOf(moves)).toContain(BOLT.name);
  });

  it('says nothing of the sort while the top of the stack is not yours', () => {
    // Priority passed to the other seat over the same stack: the object on top
    // is still player 0's, but the seat being asked is player 1, so the clause
    // belongs to nobody on screen.
    const passed = reduce(afterOneCast(), { type: 'passPriority', player: 0 }).state;
    renderAt(passed, 1);
    // Drawn for seat 1, which this table calls `Bot`, so that is what the bar
    // calls it (`mtg-1th`). It said `You have priority` here until the ask
    // column two inches above it started saying `Bot may act` at the same
    // moment, on a hotseat table where neither seat is second person.
    expect(textOf(bar())).toContain(`${NAMES[1]} has priority`);
    expect(textOf(bar())).not.toContain('You have priority');
    expect(textOf(bar())).not.toContain(HELD_OVER_YOUR_OWN);
    expect(textOf(bar())).toContain('1 object on the stack');
  });
});

describe('the pass, still where it was', () => {
  it('stays out of the move list and out of the rail', () => {
    renderAt(openState(), 0);
    const button = screen
      .getAllByRole('button', { name: PASS_LABEL })
      .filter((node) => closest(node, '.mtg-play__pass') !== null)[0];
    expect(button).toBeDefined();
    expect(closest(button, '.mtg-choices')).toBeNull();
    expect(closest(button, '.mtg-board__rail')).toBeNull();
    expect(closest(button, '.mtg-play__table')).not.toBeNull();
    expect(closest(button, '.mtg-priority')).not.toBeNull();
    // And the whole block is in the ask column since `mtg-crw`, which is the
    // point of the move: a block there costs the mat width, and width is the
    // axis this table is not short of. The band it came out of was a row across
    // the table on the one axis that is scarce.
    expect(closest(button, '.mtg-board__pods')).not.toBeNull();
    const play = closest(button, '.mtg-play__table') as { querySelectorAll(s: string): ArrayLike<unknown> };
    expect(Array.from(play.querySelectorAll(':scope > .mtg-priority'))).toHaveLength(0);
  });

  it('still submits the index the kernel enumerated', () => {
    const state = afterOneCast();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    const submitted: Choice[] = [];
    renderAt(state, 0, (index) => submitted.push(index));

    fireEvent.click(within(bar()).getByRole('button', { name: PASS_LABEL }));

    expect(submitted).toEqual([passIndex(decision)]);
  });

  it('is drawn disabled, in the foot, when the kernel offered no pass', () => {
    // A mulligan: nobody holds priority and there is no pass to spend. The
    // announcement says the first thing and the button is dead rather than
    // absent.
    const opening = scenario({ battlefield: [{ card: MOUNTAIN, controller: 0 }] }).state;
    const mulligan: GameState = { ...opening, turn: { ...opening.turn, priority: null } };
    renderAt(mulligan, 0);
    expect(textOf(bar())).toContain('Nobody has priority');
    const button = within(bar()).getByRole('button', { name: PASS_LABEL });
    expect((button as { getAttribute(name: string): string | null }).getAttribute('disabled')).not.toBeNull();
  });
});

describe('the settings a caller owns do not change the foot', () => {
  it('says the same sentence with the auto-pass controls wired in', () => {
    // The toolbar's disclosure and the phase bar appear only for a caller that
    // owns the settings (`toolbar.ts`); the priority sentence is state rather
    // than a control, so it is drawn either way.
    const state = afterOneCast();
    render(
      h(PlayView, {
        session: sessionAt(state),
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    );
    expect(textOf(bar())).toContain('You have priority');
    expect(textOf(bar())).toContain(HELD_OVER_YOUR_OWN);
  });
});
