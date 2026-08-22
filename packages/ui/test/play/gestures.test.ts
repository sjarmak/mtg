// @vitest-environment jsdom
/**
 * The three gestures on one card, and what each of them is allowed to decide.
 *
 * `mtg-bz2.2` states the model: single click is the obvious action, double click
 * is the default action, right click is the menu. `click.test.ts` already holds
 * the first of those — a card with one move plays it, a card with several opens a
 * picker holding exactly its own moves, a second click closes it — so this file
 * holds the other two and the line between them.
 *
 * The line is the playtester's own constraint, and it is what most of these
 * assertions are really about: *do not make the UI excessively infer intent*. A
 * gesture is allowed to submit a move the player can name in advance and nothing
 * else. So the double click on a spell with two legal aims submits nothing at
 * all, and the assertion that it submits nothing is the load-bearing one in this
 * file — a surface that picked the first aim would pass every other test here.
 *
 * Nothing below reads `defaultChoice` to build its expectation, for the reason
 * `click.test.ts` does not read `choicesByObject`: an expectation the rule
 * computed holds for a wrong rule too. The expected index is filtered out of
 * `prompt.choices` by this file's own `actingOn`, and the one test that pins the
 * rule itself states the choices by hand.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState, ObjectId } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { Hand } from '../../src/board/Hand';
import { PlayView, pickerLabel } from '../../src/routes/play/PlayView';
import { defaultChoice } from '../../src/routes/play/default-action';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';
import type { PlayChoice, PlayPrompt } from '../../src/routes/play/prompt';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0;

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/** The same stated position `click.test.ts` reasons from, and for the same reason. */
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

/**
 * Two creatures that can attack, which is the one shape where a card has several
 * moves *and* a default.
 *
 * The kernel enumerates attacks as combinations, so each creature is named by an
 * option holding it alone and by an option holding both. That is what makes the
 * default well defined without anyone ranking anything: exactly one of the two
 * names this creature and nothing else.
 */
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

/**
 * The node members these tests read, checked at runtime. The workspace tsconfig
 * has no `lib: dom`, so `HTMLElement` here carries none of them.
 */
interface NodeLike {
  readonly focus: () => void;
  readonly matches: (selector: string) => boolean;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<unknown> & Iterable<unknown>;
  readonly getAttribute: (name: string) => string | null;
}

function nodeOf(value: unknown): NodeLike {
  const candidate = value as Partial<NodeLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.focus !== 'function' ||
    typeof candidate.matches !== 'function' ||
    typeof candidate.querySelectorAll !== 'function' ||
    typeof candidate.getAttribute !== 'function' ||
    typeof candidate.querySelector !== 'function'
  ) {
    throw new Error('expected an element in the document');
  }
  return candidate as NodeLike;
}

function slotOf(container: unknown, oid: ObjectId): NodeLike {
  return nodeOf(nodeOf(container).querySelector(`[data-permanent-key="${oid}"]`));
}

/** The pressable face inside one object's slot; a card with nothing to do has none. */
function faceOf(container: unknown, oid: ObjectId): NodeLike {
  return nodeOf(slotOf(container, oid).querySelector('button.mtg-card'));
}

/** The face however it is drawn, pressable or inert. */
function anyFaceOf(container: unknown, oid: ObjectId): NodeLike {
  return nodeOf(slotOf(container, oid).querySelector('.mtg-card'));
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

type Found = ReturnType<typeof screen.getByRole>;

function textOfNode(node: Found): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

function textOf(choice: PlayChoice): string {
  return choice.detail === null ? choice.label : `${choice.label}${choice.detail}`;
}

function menu(cardName: string): Found | null {
  return screen.queryByRole('group', { name: pickerLabel(cardName) });
}

function menuOptions(cardName: string): readonly Found[] {
  return within(screen.getByRole('group', { name: pickerLabel(cardName) })).getAllByRole('button');
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

describe('the default action a double click plays', () => {
  it('is the one move naming this card and nothing else', () => {
    // Stated by hand rather than enumerated, because this is the one test whose
    // subject is the rule itself. Two moves on one card: one about the card
    // alone, one about the card and a second object.
    const alone: PlayChoice = {
      index: 4,
      label: 'Attack with Emberflow Raider',
      detail: null,
      kind: 'declareAttackers',
      oids: ['o0'],
    };
    const together: PlayChoice = {
      index: 7,
      label: 'Attack with Emberflow Raider, Thornhide Guardian',
      detail: null,
      kind: 'declareAttackers',
      oids: ['o0', 'o1'],
    };
    expect(defaultChoice([alone, together])).toBe(alone);
    // Two moves about the card alone are two different moves, and neither is
    // more default than the other. This is the refusal, not a gap.
    expect(defaultChoice([alone, { ...together, oids: ['o0'] }])).toBeNull();
    // Nothing about the card alone is the same refusal from the other side.
    expect(defaultChoice([together, { ...together, index: 8, oids: ['o0', 'o2'] }])).toBeNull();
    // A card repeatedly named by one move is still named by one object.
    expect(defaultChoice([{ ...alone, oids: ['o0', 'o0'] }])).toEqual({ ...alone, oids: ['o0', 'o0'] });
  });
});

describe('the gestures on a creature being staged for combat', () => {
  /**
   * This block used to say that a double click on a creature during declare
   * attackers "attacks with just that creature", and that a click before it
   * opened a menu of the declarations naming that creature. Both were true and
   * both are gone, because the playtester asked for the step to work the other way
   * (`../../src/routes/play/combat.ts`, `mtg-bz2.5`): a click stages the
   * creature into the combat band and the whole declaration crosses to the
   * kernel once, at the confirm.
   *
   * What that leaves the two other gestures is nothing at all, and the reason is
   * the confirm boundary rather than tidiness: on this decision every option the
   * enumeration offers is a *whole* attack declaration, so a double click that
   * played "the default move" would commit the player to an attack they were
   * still building. The complete enumeration is still in the ask column, by
   * index and by keyboard, which is where a player who wants to declare in one
   * press goes.
   */
  it('stages on a click and submits nothing at all', () => {
    const session = seated(combat());
    const prompt = promptOf(session);
    const raider = fieldOid(session.state, 'Emberflow Raider');
    // The premise the old version of this block stated: several declarations
    // name this creature, so a click had a menu's worth of them to choose from.
    expect(actingOn(prompt, raider).length).toBeGreaterThan(1);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, raider);

    fireEvent.click(face);
    expect(onChoose).not.toHaveBeenCalled();
    expect(menu('Emberflow Raider')).toBeNull();
    expect(stagedKeys(rendered.container)).toEqual([raider]);

    // And a second click takes it back out, which is the whole of what
    // The playtester asked the second click to do. The face is looked up again
    // rather than reused: staging moves the card into the combat band, which is
    // a different parent and therefore a different element, so the node the
    // first click was delivered to is no longer in the document.
    fireEvent.click(faceOf(rendered.container, raider));
    expect(stagedKeys(rendered.container)).toEqual([]);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('answers neither the double click nor the context gesture', () => {
    const session = seated(combat());
    const raider = fieldOid(session.state, 'Emberflow Raider');

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, raider);

    fireEvent.dblClick(face);
    fireEvent.contextMenu(face);
    expect(onChoose).not.toHaveBeenCalled();
    expect(menu('Emberflow Raider')).toBeNull();
  });

  it('submits nothing on a spell whose moves are two different aims', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    const mine = actingOn(prompt, lash);
    // The premise: several moves, every one of them about the card alone,
    // because a cast's target rides in its label rather than in its objects.
    expect(mine.length).toBeGreaterThan(1);
    expect(mine.every((choice) => choice.oids.length === 1)).toBe(true);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    fireEvent.dblClick(faceOf(rendered.container, lash));

    // The whole constraint in one assertion. Picking the first aim would be the
    // surface deciding which spell the player meant to cast.
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('a double click on a card with one move', () => {
  it('submits nothing further, because the first click already played it', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const land = handOid(session.state, 'Mountain');
    expect(actingOn(prompt, land)).toHaveLength(1);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    fireEvent.dblClick(faceOf(rendered.container, land));

    // This is what keeps the two gestures from both acting without a timer
    // swallowing every click on the surface.
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('the second press of a double click', () => {
  /**
   * Measured in chrome-headless-shell 151.0.7922.47 on a bare button: a real
   * double click delivers `click` with `detail: 1`, `click` with `detail: 2`,
   * then `dblclick`. jsdom sends no such sequence of its own, so the repeat is
   * fired here by hand — the browser is where the premise was checked and this
   * is where the surface's answer to it is.
   */
  it('is dropped, so a double click never plays two moves', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const land = handOid(session.state, 'Mountain');
    expect(actingOn(prompt, land)).toHaveLength(1);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    const face = faceOf(rendered.container, land);
    fireEvent.click(face, { detail: 1 });
    fireEvent.click(face, { detail: 2 });
    fireEvent.dblClick(face);

    // One move played by one gesture. Without the guard the second press acts
    // against a hand that has already re-flowed under it.
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  /**
   * Written against the menu, and it is the staged cast that stands there now.
   *
   * `ui/staged-cast` landed between this test and its merge: a castable card
   * routes to `cast.ts`'s panel rather than to a menu of pre-multiplied aimings.
   * The property under test did not change and neither did its reason -- the
   * second press of a double click must leave the panel the first press opened
   * rather than closing it under the gesture -- so this asserts the panel that
   * is actually there instead of the one that was.
   *
   * A castable card also has no double-click default at all now: `activate`
   * refuses one outright, because the payment stage is the thing a submitted
   * aiming would skip. So both presses land on the same panel from two
   * directions, which is what makes the gesture safe here.
   */
  it('leaves the staged cast it opened standing, rather than closing it under the gesture', () => {
    const session = seated(skirmish());
    const lash = handOid(session.state, 'Lightning Lash');

    const rendered = view(session, vi.fn());
    const face = faceOf(rendered.container, lash);
    fireEvent.click(face, { detail: 1 });
    fireEvent.click(face, { detail: 2 });

    expect(screen.queryByRole('group', { name: 'Casting Lightning Lash' })).not.toBeNull();
    expect(menu('Lightning Lash')).toBeNull();
  });

  it('is still a second click on a face with no double-click gesture wired', () => {
    // The deck builder and the galleries pass `onSelect` alone, and two quick
    // presses there are two presses. The guard is scoped to the faces that have
    // something else to protect, so this row is rendered without one.
    const onSelect = vi.fn();
    const rendered = render(h(Hand, { label: 'A hand', cards: [{ key: 'h0', card: MOUNTAIN }], onSelect }));
    const face = faceOf(rendered.container, 'h0');
    fireEvent.click(face, { detail: 1 });
    fireEvent.click(face, { detail: 2 });

    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

describe('a right click on a card', () => {
  it('opens the menu on a card with one move, and keeps the browser out of it', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const tapper = fieldOid(session.state, 'Mountain');
    const mine = actingOn(prompt, tapper);
    expect(mine.map((choice) => choice.kind)).toEqual(['activateManaAbility']);

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    expect(menu('Mountain')).toBeNull();

    // `fireEvent` reports whether the default survived, so the suppression is
    // asserted rather than assumed: two menus for one gesture is one too many.
    expect(fireEvent.contextMenu(faceOf(rendered.container, tapper))).toBe(false);

    // A click plays that move outright; this is how you read it first.
    expect(menuOptions('Mountain').map(textOfNode)).toEqual(mine.map(textOf));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('submits the move when its option is pressed', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const tapper = fieldOid(session.state, 'Mountain');
    const tap = actingOn(prompt, tapper)[0];
    if (tap === undefined) throw new Error('the position offered no mana ability');

    const onChoose = vi.fn();
    const rendered = view(session, onChoose);
    fireEvent.contextMenu(faceOf(rendered.container, tapper));
    const option = menuOptions('Mountain')[0];
    if (option === undefined) throw new Error('the menu drew no options');
    fireEvent.click(option);

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(tap.index);
  });

  /**
   * The same merge, and the same answer: a right click on a castable card opens
   * the staged cast, not a menu.
   *
   * That is the gesture keeping its promise rather than losing it. A right click
   * means "show me what a click would commit me to before it commits me", and
   * the staged cast answers it better than the menu did -- the menu listed every
   * target pre-multiplied into a flat string, and the panel asks one question
   * per target slot and prints the whole aim and the lands it will tap before
   * anything reaches the kernel. The menu path is still covered above, on a card
   * that is not a cast.
   */
  it('opens the staged cast on a castable card, whatever its aim count', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    expect(actingOn(prompt, lash).length).toBeGreaterThan(1);

    const rendered = view(session, vi.fn());
    fireEvent.contextMenu(faceOf(rendered.container, lash));

    expect(screen.queryByRole('group', { name: 'Casting Lightning Lash' })).not.toBeNull();
  });

  it('leaves its own menu open when it is pressed again on the same card', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');

    const rendered = view(session, vi.fn());
    const face = faceOf(rendered.container, tapper);
    fireEvent.contextMenu(face);
    expect(menu('Mountain')).not.toBeNull();

    // Closing belongs to the click and to Escape. A gesture that opened a menu
    // and then closed it would mean two things depending on state.
    fireEvent.contextMenu(face);
    expect(menu('Mountain')).not.toBeNull();
  });

  it('hands the ring back to the card when the menu is dismissed', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');

    const rendered = view(session, vi.fn());
    const face = faceOf(rendered.container, tapper);
    face.focus();
    fireEvent.contextMenu(face);
    const first = menuOptions('Mountain')[0];
    if (first === undefined) throw new Error('the menu drew no options');

    fireEvent.keyDown(first, { key: 'Escape' });

    expect(menu('Mountain')).toBeNull();
    const host = globalThis as { readonly document?: { readonly activeElement?: unknown } };
    expect(host.document?.activeElement).toBe(face);
  });

  it('reaches nothing on a card the position offers no move on', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const green = handOid(session.state, 'Thornhide Guardian');
    expect(actingOn(prompt, green)).toHaveLength(0);

    const rendered = view(session, vi.fn());
    const face = anyFaceOf(rendered.container, green);
    expect(face.matches('button')).toBe(false);

    // The default survives, so the browser's own menu is what a right click on
    // an inert card gets. A page that swallowed it would have taken something
    // away and offered nothing back.
    expect(fireEvent.contextMenu(face)).toBe(true);
    expect(menu('Thornhide Guardian')).toBeNull();
  });
});

describe('the keyboard route to a card menu', () => {
  it('opens on the context key', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');

    const rendered = view(session, vi.fn());
    expect(fireEvent.keyDown(faceOf(rendered.container, tapper), { key: 'ContextMenu' })).toBe(false);

    expect(menu('Mountain')).not.toBeNull();
  });

  it('opens on Shift+F10, for the keyboards without that key', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');

    const rendered = view(session, vi.fn());
    expect(fireEvent.keyDown(faceOf(rendered.container, tapper), { key: 'F10', shiftKey: true })).toBe(false);

    expect(menu('Mountain')).not.toBeNull();
  });

  it('ignores F10 without the modifier, which is a different key entirely', () => {
    const session = seated(skirmish());
    const tapper = fieldOid(session.state, 'Mountain');

    const rendered = view(session, vi.fn());
    expect(fireEvent.keyDown(faceOf(rendered.container, tapper), { key: 'F10' })).toBe(true);

    expect(menu('Mountain')).toBeNull();
  });
});
