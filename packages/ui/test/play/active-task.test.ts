// @vitest-environment jsdom
/**
 * A pending choice becomes the whole of what the table will answer to.
 *
 * `mtg-bz2.9`. The surface was already structurally right about two thirds of
 * this: what a card answers to is `choicesByObject`, the kernel's own
 * enumeration read from the object end, so no card can be pressable for a move
 * the kernel did not offer and every position gets a headline and a sentence out
 * of the same exhaustive switch. What it was missing was the proof, and the
 * proof found the third: **the hand read only the casts.**
 *
 * `prompt.ts`'s `oidsOf` keys a discard and a London bottoming to the cards in
 * your hand and says why outright -- "so a keep is a click on the card it pays
 * with, exactly as a discard is" -- and `table.ts` lit hand cards from
 * `playableFromHand`, which collects `castSpell` and `playLand` and nothing
 * else. So at "discard down to hand size" every card the question named was
 * drawn inert two inches under the question, and the rail was the only way to
 * answer. The battlefield had read `byObject` all along. Measured on the four
 * positions below, before and after:
 *
 *                    hand faces   field faces   answerable on the card
 *   priority          3 of 4       2             yes
 *   discard, before   0 of 4       0             no
 *   discard, after    4 of 4       0             yes
 *   sacrifice         --           2 of 3        yes
 *   untap             --           4             yes
 *
 * The three clauses of the acceptance criterion are one test each below, over
 * every position: the cards the choice names are pressable and every other card
 * is inert, the headline and the sentence say what is being asked, and a decline
 * is drawn exactly where the kernel enumerates one -- `permanentUntap` offers
 * `oid: null` and `permanentSacrifice` does not, which is CR 701.16a's
 * difference and not a preference of this surface.
 *
 * Two of the five things the bead's description names are not decisions this
 * kernel produces, which is worth recording rather than testing around: a modal
 * "choose one" is baked into `castSpell`'s options and settled at cast time, and
 * there is no trigger-ordering decision kind at all.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { Choice, Decision, GameSession, GameState, ObjectId } from '@mtg/kernel';
import {
  botSeat,
  humanSeat,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  simpleAgent,
} from '@mtg/kernel';
import { PlayView } from '../../src/routes/play/PlayView';
import { PASS_LABEL } from '../../src/routes/play/pass';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0;

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/** An edict: the *targeted* player chooses, so the choice lands on this seat. */
const EDICT: Card = parseCard({
  kind: 'sorcery',
  id: 'active-task-edict',
  name: 'Toll the Bell',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1 },
  colors: [],
  effects: [{ kind: 'sacrificePermanent', target: { kind: 'targetPlayer' } }],
});

/** `upTo`, which is what makes the untap the position that carries a decline. */
const SECOND_WIND: Card = parseCard({
  kind: 'sorcery',
  id: 'active-task-second-wind',
  name: 'Second Wind',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 1 },
  colors: [],
  effects: [{ kind: 'untapPermanents', upTo: 2, filter: { cardTypes: ['land'] } }],
});

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

/**
 * Plays the position forward to the decision named, preferring a cast aimed at
 * this seat: an edict enumerates one option per legal target and the seat that
 * is asked is the one it names.
 */
function driveTo(start: GameState, kind: Decision['kind'], limit = 20): GameState {
  let state = start;
  for (let step = 0; step < limit; step += 1) {
    if (pendingDecision(state)?.kind === kind) return state;
    const actions = legalActions(state);
    const aimed = actions.find(
      (action) =>
        action.type === 'castSpell' && JSON.stringify(action.targets).includes(`"player":${String(VIEWER)}`),
    );
    const cast = aimed ?? actions.find((action) => action.type === 'castSpell');
    const next = cast ?? actions.find((action) => action.type === 'passPriority') ?? actions[0];
    if (next === undefined) throw new Error(`nothing legal on the way to ${kind}`);
    state = reduce(state, next).state;
  }
  throw new Error(`never reached ${kind}`);
}

const BOARD = {
  battlefield: [
    { card: MOUNTAIN, controller: VIEWER },
    { card: MOUNTAIN, controller: VIEWER },
    { card: DRAKE, controller: 1 as const },
  ],
  hands: [[MOUNTAIN, RAIDER, LASH, GUARDIAN], []],
} as const;

/** Priority on a board with a hand: the control every other position is read against. */
function priority(): GameState {
  return scenario(BOARD).state;
}

/** Cleanup over hand size: the choice the kernel keys to cards in your hand. */
function discarding(): GameState {
  return scenario({ ...BOARD, maximumHandSize: 3, step: 'cleanup' }).state;
}

/** An edict resolving at this seat: two creatures, and no way to decline. */
function sacrificing(): GameState {
  return driveTo(
    scenario({
      battlefield: [
        { card: MOUNTAIN, controller: VIEWER },
        { card: RAIDER, controller: VIEWER },
        { card: GUARDIAN, controller: VIEWER },
        { card: MOUNTAIN, controller: 1 },
        { card: MOUNTAIN, controller: 1 },
      ],
      hands: [[], [EDICT]],
      active: 1,
    }).state,
    'permanentSacrifice',
  );
}

/** `up to 2` over four lands: the position the rules give a decline. */
function untapping(): GameState {
  return driveTo(
    scenario({
      battlefield: [
        { card: MOUNTAIN, controller: VIEWER, tapped: true },
        { card: MOUNTAIN, controller: VIEWER, tapped: true },
        { card: MOUNTAIN, controller: VIEWER, tapped: true },
        { card: MOUNTAIN, controller: VIEWER },
      ],
      hands: [[SECOND_WIND], []],
    }).state,
    'permanentUntap',
  );
}

/** jsdom without `lib: dom`: the rendered tree is reached through the container. */
interface Root {
  querySelector(selector: string): unknown;
}

let root: Root | null = null;

function open(state: GameState, onChoose: (choice: Choice) => void = () => undefined): GameState {
  const { container } = render(
    h(PlayView, { session: seated(state), viewer: VIEWER, names: NAMES, onChoose }),
  );
  root = container as unknown as Root;
  return state;
}

function attr(node: unknown, name: string): string | null {
  if (node === null || node === undefined) return null;
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function textOf(node: unknown): string {
  return (node as { readonly textContent: string | null }).textContent ?? '';
}

function slotKey(node: unknown): string | null {
  const slot = (node as { closest(selector: string): unknown }).closest('[data-permanent-key]');
  return slot === null ? null : attr(slot, 'data-permanent-key');
}

/** The object ids a zone draws as pressable card faces, deduplicated. */
function pressable(zone: string): readonly string[] {
  const region = screen.queryByRole('region', { name: zone });
  if (region === null) return [];
  const keys = within(region)
    .queryAllByRole('button')
    .map(slotKey)
    .filter((key): key is string => key !== null);
  return [...new Set(keys)];
}

/** The names on the rail's list of legal moves, which is the keyboard path. */
function moveList(): readonly string[] {
  const group = screen.queryByRole('group', { name: 'Legal moves' });
  if (group === null) return [];
  return within(group)
    .queryAllByRole('button')
    .map((node) => attr(node, 'aria-label') ?? textOf(node));
}

function passEnabled(): boolean {
  const pass = screen.getByRole('button', { name: PASS_LABEL });
  return (pass as { readonly disabled?: boolean }).disabled !== true;
}

function said(selector: string): string {
  const node = root === null ? null : root.querySelector(selector);
  if (node === null || node === undefined) throw new Error(`the rail drew no ${selector}`);
  return textOf(node);
}

/** Every object of a card in a zone, by the name printed on it. */
function idsOf(state: GameState, zone: 'hand' | 'battlefield', name?: string): readonly ObjectId[] {
  const oids = zone === 'hand' ? state.players[VIEWER].hand : state.battlefield;
  return oids.filter((oid) => {
    const object = state.objects[oid];
    if (object === undefined || object.controller !== VIEWER) return false;
    return name === undefined || object.card.name === name;
  });
}

describe('a pending choice as the active task', () => {
  it('hands the choice to the cards the kernel named, in hand as on the table', () => {
    // The control. Three of four cards in hand are castable off two Mountains --
    // Thornhide Guardian at {3}{G} is not -- and both lands can be tapped.
    const parked = open(priority());
    expect(pressable('your hand')).toEqual([...idsOf(parked, 'hand')].slice(0, 3));
    expect(pressable('your battlefield')).toEqual([...idsOf(parked, 'battlefield', 'Mountain')]);
    cleanup();

    // The position this lane fixed: every card in hand is a legal discard, so
    // every card in hand is pressable. It read `playableFromHand` and drew none.
    const cleanupStep = open(discarding());
    expect(pressable('your hand')).toEqual([...idsOf(cleanupStep, 'hand')]);
    cleanup();

    // The two creatures, and not the Mountain beside them: the edict's filter is
    // creatures, so the land is a card the choice does not name.
    const edict = open(sacrificing());
    expect(pressable('your battlefield')).toEqual([
      ...idsOf(edict, 'battlefield', 'Emberflow Raider'),
      ...idsOf(edict, 'battlefield', 'Thornhide Guardian'),
    ]);
    cleanup();

    const wind = open(untapping());
    expect(pressable('your battlefield')).toEqual([...idsOf(wind, 'battlefield', 'Mountain')]);
  });

  it('leaves every card the choice does not name inert, and the pass with it', () => {
    const parked = open(priority());
    expect(passEnabled()).toBe(true);
    expect(pressable('your battlefield')).toHaveLength(2);
    cleanup();

    // The same board, one step later. Nothing on either battlefield answers to a
    // click, and the pass -- the move that would leave the question unanswered --
    // is drawn disabled rather than dropped.
    open(discarding());
    expect(pressable('your battlefield')).toEqual([]);
    expect(pressable("Bot's battlefield")).toEqual([]);
    expect(passEnabled()).toBe(false);
    expect(moveList()).toEqual([
      'Discard Mountain',
      'Discard Emberflow Raider',
      'Discard Lightning Lash',
      'Discard Thornhide Guardian',
    ]);
    expect(parked.players[VIEWER].hand).toHaveLength(4);
  });

  it('states what is being asked and why, at every position', () => {
    const positions: readonly (readonly [string, GameState, string, string])[] = [
      ['priority', priority(), 'Priority', 'You may act'],
      ['discard', discarding(), 'Discard down to hand size', 'Choose 1 card to discard.'],
      ['sacrifice', sacrificing(), 'Sacrifice a permanent', '2 legal permanents remain'],
      ['untap', untapping(), 'Untap up to 2 more', 'or finish now'],
    ];
    for (const [what, state, headline, explain] of positions) {
      open(state);
      expect(said('.mtg-panel__title'), what).toBe(headline);
      expect(said('.mtg-prompt__explain'), what).toContain(explain);
      cleanup();
    }
  });

  it('draws a decline where the kernel enumerates one, and nowhere else', () => {
    // `up to 2` of a possible 4: CR 701.16a lets the player stop, the kernel
    // enumerates that as an option naming no permanent, and the rail draws it.
    open(untapping());
    expect(moveList()).toContain('Finish choosing');
    cleanup();

    // An edict is not optional. Two sacrifices and nothing else on the list, and
    // the pass under it disabled, so there is no drawn way to decline at all.
    open(sacrificing());
    expect(moveList()).toEqual(['Sacrifice Emberflow Raider2/1', 'Sacrifice Thornhide Guardian3/5']);
    expect(passEnabled()).toBe(false);
  });

  it('answers the question when the card it named is pressed', () => {
    const onChoose = vi.fn();
    const state = open(discarding(), onChoose);
    const lash = idsOf(state, 'hand', 'Lightning Lash')[0];
    if (lash === undefined) throw new Error('the fixture holds no Lightning Lash');
    const face = within(screen.getByRole('region', { name: 'your hand' }))
      .queryAllByRole('button')
      .find((node) => slotKey(node) === lash);
    if (face === undefined) throw new Error('the card the question named is not pressable');
    fireEvent.click(face);

    // An index into the decision's own options, which is what every press on
    // this surface submits. The option it indexes is the discard of that card.
    const submitted: unknown = onChoose.mock.calls[0]?.[0];
    expect(typeof submitted).toBe('number');
    const chosen = legalActions(state)[submitted as number];
    expect(chosen).toEqual({ type: 'discard', player: VIEWER, oids: [lash] });
  });
});
