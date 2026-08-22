// @vitest-environment jsdom
/**
 * The viewer over the committed fixture: a real 13-turn greedy-bot game and a
 * real turn-limit draw, both recorded from the kernel.
 *
 * The load-bearing assertion is the round trip — forward then back has to give
 * back the identical markup, because the whole design claim is that a frame is
 * a recorded value rather than a recomputation.
 *
 * The package has no `lib: dom`, so nothing here touches `document` or reads a
 * property off an element: markup comes out as a string through `prettyDOM`,
 * and every other assertion is a Testing Library query.
 */
import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, prettyDOM, render, screen } from '@testing-library/react';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { seqForTurn, turnsOf } from '../../src/routes/replay/steps';
import type { ReplayState } from '../../src/routes/replay/ReplayViewer';
import type { EventLog, ReplayGameLog } from '../../src/routes/replay/read-log';
import { fixtureLog } from './support/log-fixture';
import type { ArtResolver } from '../../src/lab/art-manifest';
import { boardFrame } from '../../src/routes/replay/frame';
import { namesFor } from '../../src/routes/replay/narrate';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LOG: EventLog = fixtureLog();

function gameAt(index: number): ReplayGameLog {
  const game = LOG.games[index];
  if (game === undefined) throw new Error(`the fixture has no game ${index}`);
  return game;
}

/** Mirrors `UiRouter.setParams`: merge, and an empty value removes the key. */
function Harness(props: {
  readonly initial?: Readonly<Record<string, string>>;
  readonly artFor?: ArtResolver;
}): ReactElement {
  const [params, setParams] = useState<Readonly<Record<string, string>>>(props.initial ?? {});
  return h(ReplayViewer, {
    state: { status: 'ready', log: LOG },
    route: { mode: 'replay', params },
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    onSetParams: (next) => {
      setParams((current) => {
        const merged: Record<string, string> = { ...current, ...next };
        for (const [key, value] of Object.entries(next)) if (value === '') delete merged[key];
        return merged;
      });
    },
  });
}

interface Mounted {
  /** The whole rendered tree as a string; the round-trip comparison uses it. */
  markup(): string;
}

function mount(initial?: Readonly<Record<string, string>>, artFor?: ArtResolver): Mounted {
  const view = render(
    h(Harness, {
      ...(initial === undefined ? {} : { initial }),
      ...(artFor === undefined ? {} : { artFor }),
    }),
  );
  return {
    markup(): string {
      const printed = prettyDOM(view.container, Number.POSITIVE_INFINITY);
      if (printed === false) throw new Error('the viewer rendered nothing');
      return printed;
    },
  };
}

/** The transport prints `step N of M`; that span is the cursor readout. */
function expectAtStep(seq: number): void {
  expect(screen.getByText(`step ${seq + 1}`)).toBeTruthy();
}

function click(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/**
 * The transport block is the one that prints the whole rendered tree through
 * `prettyDOM` — that is what the round-trip claim needs and what makes these
 * five the expensive tests in the file, where the query-based blocks below
 * touch a handful of nodes each.
 *
 * Measured on a quiet 16-core box: 79ms to 970ms, the top of that being the
 * ten-step round trip, which prints and compares twenty full trees. Under 24
 * competing CPU hogs, which is roughly what several agent worktrees running
 * suites at once produce: 0.5s to 3.2s. Under 48: up to 10.4s, and there both
 * round-trip tests failed on vitest's 5s default (mtg-bc2.101).
 *
 * So the budget goes here, at the cost, the way `packages/sim`,
 * `packages/setgen`, `packages/slice`, `packages/cube` and
 * `packages/ui/test/play/play.test.ts` already state theirs. Raising the
 * default in vitest.config.ts instead would buy the same tolerance and give up
 * the fast failure on a genuine hang everywhere else.
 */
const TRANSPORT_BUDGET_MS = 30_000;

describe('ReplayViewer transport', { timeout: TRANSPORT_BUDGET_MS }, () => {
  it('starts at the opening frame and says the game has no decision yet', () => {
    mount();
    expectAtStep(0);
    expect(screen.getByText('No decision on this step')).toBeTruthy();
  });

  it('returns to the identical rendered state after forward then back', () => {
    const view = mount({ seq: '120' });
    const before = view.markup();
    click('Next');
    expectAtStep(121);
    expect(view.markup()).not.toBe(before);
    click('Prev');
    expectAtStep(120);
    expect(view.markup()).toBe(before);
  });

  it('round-trips over a stretch of steps, including combat', ({ task }) => {
    // Reads back the budget the runner applied: drop the describe option above
    // and this is 5000, so the docblock cannot outlive what it describes.
    expect(task.timeout, 'printing twenty whole trees needs its own budget under load').toBe(
      TRANSPORT_BUDGET_MS,
    );

    const view = mount({ seq: '180' });
    const frames: string[] = [];
    for (let taken = 0; taken < 10; taken += 1) {
      frames.push(view.markup());
      click('Next');
    }
    for (let taken = frames.length - 1; taken >= 0; taken -= 1) {
      click('Prev');
      expectAtStep(180 + taken);
      expect(view.markup()).toBe(frames[taken]);
    }
  });

  it('clamps a cursor past the end and refuses to walk off either edge', () => {
    const last = gameAt(0).steps.length - 1;
    mount({ seq: '999999' });
    expectAtStep(last);
    click('Next');
    expectAtStep(last);
    click('First');
    expectAtStep(0);
    click('Prev');
    expectAtStep(0);
    click('Last');
    expectAtStep(last);
  });

  it('plays forward on a timer at the chosen speed and pauses again', () => {
    vi.useFakeTimers();
    mount({ seq: '10' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '2' } });
    click('Play');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expectAtStep(11);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expectAtStep(12);
    click('Pause');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expectAtStep(12);
  });
});

describe('ReplayViewer turn jumps', () => {
  it('lands on the first step of the turn picked in the rail', () => {
    const game = gameAt(0);
    mount();
    click('Turn 9');
    const landed = seqForTurn(game, 9);
    expectAtStep(landed);
    expect(game.steps[landed]?.turn).toBe(9);
    expect(screen.getByText(/^Turn 9 · /)).toBeTruthy();
  });

  it('lands on the first step of the turn picked in the select', () => {
    const game = gameAt(0);
    mount({ seq: '250' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Turn' }), { target: { value: '4' } });
    const landed = seqForTurn(game, 4);
    expectAtStep(landed);
    expect(game.steps[landed]?.turn).toBe(4);
    expect(screen.getByDisplayValue('Turn 4')).toBeTruthy();
  });

  it('offers exactly the turns the game recorded', () => {
    mount();
    const turns = turnsOf(gameAt(0));
    for (const turn of turns) {
      expect(screen.getByRole('button', { name: `Turn ${turn.turn}` })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: `Turn ${turns.length + 1}` })).toBe(null);
  });
});

describe('ReplayViewer decisions', () => {
  it('lists the legal options and marks the one the bot took', () => {
    const game = gameAt(0);
    const seq = game.steps.findIndex(
      (step) => step.decision?.kind === 'declareBlockers' && step.decision.options.length > 3,
    );
    expect(seq).toBeGreaterThan(0);
    const decision = game.steps[seq]?.decision;
    if (decision === undefined || decision === null) throw new Error('no blocker decision found');

    mount({ seq: String(seq) });
    // One row per option, plus the header row.
    expect(screen.getAllByRole('row').length).toBe(decision.options.length + 1);
    expect(screen.getAllByText('chose').length).toBe(1);
    expect(screen.getByText(`${decision.optionCount} legal options`)).toBeTruthy();
    expect(screen.getByText('block with nothing')).toBeTruthy();
  });

  it('narrates the events of a cast in English rather than JSON', () => {
    const game = gameAt(0);
    const seq = game.steps.findIndex((step) => step.action?.type === 'castSpell');
    expect(seq).toBeGreaterThan(0);
    mount({ seq: String(seq) });
    expect(screen.getByLabelText('What happened')).toBeTruthy();
    expect(screen.getByText(/^RW Aggro casts /)).toBeTruthy();
    expect(screen.getByText(/moves from hand to stack\.$/)).toBeTruthy();
    expect(screen.queryByText(/"type"|"oid"/)).toBe(null);
  });

  it('draws both seats and the graveyards from the frame', () => {
    const game = gameAt(0);
    mount({ seq: String(game.steps.length - 1) });
    expect(screen.getByLabelText("RW Aggro's status")).toBeTruthy();
    expect(screen.getByLabelText("UB Control's status")).toBeTruthy();
    expect(screen.getByLabelText("RW Aggro's battlefield")).toBeTruthy();
    expect(screen.getByLabelText("UB Control's hand")).toBeTruthy();
    expect(screen.getByLabelText("UB Control's graveyard")).toBeTruthy();
  });

  it('draws the stack only on the frames that recorded one', () => {
    // The last step of this game has an empty stack, which used to draw a rail
    // block saying so. `mtg-rgc.7` made the stack a strip on the seam that is
    // absent when the stack is, so a frame is asked for the strip on the two
    // states separately: the recorded frame that holds an object has it, and the
    // recorded frame that holds none does not. Both seqs come out of the fixture
    // rather than being written down, so a re-record moves them with it.
    const game = gameAt(0);
    const held = game.steps.findIndex((step) => step.state.stack.length > 0);
    expect(held).toBeGreaterThan(-1);
    mount({ seq: String(held) });
    expect(screen.getByLabelText('Stack')).toBeTruthy();
    cleanup();

    const empty = game.steps.length - 1;
    expect(game.steps[empty]?.state.stack).toHaveLength(0);
    mount({ seq: String(empty) });
    expect(screen.queryByLabelText('Stack')).toBeNull();
  });
});

describe('ReplayViewer draws', () => {
  it('renders a turn-limit draw without inventing a winner', () => {
    const draw = gameAt(1);
    expect(draw.result.winner).toBe(null);

    mount({ game: '1' });
    expect(screen.getByDisplayValue(/^2\. /)).toBeTruthy();
    click('Last');
    expectAtStep(draw.steps.length - 1);

    const ending = `The game is a draw on turn ${draw.result.endedOnTurn}: the turn limit was reached.`;
    expect(
      screen.getByText(`Draw on turn ${draw.result.endedOnTurn}: the turn limit was reached.`),
    ).toBeTruthy();
    expect(screen.getByText(ending)).toBeTruthy();
    expect(screen.queryByText(/ wins on turn /)).toBe(null);
    expect(screen.getByLabelText("RW Aggro's status")).toBeTruthy();
    expect(screen.getByLabelText("UB Control's status")).toBeTruthy();
  });

  it('resets to the opening frame when the game is switched', () => {
    mount({ seq: '150' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Game' }), { target: { value: '1' } });
    expectAtStep(0);
    expect(screen.getByDisplayValue(/^2\. /)).toBeTruthy();
  });
});

/**
 * Absent and broken are different states and are said differently, which is the
 * same split `DeckRoute` makes: a checkout that has never recorded a game wants
 * the command, and a file the reader refused wants the line it refused at.
 */
describe('ReplayViewer without a game to draw', () => {
  function empty(state: ReplayState, hint?: string): void {
    render(
      h(ReplayViewer, {
        state,
        route: { mode: 'replay', params: {} },
        onSetParams: () => undefined,
        ...(hint === undefined ? {} : { sourceHint: hint }),
      }),
    );
  }

  it('names the command that records one when there is no log', () => {
    empty({ status: 'absent' }, 'run the recorder first');
    expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    expect(screen.getByText('run the recorder first')).toBeTruthy();
  });

  it('names the command by default rather than leaving a blank page', () => {
    empty({ status: 'absent' });
    expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    expect(screen.getByText(/npm run play/)).toBeTruthy();
  });

  it('reads a log that failed the reader back with the line it failed on', () => {
    empty({ status: 'failed', message: 'replay.events.jsonl: replay log line 42: not JSON' });
    expect(screen.getByText('That event log could not be read')).toBeTruthy();
    expect(screen.getByText(/line 42/)).toBeTruthy();
  });

  it('says it is still reading rather than that there is nothing', () => {
    empty({ status: 'loading' });
    expect(screen.getByText('Loading the replay')).toBeTruthy();
  });

  it('does not claim a log is missing when it is present and empty', () => {
    empty({ status: 'ready', log: { source: 'nothing.jsonl', games: [] } });
    expect(screen.getByText('That event log holds no games')).toBeTruthy();
  });
});

/**
 * The illustrations (`mtg-6hrz`).
 *
 * The playtester, on the Replay tab: the cards "are missing art". They were: this
 * component built every frame through `boardFrame` and never handed it a
 * resolver, and `frame.ts` answered `art: null` for every face of every zone. So
 * the Replay tab drew the labeled pending frame on a set with a full manifest.
 *
 * **No pixel is proved here — jsdom lays nothing out and paints nothing.** What
 * these read is which illustration each face was *given*. That the two boards
 * then draw them was measured in chrome-headless-shell 151.0.7922.34 over
 * `../../tools/face-floor.ts` against the real 249-card flagship
 * (`out/XMP/set.json`, `out/art/xmp-variants/art.json`): twelve art-covered
 * permanents a side, 0 of 24 faces painted before and 24 of 24 after, and the
 * play row's list of drawn files identical to the replay row's, copy for copy.
 */
describe('a replayed board carries the illustrations its game was played with', () => {
  /** A resolver that says what it was asked, so a choice can be read back. */
  const spelling: ArtResolver = (card, copy) => ({
    src: `${card.id}#${String(copy ?? 0)}`,
    alt: `${card.name} copy ${String(copy ?? 0)}`,
  });

  /** Every face on the board, in the order the frame lists them. */
  function faces(seq: number, artFor?: ArtResolver): readonly (string | null)[] {
    const game = gameAt(0);
    const step = game.steps[seq];
    if (step === undefined) throw new Error(`the fixture has no step ${seq}`);
    const frame = boardFrame(game, step.state, step.active, null, namesFor(game, seq), artFor ?? null);
    return [...frame.you.battlefield.permanents, ...frame.opponent.battlefield.permanents].map(
      (permanent) => permanent.art?.src ?? null,
    );
  }

  it('gives every permanent an illustration, and none without a resolver', () => {
    const withArt = faces(85, spelling);
    expect(withArt.length, 'the fixture step draws no permanents').toBeGreaterThan(4);
    expect(
      withArt.every((src) => src !== null),
      'a face went without a picture',
    ).toBe(true);
    // The other half of the claim, and the state this file shipped in: absent is
    // an ordinary answer rather than a failure, and it is what a set with no
    // manifest gets.
    expect(faces(85).every((src) => src === null)).toBe(true);
  });

  /**
   * The copy number is the object's, and it comes off the log rather than off a
   * second count. Two Plains on the battlefield at step 85 of the fixture are
   * two different objects of one card, and the rule the played table sells (see
   * `../../src/routes/play/art-copies.ts`) is that they draw different pictures
   * in creation order. A replay that recounted would be free to hand copy 1's
   * picture to copy 0, and the board would come back a different board.
   */
  it('numbers the copies off the recorded object table, in creation order', () => {
    const game = gameAt(0);
    const step = game.steps[85];
    if (step === undefined) throw new Error('the fixture has no step 85');
    const frame = boardFrame(game, step.state, step.active, null, namesFor(game, 85), spelling);
    const plains = [...frame.you.battlefield.permanents, ...frame.opponent.battlefield.permanents]
      .filter((permanent) => permanent.card.id === 'slc-plains')
      .map((permanent) => permanent.art?.src);
    expect(plains.length, 'step 85 of the fixture no longer has two Plains in play').toBe(2);
    expect(new Set(plains).size, 'two objects of one card drew one picture').toBe(2);

    // And the numbers are the ones a count over the recorded object table
    // gives, which is the whole reason `copyNumbers` has two callers and not two
    // implementations: the picture a Plains draws is its position among the
    // Plains the kernel made, and nothing about which ones happen to be in play.
    const order = [...game.objects]
      .filter(([, object]) => object.card.id === 'slc-plains')
      .map(([oid]) => oid);
    const inPlay = step.state.battlefield
      .filter((permanent) => game.objects.get(permanent.oid)?.card.id === 'slc-plains')
      .map((permanent) => `slc-plains#${String(order.indexOf(permanent.oid))}`);
    expect(inPlay.length).toBe(2);
    expect(new Set(plains)).toEqual(new Set(inPlay));
  });

  /**
   * A face size and an illustration are view state and reach neither the seed
   * nor the choice list, so the record is untouched — but the *rendering* has to
   * survive the round trip too, or stepping repaints the board. Six forward and
   * six back with a resolver attached, byte-identical markup at every stop.
   */
  it('round-trips forward and back byte-identically with art attached', () => {
    const view = mount({ seq: '180' }, spelling);
    const frames: string[] = [];
    for (let taken = 0; taken < 6; taken += 1) {
      frames.push(view.markup());
      click('Next');
    }
    for (let taken = frames.length - 1; taken >= 0; taken -= 1) {
      click('Prev');
      expectAtStep(180 + taken);
      expect(view.markup()).toBe(frames[taken]);
    }
  });
});
