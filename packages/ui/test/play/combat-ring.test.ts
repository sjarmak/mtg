// @vitest-environment jsdom
/**
 * The focus ring survives a card moving into the combat band.
 *
 * `mtg-msln`. Staging a creature takes it out of the battlefield row and draws
 * it in the combat band, which is a different React subtree, so the face that
 * held the ring is unmounted and the ring falls to the document. It is invisible
 * to a pointer player and costs a keyboard player their place in the tab order.
 *
 * Both halves of the bead are here, and they fail differently:
 *
 *  - **Attacking**, where the pressed face is genuinely unmounted and remounted
 *    inside the band.
 *  - **Blocking**, where the pressed card is the viewer's own creature, and also
 *    where the *attacker* keeps its node while the strip reorders around it —
 *    a move via `insertBefore` blurs a focused element.
 *
 * The ring is asserted to be on a card face rather than on any particular one,
 * because which face is the right one is `keepRing`'s decision and not this
 * file's: what the bead asks for is that it is not the document.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { driveDeclaration, humanSeat, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { SeatNames } from '../../src/routes/play/position';
import { PlayView } from '../../src/routes/play/PlayView';
import { restoreRingTo } from '../../src/routes/play/focus';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const BRUISER = exampleCard('slc-ironclad-golem');

interface NodeLike {
  readonly getAttribute: (name: string) => string | null;
  readonly focus: () => void;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<NodeLike> & Iterable<NodeLike>;
}

function bodyNode(): NodeLike {
  const body = (globalThis as { document?: { body?: NodeLike } }).document?.body;
  if (body === undefined) throw new Error('this test needs a jsdom window');
  return body;
}

function active(): NodeLike | null {
  return (globalThis as { document?: { activeElement?: NodeLike | null } }).document?.activeElement ?? null;
}

/** Whether the ring is on a card face rather than on the document. */
function ringOnACard(): boolean {
  const node = active();
  if (node === null) return false;
  return Array.from(bodyNode().querySelectorAll('button.mtg-card')).some((face) => face === node);
}

function faceFor(oid: ObjectId): NodeLike {
  const found = bodyNode().querySelector(`[data-permanent-key='${oid}'] button.mtg-card`);
  if (found === null) throw new Error(`no pressable face for ${oid}`);
  return found;
}

/** Pressed the way a keyboard player presses: the ring is on it first. */
function pressFocused(node: NodeLike): void {
  node.focus();
  expect(active(), 'the press starts with the ring on the card').toBe(node);
  fireEvent.click(node as unknown as Parameters<typeof fireEvent.click>[0]);
}

function seated(state: GameState): GameSession {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat(NAMES[0]), humanSeat(NAMES[1])],
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

let minted = 0;

function creature(name: string): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `ring-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'RNG', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
  });
}

/** Seat 0 attacking with two creatures, seat 1 holding two untapped answers. */
function blockingState(): GameState {
  const built = scenario({
    seed: 'ui/combat-ring',
    battlefield: [
      { card: creature('Ring Attacker One'), controller: 0 as PlayerId, summoningSick: false },
      { card: creature('Ring Attacker Two'), controller: 0 as PlayerId, summoningSick: false },
      { card: creature('Ring Guard One'), controller: 1 as PlayerId, summoningSick: false },
      { card: creature('Ring Guard Two'), controller: 1 as PlayerId, summoningSick: false },
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  let current = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before blockers were declared');
    if (pending.kind === 'declareBlockers') return current;
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

/** Three untapped creatures on the viewer's own side, parked on the attack. */
function attackingState(): GameState {
  return scenario({
    seed: 'ui/combat-ring-attack',
    battlefield: Array.from({ length: 3 }, (_, index) => ({
      card: {
        ...BRUISER,
        id: `${BRUISER.id}-${String(index)}`,
        name: `${BRUISER.name} ${String(index + 1)}`,
      },
      controller: 0 as PlayerId,
      summoningSick: false,
    })),
    step: 'declareAttackers',
    active: 0,
    turn: 8,
  }).state;
}

describe('the ring when a card moves into the combat band', () => {
  it('stays on a card when a creature is staged as an attacker', () => {
    const session = seated(attackingState());
    const oid = session.state.battlefield[0];
    if (oid === undefined) throw new Error('no creature on this board');
    render(h(PlayView, { session, viewer: 0 as PlayerId, names: NAMES, onChoose: vi.fn() }));

    pressFocused(faceFor(oid));

    expect(bodyNode().querySelectorAll(".mtg-combat__entry[data-state='staged']").length).toBe(1);
    expect(ringOnACard(), 'the ring fell to the document when the face moved into the band').toBe(true);
  });

  it('stays on a card when a block is assigned by pressing the attacker in the band', () => {
    const state = blockingState();
    const session = seated(state);
    const mine = state.battlefield.find((oid) => state.objects[oid]?.controller === 1);
    const attacker = state.battlefield.find((oid) => state.objects[oid]?.controller === 0);
    if (mine === undefined || attacker === undefined) throw new Error('this board is missing a side');
    render(h(PlayView, { session, viewer: 1 as PlayerId, names: NAMES, onChoose: vi.fn() }));

    // Two attackers, so the press opens the question of which one rather than
    // assigning outright, and the answer is given on the band.
    fireEvent.click(faceFor(mine) as unknown as Parameters<typeof fireEvent.click>[0]);
    pressFocused(faceFor(attacker));

    expect(ringOnACard(), 'the ring fell to the document when the strip reordered').toBe(true);
  });

  /**
   * The other half of the rule, and the one a keeper written as "focus the
   * pressed card after every press" would get wrong twice: a press that leaves
   * the face mounted and focused must be left alone, and a press that moved the
   * ring somewhere deliberate — a question opening its answers with `autoFocus`,
   * which `selection.ts` relies on — must not be overruled.
   */
  it('leaves a ring that never fell exactly where the press left it', () => {
    const state = blockingState();
    const session = seated(state);
    const mine = state.battlefield.find((oid) => state.objects[oid]?.controller === 1);
    if (mine === undefined) throw new Error("this board has no creature of the viewer's");
    render(h(PlayView, { session, viewer: 1 as PlayerId, names: NAMES, onChoose: vi.fn() }));

    const face = faceFor(mine);
    pressFocused(face);

    expect(active(), 'the press kept its own ring and the keeper did not move it').toBe(face);
  });

  it('hands nothing back while something else still holds the ring', () => {
    const state = blockingState();
    const session = seated(state);
    const mine = state.battlefield.find((oid) => state.objects[oid]?.controller === 1);
    const attacker = state.battlefield.find((oid) => state.objects[oid]?.controller === 0);
    if (mine === undefined || attacker === undefined) throw new Error('this board is missing a side');
    render(h(PlayView, { session, viewer: 1 as PlayerId, names: NAMES, onChoose: vi.fn() }));

    const held = faceFor(mine);
    held.focus();
    restoreRingTo([attacker, mine]);

    expect(active(), 'a ring on a live element is not the document, so nothing moves').toBe(held);
  });
});
