// @vitest-environment jsdom
/**
 * The two touch gestures on one card, and the pointer model they must not touch.
 *
 * `mtg-yg8`. `gestures.test.ts` holds the pointer's three — click, double click,
 * right click — and this file holds the two a tablet has instead, plus the
 * assertions that say the first three still mean what they meant. The gesture
 * table is the playtester's (`mtg-bz2.14`): *long press zooms and opens context
 * actions*, and *tap a selected card again confirms the obvious action*.
 *
 * The load-bearing assertions here are the negative ones, in the same way
 * `gestures.test.ts`'s are. A recognizer that fires is easy; a recognizer that
 * does not fire on a slow click, on a scroll, on a mouse, or twice for one press
 * is the whole of what makes it safe to add a second input model to a surface
 * that already has one. Four of the tests below are that, and the one that pins
 * the model is the mouse: `press.ts` arms nothing for a mouse, so a held click
 * still plays the card rather than opening its menu.
 *
 * jsdom lays nothing out, so nothing here is about a gesture's *size* — that is
 * `../../tools/touch-targets.ts` and `../touch-sheet.test.ts`, which read the
 * sheet the browser was measured against.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState, ObjectId } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { PlayView, pickerLabel } from '../../src/routes/play/PlayView';
import { LONG_PRESS_MS, PRESS_SLOP_PX, REPEAT_PRESS_MS, usePressGestures } from '../../src/card/press';
import type { PressInput } from '../../src/card/press';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';
import type { PlayChoice, PlayPrompt } from '../../src/routes/play/prompt';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0;

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/** `gestures.test.ts`'s own position, for the same reason it states there. */
function skirmish(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[MOUNTAIN, RAIDER, LASH, GUARDIAN], []],
  }).state;
}

/** Two creatures that can attack: the one shape with several moves and a default. */
function combat(): GameState {
  return scenario({
    battlefield: [
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: GUARDIAN, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
    ],
    step: 'declareAttackers',
    active: 0,
    turn: 4,
  }).state;
}

function seated(state: GameState): GameSession {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat('You'), botSeat(simpleAgent('Bot'))],
    state,
    events: [],
    result: null,
    pending: decision,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function promptOf(session: GameSession): PlayPrompt {
  const decision = session.pending;
  if (decision === null) throw new Error('expected a pending decision');
  return buildPrompt(session.state, decision, NAMES);
}

/** The offered choices that act on one object, filtered here rather than looked up. */
function actingOn(prompt: PlayPrompt, oid: ObjectId): readonly PlayChoice[] {
  return prompt.choices.filter((choice) => choice.oids.includes(oid));
}

/** The node members these tests read, checked at runtime; the tsconfig has no DOM lib. */
interface NodeLike {
  readonly matches: (selector: string) => boolean;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => Iterable<unknown>;
  readonly getAttribute: (name: string) => string | null;
}

function nodeOf(value: unknown): NodeLike {
  const candidate = value as Partial<NodeLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.matches !== 'function' ||
    typeof candidate.querySelectorAll !== 'function' ||
    typeof candidate.getAttribute !== 'function' ||
    typeof candidate.querySelector !== 'function'
  ) {
    throw new Error('expected an element in the document');
  }
  return candidate as NodeLike;
}

function faceOf(container: unknown, oid: ObjectId): NodeLike {
  return nodeOf(
    nodeOf(nodeOf(container).querySelector(`[data-permanent-key="${oid}"]`)).querySelector('button.mtg-card'),
  );
}

function handOid(state: GameState, name: string): ObjectId {
  const found = state.players[VIEWER].hand.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no ${name} in hand`);
  return found;
}

function fieldOid(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find(
    (oid) => state.objects[oid]?.controller === VIEWER && state.objects[oid]?.card.name === name,
  );
  if (found === undefined) throw new Error(`no ${name} on the battlefield`);
  return found;
}

function menu(cardName: string): ReturnType<typeof screen.queryByRole> {
  return screen.queryByRole('group', { name: pickerLabel(cardName) });
}

/**
 * The permanents standing in the combat band as proposals, by object id.
 *
 * Read off the document rather than off the hook, because what is being checked
 * is that a click moved a card: the staged set is view state and the only thing
 * it is allowed to do is put a card in the band with `data-state='staged'`
 * (`../../src/board/CombatZone.ts`).
 */
function stagedKeys(container: unknown): readonly string[] {
  const found = nodeOf(container).querySelectorAll(
    ".mtg-combat__entry[data-state='staged'] [data-permanent-key]",
  );
  return [...found].map((node) => nodeOf(node).getAttribute('data-permanent-key') ?? '');
}

function view(session: GameSession, onChoose: (choice: Choice) => void): ReturnType<typeof render> {
  return render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
}

/** One press, as a browser delivers it: down, an optional hold, up, then the click. */
interface Press {
  readonly type?: string;
  readonly at?: readonly [number, number];
  readonly holdMs?: number;
  readonly moveTo?: readonly [number, number];
}

function pressOn(face: NodeLike, press: Press = {}): void {
  const type = press.type ?? 'touch';
  const [x, y] = press.at ?? [40, 40];
  const shared = { pointerId: 1, pointerType: type, clientX: x, clientY: y };
  fireEvent.pointerDown(face as unknown as Element, shared);
  if (press.moveTo !== undefined) {
    const [mx, my] = press.moveTo;
    fireEvent.pointerMove(face as unknown as Element, { ...shared, clientX: mx, clientY: my });
  }
  if (press.holdMs !== undefined) act(() => void vi.advanceTimersByTime(press.holdMs ?? 0));
  fireEvent.pointerUp(face as unknown as Element, shared);
  fireEvent.click(face as unknown as Element, { detail: 1 });
}

describe('a long press on a card', () => {
  it('opens the card menu, which is what a right click opens for a pointer', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const tapper = fieldOid(session.state, 'Mountain');
    // The same premise `gestures.test.ts` states for the right click: one move,
    // so a plain tap would play it outright and this is how it is read first.
    expect(actingOn(prompt, tapper).map((choice) => choice.kind)).toEqual(['activateManaAbility']);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    expect(menu('Mountain')).toBeNull();

    pressOn(faceOf(rendered.container, tapper), { holdMs: LONG_PRESS_MS });

    expect(menu('Mountain')).not.toBeNull();
    // The whole point of claiming the click: without it the release selects the
    // card underneath and plays the one move the menu was opened to read.
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('takes the focus ring, which is what reveals the zoom on a surface with no hover', () => {
    // `styles/card.ts` reveals `.mtg-zoom` on `:hover` and on `:focus-within`,
    // and a tablet has neither of its own — nothing about tapping a button gives
    // it the ring the way tabbing to it does. So the gesture takes the ring
    // itself, and the zoom the keyboard already had is the zoom touch gets.
    //
    // Asserted through the dismissal rather than at the moment of the press,
    // because the menu moves the ring to its own first option as soon as it
    // opens. `selection.ts` remembers whoever held the ring when the menu opened
    // and hands it back, so the ring landing on the *card* after Escape is the
    // proof that the card held it in the first place. Without the focus call in
    // `press.ts` there is nothing to remember and the ring falls to the body.
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');
    const rendered = view(session, vi.fn());
    const face = faceOf(rendered.container, tapper);

    pressOn(face, { holdMs: LONG_PRESS_MS });
    expect(menu('Mountain')).not.toBeNull();
    fireEvent.keyDown(face as unknown as Element, { key: 'Escape' });

    const host = globalThis as { readonly document?: { readonly activeElement?: unknown } };
    expect(menu('Mountain')).toBeNull();
    expect(host.document?.activeElement).toBe(face);
  });

  it('is not a slow tap: a press let go before the threshold opens nothing', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');
    const onChoose = vi.fn();
    const rendered = view(session, onChoose);

    pressOn(faceOf(rendered.container, tapper), { holdMs: LONG_PRESS_MS - 50 });

    expect(menu('Mountain')).toBeNull();
    // And the tap it actually was still plays the card's one move.
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('is dropped by a finger that moves, because that is a scroll or a drag', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');
    const rendered = view(session, vi.fn());

    pressOn(faceOf(rendered.container, tapper), {
      at: [40, 40],
      moveTo: [40, 40 + PRESS_SLOP_PX + 5],
      holdMs: LONG_PRESS_MS,
    });

    expect(menu('Mountain')).toBeNull();
  });

  it('survives a finger that trembles inside the slop', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');
    const rendered = view(session, vi.fn());

    pressOn(faceOf(rendered.container, tapper), {
      at: [40, 40],
      moveTo: [40 + PRESS_SLOP_PX - 1, 40],
      holdMs: LONG_PRESS_MS,
    });

    expect(menu('Mountain')).not.toBeNull();
  });

  it('is not armed for a mouse, so a held click still plays the card', () => {
    // The pointer model in one assertion. A mouse already reaches the menu by
    // right click and the context key; recognizing a long press for it too would
    // mean a slow click on a land opened a menu instead of tapping it.
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');
    const onChoose = vi.fn();
    const rendered = view(session, onChoose);

    pressOn(faceOf(rendered.container, tapper), { type: 'mouse', holdMs: LONG_PRESS_MS * 2 });

    expect(menu('Mountain')).toBeNull();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('is not armed for a pointer event with no pointerType, which a synthetic dispatch leaves empty', () => {
    // `''` is the spec default a `PointerEvent` carries when nothing set
    // `pointerType` — a synthetic dispatch, not a real touch or pen. The guard
    // used to be `pointerType === 'mouse'`, an exclusion list of one, so an
    // event with no `pointerType` at all fell through it and took the touch
    // path exactly like a finger would. Two such presses inside the repeat
    // window played the card's default move for an event that never came off
    // a touchscreen.
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');
    const onChoose = vi.fn();
    const rendered = view(session, onChoose);

    pressOn(faceOf(rendered.container, tapper), { type: '', holdMs: LONG_PRESS_MS * 2 });

    expect(menu('Mountain')).toBeNull();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

describe('a repeat press on a card', () => {
  /**
   * This used to say that a repeat press on a creature during declare attackers
   * "plays the default move", which was the declaration naming that creature
   * alone. the playtester asked for that step to work the other way (`mtg-bz2.5`): a
   * tap stages the creature into the combat band and the declaration crosses to
   * the kernel once, at the confirm. So the assertion the recognizer owes here
   * is the negative one — a second tap must not slip an attack past the confirm.
   */
  it('stages on the first tap and submits nothing on the repeat', () => {
    const session = seated(combat());
    const prompt = promptOf(session);
    const raider = fieldOid(session.state, 'Emberflow Raider');
    // The premise: this position offers several declarations naming the raider,
    // so there is something a "default move" could have submitted.
    expect(actingOn(prompt, raider).length).toBeGreaterThan(1);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, raider);

    // The first press stages, where it used to open a menu.
    pressOn(face);
    expect(menu('Emberflow Raider')).toBeNull();
    expect(stagedKeys(rendered.container)).toEqual([raider]);
    act(() => void vi.advanceTimersByTime(REPEAT_PRESS_MS - 100));
    pressOn(face);

    expect(onChoose).not.toHaveBeenCalled();
  });

  it('is two taps once they are far enough apart in time', () => {
    // The upper bound is what makes the gesture safe rather than fast. Past it a
    // second press on an open menu is the tap that closes it, which is what the
    // pointer's second click does.
    const session = seated(combat());
    const raider = fieldOid(session.state, 'Emberflow Raider');

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, raider);

    pressOn(face);
    act(() => void vi.advanceTimersByTime(REPEAT_PRESS_MS + 100));
    pressOn(face);

    expect(onChoose).not.toHaveBeenCalled();
    expect(menu('Emberflow Raider')).toBeNull();
  });

  it('is two taps once they are far enough apart on the glass', () => {
    const session = seated(combat());
    const raider = fieldOid(session.state, 'Emberflow Raider');

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, raider);

    pressOn(face, { at: [40, 40] });
    pressOn(face, { at: [40 + PRESS_SLOP_PX + 5, 40] });

    expect(onChoose).not.toHaveBeenCalled();
  });

  it('submits nothing on a card whose moves are two different aims', () => {
    // `gestures.test.ts`'s load-bearing refusal, reached from the other input
    // model: a castable card has no default worth submitting, because the
    // payment is the stage a submitted aiming would skip.
    const session = seated(skirmish());
    const lash = handOid(session.state, 'Lightning Lash');
    expect(actingOn(promptOf(session), lash).length).toBeGreaterThan(1);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, lash);

    pressOn(face);
    pressOn(face);

    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Casting Lightning Lash' })).not.toBeNull();
  });

  it('is not armed for a mouse, so two quick clicks are still two clicks and a dblclick', () => {
    const session = seated(combat());
    const raider = fieldOid(session.state, 'Emberflow Raider');

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, raider);

    pressOn(face, { type: 'mouse' });
    pressOn(face, { type: 'mouse' });

    // Two clicks: the first opened the menu and the second closed it. The double
    // click that plays the default is `dblclick`, which no press here fired, and
    // `gestures.test.ts` is where that is asserted.
    expect(onChoose).not.toHaveBeenCalled();
    expect(menu('Emberflow Raider')).toBeNull();
  });
});

describe('a canceled press', () => {
  it('leaves the next click alone, whoever makes it', () => {
    // A gesture claims the click it is about to produce, so the release does not
    // also act on the card underneath. When the browser cancels the pointer
    // instead -- the OS takes the gesture over, a scroll takes it over, the node
    // goes away -- that click never arrives and the claim has nothing left to
    // spend. It has to go with the pointer, because the recognizer never sees a
    // mouse or a keyboard and so can never learn it swallowed one of theirs.
    const session = seated(combat());
    const raider = fieldOid(session.state, 'Emberflow Raider');

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    // One finger press, which stages the creature: what a press *does* on this
    // decision is `mtg-bz2.5`'s, and what this test is about is the click the
    // press produces, which must be spent exactly once whatever it does.
    pressOn(faceOf(rendered.container, raider));
    expect(stagedKeys(rendered.container)).toEqual([raider]);
    // Looked up again, because staging moved the card into the combat band and
    // the node the press was delivered to left the document with its old parent.
    const face = faceOf(rendered.container, raider) as unknown as Element;
    const finger = { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 40 };
    fireEvent.pointerDown(face, finger);
    fireEvent.pointerCancel(face, finger);

    // The mouse's own click, on a face the finger has already let go of. The
    // canceled pointer's claim went with it, so this click acts — and taking the
    // creature back out of the band is what a click means here.
    fireEvent.click(face, { detail: 1 });

    expect(stagedKeys(rendered.container)).toEqual([]);
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('a press whose face leaves the tree before the timer fires', () => {
  /**
   * `press.ts` had no unmount teardown: the long-press timer is a bare
   * `setTimeout` kept in a ref, armed in `onPointerDown` and disarmed only by a
   * later pointer event on the same face. A card leaving the battlefield inside
   * `LONG_PRESS_MS` of a press -- killed, bounced, sacrificed, the ordinary
   * traffic of a game -- unmounts that face without ever delivering the pointer
   * event that would have disarmed the timer, so it fired anyway: `focus()`
   * landed on a node the document no longer had, and `onMenu` opened for a card
   * that was not there to open a menu for.
   *
   * Exercised at the hook directly rather than through `PlayView`, because the
   * defect is `usePressGestures` never noticing it unmounted at all -- nothing
   * about the surrounding board changes what a missing cleanup effect does, and
   * a hook-level render is what proves the effect runs on teardown.
   */
  it('disarms the timer, so neither the stale focus call nor the menu fires', () => {
    const onMenu = vi.fn();
    const target = { focus: vi.fn() };
    const rendered = renderHook((input: PressInput) => usePressGestures(input), {
      initialProps: { onMenu } satisfies PressInput,
    });

    act(() => {
      rendered.result.current.onPointerDown({
        pointerType: 'touch',
        pointerId: 1,
        clientX: 40,
        clientY: 40,
        currentTarget: target,
      });
    });
    // The card leaves the battlefield: its face, and the timer's own ref state
    // with it, in every sense but the one setTimeout does not care about.
    rendered.unmount();
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));

    expect(target.focus).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
  });
});
