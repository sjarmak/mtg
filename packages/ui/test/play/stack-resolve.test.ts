// @vitest-environment jsdom
/**
 * Resolving from the stack: a second door to one index, and never a second list.
 *
 * The playtester, 2026-08-14: "for cards where I need to 'let it resolve' it should
 * show it go 'onto the stack' and the option to 'resolve' should be clickable
 * there not something I need to scroll down to in a left panel" (`mtg-atq`). The
 * move existed only as a line in the ask column's `Turn` group, which is the
 * bottom of a list that runs to sixteen options at a busy priority (`mtg-euc`),
 * while the thing it is about is drawn in a box one column over.
 *
 * # The rule the whole file is about
 *
 * `src/routes/play/rail.ts`'s contract says the enumeration is the authority and
 * direct manipulation is added beside it, never instead of it — the same
 * sentence `mtg-bz2.14` writes for gestures. So this control has to be a third
 * way of spending `passIndex(decision)`, alongside the ask column's own entry
 * and the fixed pass, rather than a move that exists only here. Every test below
 * is a way of asking that: the index it submits, the group it is outside, and
 * the entry it is on.
 *
 * # The motion
 *
 * "Show it go onto the stack" is geometry over time and jsdom has neither, so
 * what is checked here is that the shipped sheet animates a stack entry with the
 * same keyframes and the same duration `styles/board/arrival.ts` already gives a
 * permanent landing — one motion vocabulary rather than two. The animation is
 * fired by an element entering the document and needs no state, which is what
 * makes it invisible to `stateFingerprint` and to `replaySession`.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState } from '@mtg/kernel';
import {
  humanSeat,
  indexOfAction,
  legalActions,
  passIndex,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { RESOLVE_LABEL } from '../../src/board/StackZone';
import { LEGAL_MOVES_LABEL, PASS_LABEL, PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { ARRIVAL_MS } from '../../src/styles/board/arrival';
import { uiStyleSheet } from '../../src/styles/index';

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

function openState(): GameState {
  return scenario({
    battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[BOLT, BOLT], []],
  }).state;
}

/** One cast, so the caster keeps priority over their own object (CR 117.3c). */
function afterCast(state: GameState): GameState {
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

interface NodeLike {
  closest(selector: string): NodeLike | null;
  querySelectorAll(selector: string): ArrayLike<NodeLike>;
  getAttribute(name: string): string | null;
}

function renderAt(state: GameState, onChoose: (choice: Choice) => void = () => undefined): void {
  render(h(PlayView, { session: sessionAt(state), viewer: 0, names: NAMES, onChoose }));
}

function resolves(): NodeLike[] {
  return screen.queryAllByRole('button', { name: RESOLVE_LABEL }) as unknown as NodeLike[];
}

describe('the control on the stack', () => {
  it('is drawn on the object that resolves next and on no other', () => {
    // Two objects: only the top one resolves, and a button on the one underneath
    // would be offering a move that does not exist.
    const two = afterCast(afterCast(openState()));
    expect(two.stack).toHaveLength(2);
    renderAt(two);
    const found = resolves();
    expect(found).toHaveLength(1);
    const entry = found[0]?.closest('.mtg-stack__entry');
    expect(entry?.getAttribute('data-top')).toBe('true');
  });

  it('submits the index the kernel enumerated, and the same one the ask column does', () => {
    const state = afterCast(openState());
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the fixture settled to a finished game');
    const submitted: Choice[] = [];
    renderAt(state, (choice) => submitted.push(choice));

    const button = resolves()[0];
    if (button === undefined) throw new Error('the top of the stack carries no control');
    fireEvent.click(button as unknown as Element);

    // The submission is the action now rather than its index (`mtg-y1t.2`
    // widened it, because a truncated enumeration has legal actions no index
    // names). The claim this test makes is unchanged: whatever the resolve
    // control submits sits at the same place in the enumeration the ask column's
    // pass does, so the two doors cannot drift apart.
    expect(submitted.length).toBe(1);
    const [only] = submitted;
    if (only === undefined) throw new Error('the resolve control submitted nothing');
    const at = typeof only === 'number' ? only : indexOfAction(decision.options, only);
    expect(at).toBe(passIndex(decision));
  });

  it('sits outside the group that names the legal moves, exactly as the fixed pass does', () => {
    // Inside it, this would be a second button for one option, which is the
    // thing `test/play/rail-contract.test.ts` fails on. The enumeration keeps
    // one entry per option and this is a shortcut to one of them.
    const state = afterCast(openState());
    renderAt(state);
    const button = resolves()[0];
    expect(button?.closest('.mtg-choices')).toBeNull();
    // On the object, which since `mtg-rgc.7` means on the seam between the two
    // seats rather than in the side rail. What the assertion is about is that it
    // is not a second entry in the enumeration, so it names the strip it hangs
    // off rather than whichever column that strip is in this month.
    expect(button?.closest('.mtg-stack-seam')).not.toBeNull();
    // And the other door is still open, which is the half of the contract that
    // says a second door may not close the first. It is the fixed pass rather
    // than a list entry since 2026-08-20 (`pass.test.ts` records the ruling), so
    // what is asserted is that this control did not become the only way to spend
    // a priority — and the list is checked for the absence, so a pass entry
    // coming back fails here as well as there.
    const moves = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    expect(within(moves).queryByRole('button', { name: /Let it resolve/ })).toBeNull();
    expect(screen.getByRole('button', { name: PASS_LABEL })).toBeDefined();
  });

  it('is absent rather than dead when the kernel enumerated no pass', () => {
    // An empty stack has nothing to resolve, so there is no entry to hang it on
    // at all. The opposite choice from `src/routes/play/pass.ts`, and right for
    // the opposite reason: that button promises a fixed place and this one is an
    // affordance on an object.
    renderAt(openState());
    expect(resolves()).toHaveLength(0);
  });
});

describe('going onto the stack is something you can see', () => {
  it('animates an arriving entry with the arrival vocabulary, not a second one', () => {
    const sheet = uiStyleSheet();
    // One set of keyframes for the whole table, so this and the lane moving
    // attackers into the divider compose rather than competing.
    expect(sheet).toContain('@keyframes mtg-arrive');
    expect(sheet).toMatch(/\.mtg-stack__entry[\s\S]{0,80}animation: mtg-arrive/);
    expect(sheet).toContain(`animation: mtg-arrive ${String(ARRIVAL_MS)}ms`);
  });

  it('shows nothing at all under reduced motion, rather than showing it fast', () => {
    // A 1ms fade from `opacity: 0` is a frame of blank entry, which is a flash
    // rather than a reduction. `styles/board/arrival.ts` argues it for the
    // battlefield and the stack takes the same block.
    const sheet = uiStyleSheet();
    const reduced = sheet.slice(sheet.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.mtg-stack__entry');
    expect(reduced).toContain('animation: none;');
  });
});
