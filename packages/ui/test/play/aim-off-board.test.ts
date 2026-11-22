// @vitest-environment jsdom
/**
 * Aiming at the two things on this table that are not cards (`mtg-bz2.16`).
 *
 * `mtg-bz2.6` wired the battlefield half and said outright why it stopped there:
 * a seat is drawn as a vitals pod and a stack entry as a line on the seam, so
 * each is a new interactive surface with its own hit target and focus order
 * rather than the same change one directory over. Both were left in the cast
 * panel, and this is the bead for the rest.
 *
 * What is asserted here is the pair of claims a new door has to make. The lit
 * end: a seat or an object the open slot names is pressable, and pressing it
 * attaches *that* aim — read back through the kernel's own option list rather
 * than through the sentence the panel prints, because which move was submitted
 * and how a surface describes it are different claims. And the quiet end: a seat
 * the slot does not name is not a control, and neither is a seat at a moment
 * when no slot is open at all. A rule that lit the pods and forgot to unlight
 * them would pass every assertion of the first kind.
 *
 * The panel is untouched and `./targeting.test.ts` still holds it to listing
 * every candidate. That is the contract `../../src/routes/play/rail.ts` states:
 * the board is an added door to the enumeration, never a narrowing of it.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, exampleCard, parseCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, Target } from '@mtg/kernel';
import {
  botSeat,
  humanSeat,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  simpleAgent,
} from '@mtg/kernel';
import { CAST_BACK_LABEL, castCancelLabel, castLabel } from '../../src/routes/play/PlayView';
import { PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(() => {
  container = null;
  cleanup();
});

const NAMES: SeatNames = ['You', 'Bot'];

const MOUNTAIN = exampleCard('slc-mountain');
const LASH = exampleCard('slc-lightning-lash');
const DRAKE = exampleCard('slc-windrider-drake');

const ISLAND = basicLand('Island', 'SLC', 251);
const COUNTER = exampleCard('slc-dissolving-word');
const BOLT: Card = parseCard({
  kind: 'instant',
  id: 'slc-test-arrow',
  name: 'Test Arrow',
  rarity: 'common',
  set: { code: 'SLC', collectorNumber: 199 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
});

/**
 * `anyTarget` over a table with one creature on it: three candidates, of which
 * two are seats. `./targeting.test.ts` uses the same position for the third.
 */
function skirmish(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[LASH], []],
  }).state;
}

/**
 * Two spells already on the stack, and the mana to answer either.
 *
 * The caster keeps priority over their own object (CR 117.3c), so the seat that
 * cast the Arrows is the seat asked next and the counter in its hand names both
 * of them. Countering your own spell is a legal thing to be offered and the
 * point here is the gesture, not the play.
 *
 * **Two rather than one, and that is load-bearing.** `../../src/routes/play/
 * cast.ts` opens a target stage only for a slot with more than one candidate —
 * a slot with exactly one is settled and the panel goes straight to the payment
 * — so a single spell on the stack would put this fixture at a step where
 * nothing is being aimed at all, and every assertion below would read as a
 * board that failed to light rather than a question that was never asked.
 */
function overStack(): GameState {
  let state = scenario({
    battlefield: [
      ...Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      ...Array.from({ length: 4 }, () => ({ card: ISLAND, controller: 0 as const })),
    ],
    hands: [[BOLT, BOLT, COUNTER], []],
  }).state;
  for (let cast = 0; cast < 2; cast += 1) {
    const arrow = legalActions(state).find(
      (action) => action.type === 'castSpell' && state.objects[action.oid]?.card.name === BOLT.name,
    );
    if (arrow === undefined) throw new Error('the fixture could not put an Arrow on the stack');
    state = reduce(state, arrow).state;
  }
  return state;
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

interface QueryLike {
  readonly querySelector: (selector: string) => unknown;
  readonly querySelectorAll: (selector: string) => Iterable<unknown>;
}

/** The workspace tsconfig has no `lib: dom`, so the tree is reached structurally. */
let container: QueryLike | null = null;

function asQuery(value: unknown): QueryLike {
  const candidate = value as Partial<QueryLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.querySelector !== 'function' ||
    typeof candidate.querySelectorAll !== 'function'
  ) {
    throw new Error('expected a rendered tree');
  }
  return candidate as QueryLike;
}

function tree(): QueryLike {
  if (container === null) throw new Error('nothing has been rendered');
  return container;
}

interface NodeLike {
  readonly tagName: string;
  getAttribute(name: string): string | null;
}

function one(selector: string): NodeLike {
  const found = tree().querySelector(selector);
  if (found === null || found === undefined) throw new Error(`nothing matched ${selector}`);
  return found as NodeLike;
}

function all(selector: string): readonly NodeLike[] {
  return [...tree().querySelectorAll(selector)] as NodeLike[];
}

let onChoose = vi.fn();

function renderAt(state: GameState): GameState {
  const session = seated(state);
  onChoose = vi.fn();
  const view = render(h(PlayView, { session, viewer: 0, names: NAMES, onChoose }));
  container = asQuery(view.container);
  return session.state;
}

function oneOf(state: GameState, name: string): ObjectId {
  const found = Object.keys(state.objects).find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no ${name} in this position`);
  return found;
}

function clickCard(oid: ObjectId): void {
  const face = tree().querySelector(`[data-permanent-key="${oid}"] button.mtg-card`);
  if (face === null) throw new Error(`no pressable face for ${oid}`);
  fireEvent.click(face as Parameters<typeof fireEvent.click>[0]);
}

function click(node: NodeLike): void {
  fireEvent.click(node as unknown as Parameters<typeof fireEvent.click>[0]);
}

/**
 * The aim the kernel was actually told about, read off the option the panel
 * submitted rather than off the prose beside it.
 */
function submittedAim(cardName: string, state: GameState): Target | null {
  const controls = new Set([CAST_BACK_LABEL, castCancelLabel(cardName)]);
  const panel = screen.getByRole('group', { name: castLabel(cardName) });
  const action = within(panel)
    .getAllByRole('button')
    .find(
      (button) => !controls.has((button as unknown as { textContent?: string | null }).textContent ?? ''),
    );
  if (action === undefined) throw new Error(`no cast to press on ${cardName}`);
  fireEvent.click(action);
  const index: unknown = onChoose.mock.calls[0]?.[0];
  const submitted = pendingDecision(state)?.options[index as number];
  if (submitted === undefined || submitted.type !== 'castSpell') {
    throw new Error(`the panel submitted no cast for ${cardName}`);
  }
  return submitted.targets[0] ?? null;
}

describe('a seat is aimed at by pressing its pod', () => {
  it('draws no pressable pod while nothing is being aimed', () => {
    // The resting claim, and the one a rule that only ever lights things would
    // fail: outside a target choice a pod is the block it has always been.
    renderAt(skirmish());
    expect(all('.mtg-pod[data-aimable]')).toHaveLength(0);
    expect(one('.mtg-pod[data-seat="opponent"]').tagName.toLowerCase()).toBe('div');
  });

  it('turns both seats into controls when the slot names both', () => {
    const state = renderAt(skirmish());
    clickCard(oneOf(state, LASH.name));

    // `anyTarget` reaches either player, so both pods are answers. They are real
    // buttons, which is what carries the keyboard and the touch target without
    // this surface inventing either.
    expect(all('.mtg-pod[data-aimable]')).toHaveLength(2);
    for (const pod of all('.mtg-pod[data-aimable]')) {
      expect(pod.tagName.toLowerCase()).toBe('button');
    }
  });

  it('attaches the seat that was pressed, not the first the slot offered', () => {
    // Both arms, because one alone passes on a board that sends the slot's first
    // candidate whatever was pressed. `player: 0` is the viewer's own seat and
    // it is the first candidate the enumeration lists, so the opponent's arm is
    // the one that separates the two.
    for (const seat of ['opponent', 'you'] as const) {
      const state = renderAt(skirmish());
      clickCard(oneOf(state, LASH.name));
      click(one(`.mtg-pod[data-seat="${seat}"]`));
      expect(submittedAim(LASH.name, state)).toEqual({
        kind: 'player',
        player: seat === 'you' ? 0 : 1,
      });
      cleanup();
    }
  });

  it('gives the pods back the moment the question is answered', () => {
    const state = renderAt(skirmish());
    clickCard(oneOf(state, LASH.name));
    click(one('.mtg-pod[data-seat="opponent"]'));

    // The slot is answered and the open question is the payment, so nothing on
    // the table is an answer to anything.
    expect(all('.mtg-pod[data-aimable]')).toHaveLength(0);
  });
});

describe('an object on the stack is aimed at by pressing its entry', () => {
  it('gives same-name stack targets distinct React identities', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const state = renderAt(overStack());
      clickCard(oneOf(state, COUNTER.name));
      expect(spy.mock.calls.flat().map(String).join('\n')).not.toContain('same key');
    } finally {
      spy.mockRestore();
    }
  });

  it('draws no pressable entry while nothing is being aimed', () => {
    renderAt(overStack());
    expect(all('.mtg-stack__entry[data-aimable]')).toHaveLength(0);
    // And the entry keeps the inspect handle `mtg-mis1` gave it, out of the tab
    // order, which is the state a row with no move on it is in.
    expect(one('.mtg-stack__entry').getAttribute('tabindex')).toBe('-1');
  });

  it('lights the entry and takes the tab order for as long as the slot is open', () => {
    const state = renderAt(overStack());
    clickCard(oneOf(state, COUNTER.name));

    const entry = one('.mtg-stack__entry[data-aimable]');
    expect(entry.getAttribute('role')).toBe('button');
    expect(entry.getAttribute('tabindex')).toBe('0');
  });

  it('attaches the object the entry stands for, not the first one the slot offered', () => {
    // Both entries in turn, for the reason the two pods are pressed in turn
    // above: a strip that sent the slot's first candidate whatever was pressed
    // passes on one of these and fails on the other.
    for (const position of [0, 1]) {
      const state = renderAt(overStack());
      clickCard(oneOf(state, COUNTER.name));
      const entry = all('.mtg-stack__entry[data-aimable]')[position];
      if (entry === undefined) throw new Error('the strip lit fewer than two entries');
      const wanted = entry.getAttribute('data-permanent-key');

      click(entry);

      // The `spell` shape and that entry's own id, so a strip that pressed with
      // the wrong key or the wrong kind fails rather than passing on a target
      // that happens to be legal.
      expect(submittedAim(COUNTER.name, state)).toEqual({ kind: 'spell', oid: wanted });
      cleanup();
    }
  });

  it('answers the keyboard, which is the whole of what role button promises', () => {
    const state = renderAt(overStack());
    clickCard(oneOf(state, COUNTER.name));
    const entry = one('.mtg-stack__entry[data-aimable]');
    const wanted = entry.getAttribute('data-permanent-key');

    fireEvent.keyDown(entry as unknown as Element, { key: 'Enter' });

    // Enter passes priority on this surface (`../../src/routes/play/pass-key.ts`)
    // and the shortcut steps aside for anything that answers the key itself. It
    // stepped aside for tag names only until this bead, so the one keystroke
    // aimed the spell *and* passed the turn away — which is why the aim is read
    // back through the whole submission rather than only through its target.
    expect(submittedAim(COUNTER.name, state)).toEqual({ kind: 'spell', oid: wanted });
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
