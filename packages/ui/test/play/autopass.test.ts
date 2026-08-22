// @vitest-environment jsdom
/**
 * The auto-pass settings that are not a stop on one step, on the table.
 *
 * The kernel side of `mtg-bc2.140` is proved in `packages/kernel/test/autopass.test.ts`:
 * the predicate, the stop sets, the yield, and the invariant that a recorded
 * game is byte-identical whether or not any of it was switched on. This file
 * checks the half that lives on the screen, which is the half the request was
 * actually about — "I still don't see a way to yield priority or set stops".
 *
 * **The surface moved twice.** `mtg-6ce` put it on the turn indicator.
 * The playtester, 2026-08-13: "I would rather have the stops be settable in the same
 * place where in the upper left the current turn and phase is so you can click
 * it to expand and alternately set and remove stops and collapsing it just shows
 * the current turn and phase." Then `mtg-bz2.1` took the stops themselves out of
 * the panel and onto the phase bar, where they are readable without opening
 * anything: `./phase-bar.test.ts` is that half, including the assertion that the
 * bar is in the near band rather than the rail. `mtg-rgc.13` then moved the
 * indicator onto the left-hand end of that bar, so the disclosure and the stops
 * it half-controls are finally one row.
 *
 * What is left in the disclosure is what a bar of steps cannot carry — full
 * control, whether the stop set is authoritative, the two yields — plus the
 * legend that says what the bar's four marks mean. The assertions here are the
 * ones they always were: that the panel opens and closes on the badge, that
 * pressing a control changes the game's position rather than only its own label,
 * that the pass has a key, and that opening the thing makes no choice.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { AutoPassSettings, Step } from '@mtg/kernel';
import { DEFAULT_STOPS, FULL_CONTROL } from '@mtg/kernel';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { PHASE_BAR_LABEL } from '../../src/routes/play/PhaseBar';
import { MARK_LEGEND } from '../../src/routes/play/stops';
import { ONLY_STOPS_LABEL, STOP_LEGEND_LABEL, TURN_STOPS_LABEL } from '../../src/routes/play/TurnStops';

afterEach(cleanup);

/**
 * The turn indicator, which is also the disclosure.
 *
 * Found by the accessible name, which starts with the turn and phase it draws:
 * that text is the whole of the collapsed control, and the suffix the label adds
 * for a screen reader is deliberately not on screen.
 */
function turnHead(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('button', { name: /^Turn \d/ });
}

/** Opens the stops panel, because the indicator is drawn collapsed. */
function expandStops(): void {
  if (attr(turnHead(), 'aria-expanded') === 'false') fireEvent.click(turnHead());
}

function dealt(): ReturnType<typeof dealMirrorGame> {
  return dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
}

/** The phase bar, which is where a stop on one step is set and read. */
function phaseBar(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: PHASE_BAR_LABEL });
}

/** What one node on the bar is currently set to. */
function stopStateOfNode(step: Step): string | null {
  const node = (phaseBar() as { querySelector(selector: string): unknown }).querySelector(
    `.mtg-phasebar__node[data-step='${step}']`,
  );
  return node === null ? null : attr(node, 'data-stop');
}

/**
 * The two DOM reads this file needs, cast structurally.
 *
 * The workspace tsconfig has no `lib: dom` (see `mount.ts`), so neither
 * `textContent` nor `getAttribute` is typed on what testing-library hands back;
 * `click.test.ts` and `equip.test.ts` reach both the same way.
 */
function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function closest(node: unknown, selector: string): unknown {
  return (node as { closest(selector: string): unknown }).closest(selector);
}

/**
 * Presses through the opening hand, which is the first question the board asks.
 *
 * CR 103.4 is a decision like any other, so none of the controls below — the
 * yield, the pass key, the settle that full control triggers — is about a
 * priority until the hand has been accepted. Keeping is index 0 and reads
 * "Keep this hand" on the button.
 */
function keepOpeningHand(): void {
  const keep = screen.queryByRole('button', { name: 'Keep this hand' });
  if (keep !== null) fireEvent.click(keep);
}

/** What the strip says about how many choices have been made. */
function choicesMade(): number {
  const found = /(\d+) choices made/.exec(textOf(screen.getByText(/choices made/)));
  return Number(found?.[1] ?? '-1');
}

/** Whatever `fireEvent` accepts as a target, named without a `lib: dom` to name it. */
type EventTargetLike = Parameters<typeof fireEvent.keyDown>[0];

/**
 * The document body, reached structurally.
 *
 * The workspace tsconfig has no `lib: dom` (see `mount.ts`), so `document` is
 * not a name here; `click.test.ts` reaches the active element the same way.
 */
function documentBody(): EventTargetLike {
  const host = globalThis as { readonly document?: { readonly body?: unknown } };
  const body = host.document?.body;
  if (typeof body !== 'object' || body === null) throw new Error('expected a jsdom document');
  return body as EventTargetLike;
}

describe('the turn indicator is the stops control', () => {
  it('is the step bar disclosure rather than a strip above the table', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const head = turnHead();
    expect(attr(head, 'aria-expanded')).toBe('false');
    expect(attr(head, 'aria-controls')).not.toBeNull();
    // `mtg-rgc.13`: the turn is one fact in one place, at the left-hand end of
    // the bar, which is where Magic Online writes it. It was in the ask column
    // between `0e33a265` and this, and on a strip above the table before that.
    expect(closest(head, '.mtg-phasebar'), 'the turn indicator is on the bar').not.toBeNull();
    expect(
      closest(head, ".mtg-board__side[data-seat='you']"),
      'the turn indicator is in the near band',
    ).not.toBeNull();
    expect(closest(head, '.mtg-play-meta'), 'the turn indicator is not also in game details').toBeNull();
    expect(closest(head, '.mtg-toolbar'), 'the turn indicator still costs a table row').toBeNull();
  });

  it('shows the turn and whose it is and nothing else while it is collapsed', () => {
    render(h(PlayRoute, { config: dealt().config }));
    // The whole of the collapsed control. No stop count, no summary badge —
    // The playtester was specific — and since `mtg-rgc.2` no step either: the bar
    // beside this badge names all thirteen and boxes the one the game is in, so
    // the step here was the same fact drawn twice in the widest thing on a strip
    // that is short of width. It is still in the button's accessible name.
    expect(textOf(turnHead())).toMatch(/^Turn \d+: .+$/);
    expect(attr(turnHead(), 'aria-label')).toContain(textOf(turnHead()));
    expect(textOf(turnHead())).not.toMatch(/stop/i);
    expect(screen.queryByText(/\d+ stops/)).toBeNull();
    expect(screen.queryByText(TURN_STOPS_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Full control' })).toBeNull();
    expect(screen.queryByRole('button', { name: ONLY_STOPS_LABEL })).toBeNull();
    expect(screen.queryByRole('list', { name: STOP_LEGEND_LABEL })).toBeNull();
    // The bar is not part of the disclosure and never was: the stops are on
    // screen while the panel is shut, which is the whole of `mtg-bz2.1`.
    expect(phaseBar()).toBeTruthy();
  });

  it('opens on the indicator and closes again on it', () => {
    render(h(PlayRoute, { config: dealt().config }));
    fireEvent.click(turnHead());
    expect(attr(turnHead(), 'aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Full control' })).toBeTruthy();

    fireEvent.click(turnHead());
    expect(attr(turnHead(), 'aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Full control' })).toBeNull();
  });

  it('names the panel it controls, and the panel is the one it names', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    const panel: unknown = screen.getByRole('group', { name: TURN_STOPS_LABEL, hidden: true });
    expect(attr(panel, 'id')).toBe(attr(turnHead(), 'aria-controls'));
  });

  it('closes on escape, because it is drawn over the board', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    fireEvent.keyDown(turnHead(), { key: 'Escape' });
    expect(attr(turnHead(), 'aria-expanded')).toBe('false');
  });
});

/*
 * One surface, not two.
 *
 * The rail block this replaces was collapsible for an hour before `mtg-6ce`
 * settled where the stops live, and a fold in the rail is still chrome in the
 * rail. Two places to set one stop is two settings that can disagree with each
 * other, so the rail's block is gone rather than folded.
 */
describe('the rail keeps no stops of its own', () => {
  it('draws every stop on the one bar rather than in the rail', () => {
    const { container } = render(h(PlayRoute, { config: dealt().config }));
    expect(closest(phaseBar(), '.mtg-board__rail'), 'the phase bar is in the rail').toBeNull();
    // One home, and since `mtg-rgc.6` it is the near band rather than the strip
    // above the table. `./phase-bar.test.ts` is where that placement is argued;
    // what this file needs from it is that there is exactly one of it.
    expect(closest(phaseBar(), '.mtg-board__side'), 'the phase bar left the board').not.toBeNull();
    expect(
      (container as { querySelector(selector: string): unknown }).querySelector('.mtg-stops'),
      'the rail stops block came back',
    ).toBeNull();
  });

  it('leaves the rail one way to change a setting, which is none', () => {
    const { container } = render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    const rail: unknown = (container as { querySelector(selector: string): unknown }).querySelector(
      '.mtg-board__rail',
    );
    expect(rail).not.toBeNull();
    for (const label of [ONLY_STOPS_LABEL, 'Full control', 'Yield to end of turn']) {
      expect(
        within(rail as Parameters<typeof within>[0]).queryByRole('button', { name: label, hidden: true }),
        `${label} is still in the rail`,
      ).toBeNull();
    }
  });
});

/*
 * The legend, which is what makes the bar's shapes readable.
 *
 * The marks on the phase bar are `aria-hidden`, and each node carries its state
 * as a word in its own accessible name (`./phase-bar.test.ts`). That covers a
 * screen reader and covers nobody else: a sighted player who has never been told
 * what a filled triangle in the upper row means is looking at decoration. The
 * panel is where they are named, which is the one place on this surface with
 * room for a sentence — and since `mtg-rgc.2` the name has to include *where*
 * the mark sits, because the row a mark is in is half of what it says.
 */
describe('the mark legend', () => {
  it('names every mark, in the order a node draws them', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    const legend = screen.getByRole('list', { name: STOP_LEGEND_LABEL, hidden: true });
    const rows = within(legend).getAllByRole('listitem', { hidden: true });
    expect(rows.map((row) => textOf(row))).toEqual(
      MARK_LEGEND.map((entry) => `${entry.mark}${entry.meaning}`),
    );
  });

  it('hides each mark from the accessibility tree, so a row reads as its word', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    const legend = screen.getByRole('list', { name: STOP_LEGEND_LABEL, hidden: true });
    const marks = (
      legend as unknown as { querySelectorAll(selector: string): Iterable<unknown> }
    ).querySelectorAll('.mtg-turnstops__legend-mark');
    const listed = [...marks];
    expect(listed).toHaveLength(MARK_LEGEND.length);
    for (const mark of listed) expect(attr(mark, 'aria-hidden')).toBe('true');
  });
});

describe('full control', () => {
  /**
   * The control the request asked for by name, and the assertion is that it
   * moves the game rather than only its own label. Opened at full control the
   * table sits on the first priority of the turn, where the only legal move is
   * the pass; switching auto-pass on has to settle the session forward to
   * somewhere there is something to decide, without the player clicking a move.
   */
  it('settles the session forward the moment it is switched off', () => {
    render(h(PlayRoute, { config: { ...dealt().config, autoPass: FULL_CONTROL } }));
    expandStops();
    keepOpeningHand();
    const opening = textOf(screen.getByText(/legal$/));
    expect(opening).toBe('1 legal');

    fireEvent.click(screen.getByRole('button', { name: 'Full control' }));

    expect(textOf(screen.getByText(/legal$/))).not.toBe('1 legal');
    expect(attr(screen.getByRole('button', { name: 'Full control' }), 'aria-pressed')).toBe('false');
  });

  it('reads as pressed while it is on', () => {
    render(h(PlayRoute, { config: { ...dealt().config, autoPass: FULL_CONTROL } }));
    expandStops();
    expect(attr(screen.getByRole('button', { name: 'Full control' }), 'aria-pressed')).toBe('true');
  });
});

describe('only my stops', () => {
  /**
   * The control the report asked for without naming it: "even when I just set my
   * stops to my first and second main phase the only way to advance the game is
   * by clicking pass". Pressed, a priority no stop names is passed for the
   * player; released, the stop set can only add questions.
   */
  it('is on by default and says so', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    expect(attr(screen.getByRole('button', { name: ONLY_STOPS_LABEL }), 'aria-pressed')).toBe('true');
  });

  it('moves the game to the next stop when it is switched on', () => {
    // Opened with the set inert, the table sits at the first priority the
    // structural rule could not take — the player's own opening main phase, with
    // a land in hand. Nothing stops on their turn here, so switching this on has
    // to settle the session forward without a move being clicked.
    //
    // The hand is kept first, and that is load-bearing rather than tidy: the
    // board's first question is CR 103.4's mulligan, which is not a priority, so
    // the stop-driven pass has no opinion on it and correctly declines to move.
    // Without this line the assertion measures a session parked on the opening
    // hand and reads zero either way — which is exactly how it failed when the
    // mulligan and this control were merged together.
    const inert: AutoPassSettings = {
      enabled: true,
      passUnstopped: false,
      stops: { yourTurn: new Set<Step>(), theirTurn: DEFAULT_STOPS.theirTurn },
    };
    render(h(PlayRoute, { config: { ...dealt().config, autoPass: inert } }));
    expandStops();
    keepOpeningHand();
    const before = choicesMade();

    fireEvent.click(screen.getByRole('button', { name: ONLY_STOPS_LABEL }));

    expect(choicesMade()).toBeGreaterThan(before);
    expect(attr(screen.getByRole('button', { name: ONLY_STOPS_LABEL }), 'aria-pressed')).toBe('true');
  });
});

describe('yield', () => {
  it('offers both boundaries while a priority is pending', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    keepOpeningHand();
    for (const label of ['Yield to end of turn', 'Yield to next own turn']) {
      const button = screen.getByRole('button', { name: label });
      expect(attr(button, 'disabled')).toBeNull();
    }
  });

  it('moves the game on when pressed', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    keepOpeningHand();
    const before = choicesMade();
    fireEvent.click(screen.getByRole('button', { name: 'Yield to end of turn' }));
    expect(choicesMade()).toBeGreaterThan(before);
  });
});

describe('the pass key', () => {
  /**
   * Bound on the document rather than on the table, and this is the test that
   * says why: the keystroke below comes from the body, which is where the focus
   * ring lands once the button that was pressed is unmounted by its own choice.
   * A handler on `.mtg-play` would never see it.
   */
  it('takes the pass on space', () => {
    render(h(PlayRoute, { config: dealt().config }));
    keepOpeningHand();
    const before = choicesMade();
    fireEvent.keyDown(documentBody(), { key: ' ' });
    expect(choicesMade()).toBeGreaterThan(before);
  });

  it('takes it on enter too', () => {
    render(h(PlayRoute, { config: dealt().config }));
    keepOpeningHand();
    const before = choicesMade();
    fireEvent.keyDown(documentBody(), { key: 'Enter' });
    expect(choicesMade()).toBeGreaterThan(before);
  });

  it('leaves a focused button to answer for itself, so one press is one choice', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expandStops();
    const before = choicesMade();
    // The browser activates a focused button on both keys. Firing as well would
    // submit two choices for one press: the pass, and whatever the ring was on.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Full control' }), { key: ' ' });
    expect(choicesMade()).toBe(before);
  });

  it('ignores a modified press, which belongs to the browser', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const before = choicesMade();
    fireEvent.keyDown(documentBody(), { key: ' ', ctrlKey: true });
    fireEvent.keyDown(documentBody(), { key: 'Enter', metaKey: true });
    expect(choicesMade()).toBe(before);
  });
});

/*
 * Whether the panel is open is view state, and that is not a small point.
 *
 * It lives in the component, so it is not in the session, not in the recorded
 * choice log and not in the seed: two runs of one game can be folded differently
 * and still not diverge by a byte. The lane that built the rail's fold asserted
 * exactly this, and the assertion outlives the surface it was written for.
 */
describe('expanding the indicator is view state', () => {
  it('makes no choice and changes no setting', () => {
    render(h(PlayRoute, { config: dealt().config }));
    keepOpeningHand();
    const before = choicesMade();
    fireEvent.click(turnHead());
    fireEvent.click(turnHead());
    expect(choicesMade()).toBe(before);
    expandStops();
    expect(attr(screen.getByRole('button', { name: ONLY_STOPS_LABEL }), 'aria-pressed')).toBe('true');
    expect(stopStateOfNode('precombatMain')).toBe('yourTurn');
  });
});
