// @vitest-environment jsdom
/**
 * Playing the game by clicking the table.
 *
 * The rail is still the authority and still lists every legal move. What these
 * tests hold is the second way in: a card you can play is a card you can click,
 * and a click is the same index the rail would have submitted. Every assertion
 * here is about the *mapping* rather than about the game that follows, because a
 * mapping that drifts still produces legal games; it just plays the wrong card.
 * That is why the single-choice test asserts the index and not the outcome.
 *
 * Nothing here reads `choicesByObject`. An expectation the mapping computed
 * holds for a wrong mapping too, so the expected index is filtered out of
 * `prompt.choices` by this file's own `actingOn`, and `mapping.test.ts` pins the
 * function itself against a prompt written out by hand.
 *
 * Two properties carry the rest. A card with several choices opens a panel
 * holding only its own, so the widening failure (a panel that shows the whole
 * prompt) is a counted assertion rather than an eyeball. And a card with no
 * choice is not a button at all, so it cannot be clicked and it is not a stop on
 * the way to the ones that can.
 *
 * **Which panel that is depends on the move** (`mtg-bz2.3`). A castable card
 * opens the staged cast, which asks for the aim and then for the payment before
 * anything is submitted; everything else opens the picker, which submits on the
 * press. The stages themselves belong to `cast.test.ts`; what is held here is
 * the mapping either panel rests on, and the panel machinery both share.
 *
 * Cards are addressed by object id, never by name: a hand of two Mountains draws
 * two identical faces, and a test that clicked "the Mountain" would be a test
 * that could not tell which one it played. Slots are drawn in the kernel's own
 * zone order and only the clickable ones are buttons, so the nth button is the
 * nth clickable object and that is the whole of the correspondence.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS, exampleCard, isLand } from '@mtg/dsl';
import type { Choice, GameSession, GameState, ObjectId } from '@mtg/kernel';
import {
  botSeat,
  choose,
  createSession,
  humanSeat,
  pendingDecision,
  scenario,
  simpleAgent,
} from '@mtg/kernel';
import { Battlefield } from '../../src/board/Battlefield';
import { dealMirrorGame } from '../../src/routes/play/deal';
import {
  CAST_BACK_LABEL,
  castCancelLabel,
  castLabel,
  LEGAL_MOVES_LABEL,
  PASS_LABEL,
  PlayView,
  pickerLabel,
} from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt, playableFromHand } from '../../src/routes/play/prompt';
import type { PlayChoice, PlayPrompt } from '../../src/routes/play/prompt';
import { BOARD_CSS, PICKER_INSET_REM, PICKER_WIDTH_REM, PLAY_RAIL_REM } from '../../src/styles/board';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];

/** The seat every one of these tests plays from. */
const VIEWER = 0;

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/**
 * A stated position rather than a dealt one, so every mapping below has an
 * arithmetic answer: two untapped Mountains pay for the two red cards in hand
 * and cannot pay for the green one, and the one creature on the far side gives
 * `Lightning Lash` more than one legal aim.
 */
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
 * The same skirmish with its mana already spent.
 *
 * The same cards in the same order, so every object id matches `skirmish`'s one
 * for one, and nothing in hand but the land is castable. That is the pairing the
 * guard below needs: one object id, two positions, and a different set of moves
 * on it in each.
 */
function spentMana(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[MOUNTAIN, RAIDER, LASH, GUARDIAN], []],
  }).state;
}

/**
 * And the same skirmish at cleanup, holding one card over the limit.
 *
 * The kernel asks for a discard there, and a discard of one names each card in
 * hand exactly once. The object ids match again and every one of them carries a
 * single move, which is the other half of `< 2`.
 */
function overHandSize(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[MOUNTAIN, RAIDER, LASH, GUARDIAN], []],
    maximumHandSize: 3,
    step: 'cleanup',
  }).state;
}

/**
 * A session around a stated position. `PlayView` reads a session and decides
 * nothing, so a literal is the whole of what it needs; the seats are real ones
 * because the view names them.
 */
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
    // No choice has been recorded, so nothing has committed and nothing is
    // undoable. `@mtg/kernel`'s `undo.ts` carries what closes a boundary.
    beat: null,
    committed: null,
  };
}

/**
 * The offered choices that act on one object, filtered here rather than read
 * from `choicesByObject`. That is the whole oracle discipline of this file: the
 * mapping is what is on trial, so nothing it returns is allowed to stand as the
 * expected answer.
 */
function actingOn(prompt: PlayPrompt, oid: ObjectId): readonly PlayChoice[] {
  return prompt.choices.filter((choice) => choice.oids.includes(oid));
}

/**
 * The node members these tests read, checked at runtime. The workspace tsconfig
 * has no `lib: dom`, so `HTMLElement` here carries none of them; `play.test.ts`
 * declares its own shape for the same reason.
 */
interface NodeLike {
  readonly isConnected: boolean;
  readonly focus: () => void;
  readonly matches: (selector: string) => boolean;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<unknown> & Iterable<unknown>;
}

function nodeOf(value: unknown): NodeLike {
  const candidate = value as Partial<NodeLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.focus !== 'function' ||
    typeof candidate.matches !== 'function' ||
    typeof candidate.querySelector !== 'function'
  ) {
    throw new Error('expected an element in the document');
  }
  return candidate as NodeLike;
}

/** The rendered document, reached without a DOM lib (the tsconfig has none). */
function bodyNode(): unknown {
  const host = globalThis as { readonly document?: { readonly body?: unknown } };
  return host.document?.body;
}

/** Whatever holds the focus ring right now. */
function activeNode(): unknown {
  const host = globalThis as { readonly document?: { readonly activeElement?: unknown } };
  return host.document?.activeElement;
}

/** The slot drawn for one object, found by the object id the slot publishes. */
function slotOf(container: unknown, oid: ObjectId): NodeLike {
  return nodeOf(nodeOf(container).querySelector(`[data-permanent-key="${oid}"]`));
}

/** The pressable face inside that slot. The hover zoom draws no button. */
function faceOf(container: unknown, oid: ObjectId): NodeLike {
  return nodeOf(slotOf(container, oid).querySelector('button.mtg-card'));
}

/** Every selector in the shipped board sheet that keys on the picking mark. */
function pickingRules(): readonly string[] {
  return [...BOARD_CSS.matchAll(/([^{}]*\[data-picking[^{}]*)\{/g)].map((match) => (match[1] ?? '').trim());
}

function promptOf(session: GameSession): PlayPrompt {
  const decision = session.pending;
  if (decision === null) throw new Error('expected a pending decision');
  return buildPrompt(session.state, decision, NAMES);
}

function handOid(state: GameState, name: string): ObjectId {
  const found = state.players[VIEWER].hand.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no ${name} in hand`);
  return found;
}

/** Whatever `getByRole` hands back, named without `lib: dom`; see `play.test.ts`. */
type Found = ReturnType<typeof screen.getByRole>;

/**
 * A found element's text, reached structurally. The workspace tsconfig has no
 * `lib: dom`, so `HTMLElement` here carries no members at all; `play.test.ts`
 * declares its own node shape for the same reason.
 */
function textOfNode(node: Found): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

function zone(label: string): Found {
  return screen.getByRole('region', { name: label });
}

/**
 * The pressable faces of a zone. A card face carries `aria-pressed` and a
 * picker's options do not, which is what keeps an open picker out of this list
 * even though it is drawn inside the slot it belongs to.
 */
function faces(label: string): readonly Found[] {
  return within(zone(label)).queryAllByRole('button', { pressed: false });
}

/** The hand objects that are drawn as buttons, in the order the rail draws them. */
function handOrder(state: GameState, prompt: PlayPrompt): readonly ObjectId[] {
  const playable = playableFromHand(prompt);
  return state.players[VIEWER].hand.filter((oid) => playable.has(oid));
}

/**
 * The battlefield objects that are drawn as buttons, in the order the row draws
 * them: card faces first, then the land chips, both in battlefield order.
 */
function fieldOrder(state: GameState, prompt: PlayPrompt): readonly ObjectId[] {
  const mine = state.battlefield.filter((oid) => state.objects[oid]?.controller === VIEWER);
  const isMyLand = (oid: ObjectId): boolean => {
    const card = state.objects[oid]?.card;
    return card !== undefined && isLand(card);
  };
  const ordered = [...mine.filter((oid) => !isMyLand(oid)), ...mine.filter(isMyLand)];
  return ordered.filter((oid) => actingOn(prompt, oid).length > 0);
}

function clickAt(list: readonly Found[], at: number, what: string): void {
  const target = list[at];
  if (target === undefined) throw new Error(`no face on offer for ${what}`);
  fireEvent.click(target);
}

function clickHand(state: GameState, prompt: PlayPrompt, oid: ObjectId): void {
  const order = handOrder(state, prompt);
  const found = faces('your hand');
  expect(found).toHaveLength(order.length);
  clickAt(found, order.indexOf(oid), oid);
}

/**
 * The same click, found by the card rather than by where it sits in the row.
 *
 * `clickHand` above checks the whole hand on the way past — every card the
 * enumeration says is playable has a face — and that precondition is false in
 * one place: while a staged cast is waiting on a target the rest of the hand is
 * inert, because a click on another card there would silently drop the aim
 * (`mtg-bz2.6`, `src/routes/play/table.ts`). So the second press of the cancel
 * gesture goes through this instead of asserting a row that is deliberately
 * short.
 */
function clickHandCard(oid: ObjectId): void {
  const face = within(zone('your hand'))
    .queryAllByRole('button', { pressed: false })
    .find(
      (button) =>
        (button as unknown as { closest(s: string): unknown }).closest(`[data-permanent-key="${oid}"]`) !==
        null,
    );
  if (face === undefined) throw new Error(`no pressable face in hand for ${oid}`);
  fireEvent.click(face);
}

function clickField(state: GameState, prompt: PlayPrompt, oid: ObjectId): void {
  const order = fieldOrder(state, prompt);
  const found = faces('your battlefield');
  expect(found).toHaveLength(order.length);
  clickAt(found, order.indexOf(oid), oid);
}

/**
 * One permanent's face wherever the table has put it.
 *
 * `clickField` reads the row by index and cannot follow a card out of it, and a
 * declared or staged attacker is drawn in the combat band between the two seats
 * rather than in either row (`../../src/board/CombatZone.ts`). The permanent key
 * is the kernel object id and it travels with the card, so this finds the same
 * button either way.
 */
function clickPermanent(oid: ObjectId): void {
  const face = nodeOf(bodyNode()).querySelector(`[data-permanent-key='${oid}'] button`);
  if (face === null) throw new Error(`no face on the table for ${oid}`);
  fireEvent.click(face as unknown as Element);
}

/**
 * The confirm at the end of the combat band, when an attack is being built.
 *
 * Clicking a creature during declare attackers stages it and submits nothing:
 * the whole declaration crosses to the kernel once, at this button
 * (`../../src/routes/play/combat.ts`). Returns false when no attack is being
 * declared, so the driving loop can tell "staged, needs confirming" from
 * "the click opened a panel".
 */
function confirmAttack(): boolean {
  const button = nodeOf(bodyNode()).querySelector(".mtg-combat__button[data-kind='confirm']");
  if (button === null) return false;
  fireEvent.click(button as unknown as Element);
  return true;
}

/** What a choice's button reads as: the label, then the detail line under it. */
function textOf(choice: PlayChoice): string {
  return choice.detail === null ? choice.label : `${choice.label}${choice.detail}`;
}

/**
 * The rail's button for one choice, or the fixed pass for the one choice that
 * has no rail button.
 *
 * `passPriority` left the enumerated list on 2026-08-20 for a fixed home in the
 * priority foot (`../../src/routes/play/rail.ts`'s `UNLISTED`), so a driver that
 * looked for it among the group's buttons found a note instead. The index it
 * submits is the same one it always was — that is the whole of what this driver
 * is checking — so the change here is which button carries it.
 *
 * Two choices can read the same (a hand with two Mountains offers "Play
 * Mountain" twice), so the button is found by its position among the ones that
 * read alike. Choices that read alike are the same kind, so they sit in the same
 * rail group in prompt order, and that position is the same on both sides.
 */
function clickRail(prompt: PlayPrompt, choice: PlayChoice): void {
  if (choice.kind === 'passPriority') {
    fireEvent.click(screen.getByRole('button', { name: PASS_LABEL }));
    return;
  }
  const text = textOf(choice);
  const alike = prompt.choices.filter((other) => textOf(other) === text);
  const ordinal = alike.findIndex((other) => other.index === choice.index);
  const buttons = within(screen.getByRole('group', { name: LEGAL_MOVES_LABEL }))
    .getAllByRole('button')
    .filter((button) => textOfNode(button) === text);
  clickAt(buttons, ordinal, text);
}

function pickerOptions(cardName: string): readonly Found[] {
  return within(screen.getByRole('group', { name: pickerLabel(cardName) })).getAllByRole('button');
}

/**
 * The staged cast open on a card, or null. A castable card opens this instead of
 * a picker (`../../src/routes/play/cast.ts`), so the tests below that used to
 * find a menu of aimings on `Lightning Lash` find the first stage of its cast.
 */
function castGroup(cardName: string): Found | null {
  return screen.queryByRole('group', { name: castLabel(cardName) });
}

/** The buttons that answer the stage on screen, rather than back out of it. */
function castActions(cardName: string): readonly Found[] {
  const group = castGroup(cardName);
  if (group === null) throw new Error(`no staged cast is open on ${cardName}`);
  const controls = new Set([CAST_BACK_LABEL, castCancelLabel(cardName)]);
  return within(group)
    .getAllByRole('button')
    .filter((button) => !controls.has(textOfNode(button)));
}

/**
 * Walks an open staged cast to its submission, always taking the first answer.
 *
 * The first answer at every stage is the first enumerated one, so this lands on
 * the card's first enumerated cast — which is what a driver that used to press
 * the first option of the picker was choosing, and what the two loops below
 * still expect.
 */
function finishCast(cardName: string): void {
  for (let stage = 0; stage < 8 && castGroup(cardName) !== null; stage += 1) {
    clickAt(castActions(cardName), 0, `stage ${String(stage)} of casting ${cardName}`);
  }
}

describe('a card that maps to one choice', () => {
  it('dispatches that choice index, so the mapping fails before the game does', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const land = handOid(session.state, 'Mountain');
    const onLand = actingOn(prompt, land);
    expect(onLand.map((choice) => choice.kind)).toEqual(['playLand']);
    const drop = onLand[0];
    if (drop === undefined) throw new Error('the position offered no land drop');

    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    clickHand(session.state, prompt, land);

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(drop.index);
  });

  it('taps a land for mana from the chip, which is the same one choice', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const inPlay = session.state.battlefield.find((oid) => session.state.objects[oid]?.controller === VIEWER);
    if (inPlay === undefined) throw new Error('the scenario put no land in play');
    const onLand = actingOn(prompt, inPlay);
    expect(onLand.map((choice) => choice.kind)).toEqual(['activateManaAbility']);
    const tap = onLand[0];
    if (tap === undefined) throw new Error('the position offered no mana ability');

    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    clickField(session.state, prompt, inPlay);

    expect(onChoose).toHaveBeenCalledWith(tap.index);
  });
});

/**
 * A castable card no longer opens the picker at all: it opens the staged cast,
 * which asks for the aim and then for the payment before anything is submitted
 * (`mtg-bz2.3`, and `cast.test.ts` holds the stages themselves). What is kept
 * here is the *mapping* property this file is about — the panel holds this
 * card's own moves and no others — restated against the panel that now draws
 * them.
 */
describe('a card the kernel offers a cast for', () => {
  it('opens the staged cast holding exactly its own aims and no others', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    const mine = actingOn(prompt, lash);
    expect(mine.length).toBeGreaterThan(1);
    // The mutation this test exists to catch: a panel widened to the whole
    // prompt would offer every legal move, and the count is what says so.
    expect(mine.length).toBeLessThan(prompt.choices.length);

    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    expect(castGroup('Lightning Lash')).toBeNull();

    clickHand(session.state, prompt, lash);
    // Opening the cast is not making it: nothing has been submitted yet.
    expect(onChoose).not.toHaveBeenCalled();

    // One aim per enumerated cast of this card, and no aim from anything else.
    expect(castActions('Lightning Lash')).toHaveLength(mine.length);

    clickAt(castActions('Lightning Lash'), 1, 'the second aim');
    expect(onChoose).not.toHaveBeenCalled();
    clickAt(castActions('Lightning Lash'), 0, 'the cast');
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(mine[1]?.index);
  });

  it('cancels the staged cast when the same card is clicked again', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');

    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    clickHand(session.state, prompt, lash);
    expect(castGroup('Lightning Lash')).not.toBeNull();

    // The card being cast is the one card in hand that stays pressable while its
    // target is being chosen, and this is why: clicking it again is the cancel.
    clickHandCard(lash);
    expect(castGroup('Lightning Lash')).toBeNull();
    // Canceling a staged cast reaches nothing: it was never submitted.
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('a card with nothing on offer', () => {
  it('is not a button, so it cannot be clicked and it is not a tab stop', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const playable = playableFromHand(prompt);
    const held = session.state.players[VIEWER].hand.length;
    expect(playable.size).toBeLessThan(held);

    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));
    const hand = zone('your hand');
    expect(within(hand).queryAllByRole('button')).toHaveLength(playable.size);
    // Still drawn. Hidden and inert are different answers, and inert is the
    // whole answer: the word that used to be printed under such a card said
    // what not being pressable already says.
    // `getAllByText`, because the slot draws the face and the hover zoom's copy
    // of it, and both print the name.
    expect(within(hand).getAllByText('Thornhide Guardian').length).toBeGreaterThan(0);
    expect(within(hand).queryAllByText('unplayable')).toHaveLength(0);

    // "Not a button" is still the whole of "not a tab stop". Every `tabindex`
    // in the tree is `-1`, and `-1` is the index that means "a pointer may
    // focus this, the tab order may not reach it": the shell's own, which takes
    // the ring only when `PlayView` hands it back after a pointer press on a
    // panel header (`mtg-s9p`), and one on each inert card face, which is what
    // lets a finger open that card's zoom panel on a phone
    // (`../../src/card/Card.ts` argues it, `./zoom-touch.browser.test.ts`
    // measures it). What would break the order is a positive index, or a `0` on
    // a face that has no move to offer, and neither is here.
    const markup = renderToStaticMarkup(
      h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }),
    );
    const indices = markup.match(/tabindex="[^"]*"/g) ?? [];
    expect(indices.length).toBeGreaterThan(1);
    expect([...new Set(indices)]).toEqual(['tabindex="-1"']);
    expect(markup).toContain('class="mtg-play" tabindex="-1"');
    // And the inert faces are the reason there is more than one of them.
    expect(markup.match(/<div class="mtg-card"[^>]*tabindex="-1"/g) ?? []).not.toHaveLength(0);
  });
});

/**
 * The three moves this bead is about, taken off the table rather than out of the
 * rail. Passing priority is taken on the fixed button in the priority foot and
 * says so: `passPriority` names no object, so there is no card to click for it,
 * and inventing one would be the surface offering a move the enumeration did not
 * attach to anything.
 */
const CLICKED_MOVES = ['playLand', 'castSpell', 'declareAttackers'] as const;

/** The clickable object whose own moves include one of the three, if any. */
function tableTarget(
  state: GameState,
  prompt: PlayPrompt,
): { readonly oid: ObjectId; readonly zone: string } | null {
  const wanted = (oid: ObjectId): boolean =>
    actingOn(prompt, oid).some((choice) => CLICKED_MOVES.some((move) => move === choice.kind));
  const fromHand = handOrder(state, prompt).find(wanted);
  if (fromHand !== undefined) return { oid: fromHand, zone: 'hand' };
  const fromField = fieldOrder(state, prompt).find(wanted);
  return fromField === undefined ? null : { oid: fromField, zone: 'field' };
}

function seededGame(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  return createSession(game.config.setup, game.config.seats);
}

/**
 * The two loops that drive a seeded game are the CPU-bound tests in this file,
 * and they state their own budget rather than borrowing the default.
 *
 * Each one re-renders `PlayView` into jsdom once per decision, and the
 * accessible-name query that finds a button is the expensive part of every step.
 * The two-surface replay plays forty decisions twice, once through the rail and
 * once through the cards; measured alone on an idle machine it took 806-882ms
 * over three runs. Against vitest's 5s default that was nearly 6x headroom and
 * it still timed out: this file has now cost verification time in five separate
 * lanes, because `npm test` runs the balance sweep on the same cores and several
 * agents share this machine.
 *
 * **Casting is staged now, which moved the other loop into the same bracket**
 * (`mtg-bz2.3`). A cast that used to be one press is a walk of the aim and then
 * the payment, so the table-driven loop makes several presses and several
 * accessible-name queries where it made one: measured alone it went from 1138ms
 * to 3844ms, which is inside the default and not by enough to survive a loaded
 * machine.
 *
 * Scoped rather than raised. `vitest.config.ts`'s docblock forbids lifting the
 * global default and `play.test.ts` has a test that fails if anyone does, for
 * the reason that the 5s ceiling everywhere else is what turns a genuine hang
 * into a fast failure. This is the same idiom that file already uses for
 * `CLICK_THROUGH_BUDGET_MS`. Both loops here are bounded — forty decisions and
 * four hundred — so what this tolerates is a busy machine and not a test that
 * never finishes.
 */
const TABLE_DRIVEN_BUDGET_MS = 30_000;

describe('a seeded game driven from the table', () => {
  it(
    'plays a land, casts a creature and declares an attacker by clicking cards',
    { timeout: TABLE_DRIVEN_BUDGET_MS },
    ({ task }) => {
      // Reads back the budget the runner actually applied, the same way the
      // replay below does, so the measurement in the constant's docblock cannot
      // outlive the option that acts on it.
      expect(task.timeout, 'the table-driven loop needs its own budget under load').toBe(
        TABLE_DRIVEN_BUDGET_MS,
      );
      let session = seededGame();
      const dispatched: Choice[] = [];
      const onChoose = (choice: Choice): void => {
        dispatched.push(choice);
      };
      const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
      const fromTable = new Set<string>();

      for (let step = 0; step < 400 && session.pending !== null; step += 1) {
        const decision = session.pending;
        const prompt = buildPrompt(session.state, decision, NAMES);
        const before = dispatched.length;
        // A land is clicked to play it, never to tap it for mana. Tapping every
        // land at every priority is legal, and it spends the turn's mana on
        // nothing: the pool empties at the end of the step and the lands stay
        // tapped, so the greedy version of this loop reached turn 20 having cast
        // one spell. The kernel pays for a cast out of untapped lands itself.
        const target = tableTarget(session.state, prompt);

        if (target === null) {
          const fallback = prompt.choices[0];
          if (fallback === undefined) throw new Error('a pending decision with no choices');
          clickRail(prompt, fallback);
        } else if (target.zone === 'hand') {
          clickHand(session.state, prompt, target.oid);
        } else {
          clickPermanent(target.oid);
        }

        if (dispatched.length === before) {
          // Nothing was submitted, which is one of three things and never a
          // failure. An attack was staged and crosses to the kernel at the
          // confirm; a picker opened, whose first entry is still this card's own
          // move; or a cast was staged and submits once the aim and the payment
          // have been walked.
          const name = target === null ? '' : (session.state.objects[target.oid]?.card.name ?? '');
          if (!confirmAttack()) {
            if (castGroup(name) === null) clickAt(pickerOptions(name), 0, name);
            else finishCast(name);
          }
        }
        const submitted = dispatched[before];
        if (submitted === undefined) throw new Error('the click submitted nothing');
        const action = typeof submitted === 'number' ? decision.options[submitted] : submitted;
        if (target !== null && action !== undefined) fromTable.add(action.type);

        session = choose(session, submitted);
        view.rerender(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
        if (CLICKED_MOVES.every((move) => fromTable.has(move))) break;
      }

      for (const move of CLICKED_MOVES) expect([...fromTable]).toContain(move);
    },
  );

  it(
    'records the same choice log through the rail and through the cards',
    { timeout: TABLE_DRIVEN_BUDGET_MS },
    ({ task }) => {
      // Reads back the budget the runner actually applied: drop the option above
      // and this is 5000, so the docblock on the constant cannot outlive what it
      // describes. The same readback `play.test.ts` makes of its own budget.
      expect(task.timeout, 'the two-surface replay needs its own budget under load').toBe(
        TABLE_DRIVEN_BUDGET_MS,
      );
      // One policy, two surfaces. The policy names an action; each surface finds
      // its own way to it; the logs are compared. A mapping that dispatched a
      // neighboring index would still play a legal game and would still diverge
      // here on the first duplicate card.
      const played = (surface: 'rail' | 'cards'): readonly Choice[] => {
        let session = seededGame();
        const dispatched: Choice[] = [];
        const onChoose = (choice: Choice): void => {
          dispatched.push(choice);
        };
        const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

        // Bounded rather than played out: this compares two surfaces against each
        // other, and the surfaces have either drifted by the fortieth decision or
        // they have not. A whole game here would be two whole games of jsdom
        // renders, and the accessible-name query that finds a rail button is the
        // expensive part of each one, against the five-second budget every test
        // but the click-through in `play.test.ts` keeps.
        for (let step = 0; step < 40 && session.pending !== null; step += 1) {
          const prompt = promptOf(session);
          const hand = new Set(session.state.players[VIEWER].hand);
          const wanted =
            prompt.choices.find(
              (choice) =>
                (choice.kind === 'playLand' || choice.kind === 'castSpell') &&
                choice.oids.every((oid) => hand.has(oid)),
            ) ?? prompt.choices[0];
          if (wanted === undefined) throw new Error('a pending decision with no choices');

          const before = dispatched.length;
          if (surface === 'rail' || wanted.oids.length === 0) {
            clickRail(prompt, wanted);
          } else {
            const oid = wanted.oids[0];
            if (oid === undefined) throw new Error('a choice with an empty object list');
            clickHand(session.state, prompt, oid);
            if (dispatched.length === before) {
              const name = session.state.objects[oid]?.card.name ?? '';
              if (castGroup(name) === null) {
                const options = pickerOptions(name);
                const mine = actingOn(prompt, oid);
                clickAt(
                  options,
                  mine.findIndex((choice) => choice.index === wanted.index),
                  name,
                );
              } else {
                // `wanted` is the first choice in prompt order that names a card
                // in hand, and one card's casts are contiguous in the
                // enumeration, so it is that card's *first* cast — which is
                // exactly where taking the first answer at every stage lands.
                expect(actingOn(prompt, oid)[0]?.index).toBe(wanted.index);
                finishCast(name);
              }
            }
          }
          const index = dispatched[before];
          if (index === undefined) throw new Error('the click submitted nothing');
          session = choose(session, index);
          view.rerender(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
        }
        cleanup();
        return session.choices;
      };

      const byRail = played('rail');
      const byCards = played('cards');
      // A handful of passes into a stall would make the comparison vacuous.
      expect(byRail.length).toBeGreaterThan(20);
      expect(byCards).toEqual(byRail);
    },
  );
});

/**
 * The panel that hangs off a card, whichever panel it is.
 *
 * Every property below belongs to `useTableSelection` rather than to the picker
 * — it takes the ring on open, gives it back on close, closes on Escape from
 * anywhere on the table, and does not outlive the enumeration it was opened
 * against — so they are exercised through the staged cast, which is the panel a
 * player actually opens now. The picker's own two guard branches keep their
 * tests at the foot of this file.
 */
describe('the panel on a card as a menu', () => {
  it('takes the focus ring on open and hands it back on close', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    expect(actingOn(prompt, lash).length).toBeGreaterThan(1);

    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));
    // The face is reached by the object id its slot publishes, because a hand of
    // two Mountains draws two faces that read the same.
    const face = faceOf(view.container, lash);
    face.focus();
    expect(activeNode()).toBe(face);

    fireEvent.click(face);
    // A menu that opens behind the keyboard is a menu the keyboard cannot use.
    expect(activeNode()).toBe(castActions('Lightning Lash')[0]);

    fireEvent.click(face);
    expect(castGroup('Lightning Lash')).toBeNull();
    // And a menu that closes without giving the ring back leaves the player at
    // the top of the document, one Tab from where they were.
    expect(activeNode()).toBe(face);
  });

  it('marks the slot it hangs on, and the shipped sheet draws that mark', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    const raider = handOid(session.state, 'Emberflow Raider');

    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));
    clickHand(session.state, prompt, lash);

    expect(slotOf(view.container, lash).matches("[data-picking='true']")).toBe(true);
    expect(slotOf(view.container, raider).matches("[data-picking='true']")).toBe(false);

    // The mark is only a mark if something draws it. An attribute no rule keys
    // on can be deleted with every test still green, which is how it got here.
    const rules = pickingRules();
    expect(rules).not.toHaveLength(0);
    for (const selector of rules) {
      expect(nodeOf(view.container).querySelectorAll(selector).length).toBe(1);
    }
  });

  it('closes on Escape, which is the key everyone tries, and hands the ring back', () => {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    // A picker only opens on a card with more than one move on offer.
    expect(actingOn(prompt, lash).length).toBeGreaterThan(1);

    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    const face = faceOf(view.container, lash);
    face.focus();
    fireEvent.click(face);
    const first = castActions('Lightning Lash')[0];
    if (first === undefined) throw new Error('the panel drew no options');
    expect(activeNode()).toBe(first);

    fireEvent.keyDown(first, { key: 'Escape' });

    expect(castGroup('Lightning Lash')).toBeNull();
    // The same hand-back the click path gets. A menu that closes and leaves the
    // ring where the menu was drops the player at the top of the document.
    expect(activeNode()).toBe(face);
    // Escape dismisses a menu; it does not submit the option under the ring.
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('still closes on Escape once the ring has left the panel', () => {
    const session = seated(skirmish());
    const lash = handOid(session.state, 'Lightning Lash');
    expect(actingOn(promptOf(session), lash).length).toBeGreaterThan(1);

    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    const face = faceOf(view.container, lash);
    face.focus();
    fireEvent.click(face);
    expect(activeNode()).toBe(castActions('Lightning Lash')[0]);

    // Shift+Tab is the way out the panel had before Escape was wired, and it
    // lands on this card's own face: the slot draws the face first and the
    // picker last (`board/CardSlot.ts`), and the board sets no tabindex
    // anywhere, so the option's previous tab stop is the face. That ordering is
    // asserted below. jsdom moves no focus of its own, so the ring is put where
    // chromium puts it and the key is pressed from there; chromium at 1440x900,
    // 1280x800 and 1024x768 all landed on this slot's `button.mtg-card`, and the
    // numbers are in the commit message.
    const slot = slotOf(view.container, lash);
    const inSlot = [...slot.querySelectorAll('button')];
    const panel = castGroup('Lightning Lash');
    if (panel === null) throw new Error('the panel did not open');
    expect(inSlot[0]).toBe(face);
    expect(inSlot.slice(1)).toEqual([...within(panel).getAllByRole('button')]);
    face.focus();
    expect(activeNode()).toBe(face);

    fireEvent.keyDown(face, { key: 'Escape' });

    // Handled on the panel, this did nothing at all: the panel is not an
    // ancestor of the card that opened it, so nothing bubbled to it.
    expect(castGroup('Lightning Lash')).toBeNull();
    expect(activeNode()).toBe(face);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('does not survive a decision made through the rail', () => {
    let session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    const tap = prompt.choices.find((choice) => choice.kind === 'activateManaAbility');
    if (tap === undefined) throw new Error('the position offered no mana ability');

    const view = render(
      h(PlayView, {
        session,
        viewer: VIEWER,
        names: NAMES,
        onChoose: (choice: Choice): void => {
          session = choose(session, choice);
        },
      }),
    );
    clickHand(session.state, prompt, lash);
    expect(castGroup('Lightning Lash')).not.toBeNull();

    // The rail is the other surface and it is still the authority. Pressing it
    // under an open panel leaves that panel holding indices into a list the
    // kernel has already replaced, so every button in it now submits some other
    // decision's move.
    clickRail(prompt, tap);
    view.rerender(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));
    expect(session.decisions).toBe(1);

    // The card still has more than one move on offer, so a panel on it is still
    // drawable: what closed it is the guard, not the absence of anything to show.
    expect(actingOn(promptOf(session), lash).length).toBeGreaterThan(1);
    expect(castGroup('Lightning Lash')).toBeNull();
  });
});

/**
 * The picker's own guard, and the two states that reach it.
 *
 * No click of the player's gets here: `select` only ever names a card it found
 * two or more choices on. A *session* gets here. This view owns no game state,
 * and an open picker survives a re-render by comparing `session.decisions`,
 * which is a counter and not an identity. Two sessions at one count are two
 * different positions, and one object id does not carry the same moves in both:
 * `advance` re-settles a session without submitting a choice and leaves the
 * count where it was, `usePlaySession`'s `restart` lands on the length of the
 * replayed choice log, and the module's stated contract is a session handed in
 * from outside, which is what lets one view serve a live game and a resumed
 * recording. Nothing inside `PlayView` has to go wrong for either state below to
 * arrive.
 *
 * Both halves of `< 2` are entered, because they fail differently. None is an
 * empty menu, titled with a card, drawn on a card the player never clicked. One
 * is worse than empty: a menu offering a single move, which is exactly the move
 * a click on that card plays outright without ever opening a menu.
 */
describe('a picker whose list moved out from under it', () => {
  /** Opens the panel on Lightning Lash, and hands back the view and its id. */
  function opened(): { readonly view: ReturnType<typeof render>; readonly lash: ObjectId } {
    const session = seated(skirmish());
    const prompt = promptOf(session);
    const lash = handOid(session.state, 'Lightning Lash');
    const mine = actingOn(prompt, lash);
    expect(mine.length).toBeGreaterThan(1);
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));
    clickHand(session.state, prompt, lash);
    expect(castActions('Lightning Lash')).toHaveLength(mine.length);
    return { view, lash };
  }

  it('draws nothing when the card is left with no move at all', () => {
    const { view, lash } = opened();
    const dry = seated(spentMana());
    // The premise, asserted rather than assumed: one decision count, one object
    // id, and nothing on offer for it in the position that arrives.
    expect(dry.decisions).toBe(0);
    expect(handOid(dry.state, 'Lightning Lash')).toBe(lash);
    expect(actingOn(promptOf(dry), lash)).toHaveLength(0);

    view.rerender(h(PlayView, { session: dry, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));

    expect(castGroup('Lightning Lash')).toBeNull();
    expect(screen.queryByRole('group', { name: pickerLabel('Lightning Lash') })).toBeNull();
  });

  it('draws nothing when the card is left with one, which a click already plays', () => {
    const { view, lash } = opened();
    const discarding = seated(overHandSize());
    expect(discarding.decisions).toBe(0);
    expect(handOid(discarding.state, 'Lightning Lash')).toBe(lash);
    expect(actingOn(promptOf(discarding), lash)).toHaveLength(1);

    view.rerender(h(PlayView, { session: discarding, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));

    expect(castGroup('Lightning Lash')).toBeNull();
    expect(screen.queryByRole('group', { name: pickerLabel('Lightning Lash') })).toBeNull();
  });
});

/**
 * A land with a picker on it, at the component's own level.
 *
 * `PlayView` cannot reach this today: two moves on one land means two mana
 * abilities, and the DSL rejects a land that produces more than its basic type
 * does (`LAND_MANA_MISMATCH`). `pickerFor` is `Battlefield`'s prop all the same,
 * and what this holds is that a land pays no price for being in a band: its
 * picker is a sibling inside its own slot, exactly as a spell's is, so opening
 * one changes neither the element type nor the key of the face the player had
 * tabbed to.
 *
 * That property used to need a wrapper and a comment. While a land was a chip
 * the chip was itself the button, so the picker could not be nested in it and
 * had to ride in a Fragment beside it — and wrapping only while the picker was
 * open swapped a keyed button for a keyed Fragment, which is a remount: the
 * press that opened the menu destroyed the element holding the focus ring. The
 * face carries its own picker, so the wrapper is gone and this test is what says
 * the property survived it.
 */
describe('a land with a picker open on it', () => {
  const landRow = (openOn: string | null): ReactElement =>
    h(Battlefield, {
      label: 'your battlefield',
      permanents: [{ key: 'o0', card: MOUNTAIN }],
      onSelect: (): void => {},
      pickerFor: (key: string): ReactNode =>
        key === openOn ? h('div', { className: 'mtg-picker' }, 'two moves') : null,
    });

  it('keeps its own node, and the focus ring on it, when the picker opens', () => {
    const view = render(landRow(null));
    const face = faceOf(view.container, 'o0');
    face.focus();
    expect(activeNode()).toBe(face);

    view.rerender(landRow('o0'));

    expect(face.isConnected).toBe(true);
    expect(activeNode()).toBe(face);
    expect(nodeOf(view.container).querySelectorAll('.mtg-picker').length).toBe(1);
  });
});

/**
 * Where the picker opens.
 *
 * It opened on the start corner and covered the hand it was asking about:
 * measured in chromium at 1440x900, the panel came out [16,705,240,179] and the
 * two hand slots under it [30,665,150,217] and [188,665,150,217], so the card
 * the menu belonged to was behind the menu. jsdom lays nothing out and cannot
 * see that, so what is asserted here is the arithmetic the placement rests on:
 * the cards are in the lanes column, the picker is inside the rail's width at
 * the other end of the mat, and a box narrower than the rail anchored to the
 * window's end edge cannot cross into the column the cards are drawn in. The
 * pixel numbers before and after live in the commit message, taken at 1440x900
 * and 1280x800.
 */
describe('where the picker opens', () => {
  /** The declarations of the shipped `.mtg-picker` rule, as written. */
  function pickerRule(): string {
    const found = /\n\.mtg-picker \{([^}]*)\}/.exec(BOARD_CSS);
    const body = found?.[1];
    if (body === undefined) throw new Error('the board sheet declares no .mtg-picker rule');
    return body;
  }

  it('fits inside the rail column, which is the column with no cards in it', () => {
    expect(PICKER_INSET_REM + PICKER_WIDTH_REM).toBeLessThanOrEqual(PLAY_RAIL_REM);
  });

  it('is anchored to the end edge, and the sheet carries those numbers', () => {
    const rule = pickerRule();
    expect(rule).toContain(`width: ${String(PICKER_WIDTH_REM)}rem`);
    expect(rule).toContain(`inset-inline-end: ${String(PICKER_INSET_REM)}rem`);
    // The start corner is the hand's corner: anchoring there is the defect.
    expect(rule).not.toContain('inset-inline-start');
  });
});
