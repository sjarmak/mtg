/**
 * The browser entry for `./double-click-live.browser.test.ts`: a real table,
 * mounted, wired to a callback that records rather than advances.
 *
 * It is a separate module rather than a string inside the rig because it is
 * *compiled*. `../support/live-page.ts` builds it through `packages/ui/vite.config.ts`,
 * so this file is typechecked, linted and resolved exactly like the lab's own
 * entry, and an import that would break the page breaks the build instead of
 * throwing at `file://` load time where the rig would read it as a layout fact.
 *
 * The position is `./gestures.test.ts`'s `skirmish()`, stated again rather than
 * imported: that file is a jsdom test and importing it here would pull vitest
 * into a browser bundle. Both copies name the same four cards for the same
 * reason -- a land in hand with exactly one legal move, and a spell with three
 * legal aims -- and a change to one that the other did not follow shows up as
 * this rig's own premise assertions failing, which is what they are for.
 *
 * `mount` rather than `createRoot` directly, for the reason its own docblock
 * gives: the workspace tsconfig has no `lib: dom`, and this file may not assume
 * one either.
 */
import { createElement as h } from 'react';
import { exampleCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState, ObjectId } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { PlayView } from '../../src/routes/play/PlayView';
import { buildPrompt } from '../../src/routes/play/prompt';
import { mount } from '../../src/mount';

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

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
 * What the rig reads off the page, hung on `globalThis` under one name.
 *
 * `chosen` is the whole point: `onChoose` records and does not advance the
 * session, so a gesture that submits twice leaves two entries rather than a
 * board that moved on under the second press.
 */
export interface LiveTable {
  readonly chosen: readonly Choice[];
  /** The object id of a card in the viewer's hand, or `null` when it is not there. */
  hand(name: string): ObjectId | null;
  /**
   * The labels of the offered moves that act on one object.
   *
   * The rig states its premises through this rather than trusting the position:
   * "a land with exactly one move" and "a spell with several" are what the two
   * gestures are about, and a scenario that stopped satisfying either would
   * otherwise make this rig green about the wrong card.
   */
  movesOn(oid: ObjectId): readonly string[];
}

const state = skirmish();
const decision = pendingDecision(state);
if (decision === null) throw new Error('the scenario left nobody to ask');

const session: GameSession = {
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

const chosen: Choice[] = [];
const table: LiveTable = {
  chosen,
  hand: (name: string): ObjectId | null => {
    const found = state.players[0]?.hand.find((oid) => state.objects[oid]?.card.name === name);
    return found ?? null;
  },
  movesOn: (oid: ObjectId): readonly string[] =>
    buildPrompt(state, decision, ['You', 'Bot'])
      .choices.filter((choice) => choice.oids.includes(oid))
      .map((choice) => choice.label),
};
(globalThis as unknown as { mtgLiveTable: LiveTable }).mtgLiveTable = table;

mount(
  'root',
  h(PlayView, {
    session,
    viewer: 0,
    names: ['You', 'Bot'],
    onChoose: (choice: Choice): void => {
      chosen.push(choice);
    },
  }),
);
