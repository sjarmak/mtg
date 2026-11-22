/**
 * The browser entry for `./game-menu.browser.test.ts`: a real table with the
 * precon strip's `Game` menu in its toolbar.
 *
 * The menu opens on a press and its sheet is positioned by the cascade, so
 * neither half of the question can be asked of server-rendered markup: the
 * sheet is not in it until React puts it there. `../support/live-page.ts` is
 * the machinery and its docblock argues the two constraints that shape it.
 *
 * The seed is a real one — `newSeed('lab/precon')` draws the same twelve-token
 * shape the dealt table shows — because the width of that string is the
 * subject. A stand-in like `seed-1` would fit anything.
 */
import { createElement as h } from 'react';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { PlayView } from '../../src/routes/play/PlayView';
import { PreconStrip } from '../../src/routes/play/precon-strip';
import { newSeed } from '../../src/routes/play/seed';
import { mount } from '../../src/mount';

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const DRAKE = exampleCard('slc-windrider-drake');

function table(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[MOUNTAIN, RAIDER], []],
  }).state;
}

const state = table();
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

const seed = newSeed('lab/precon');
(globalThis as unknown as { mtgGameSeed: string }).mtgGameSeed = seed;

mount(
  'root',
  h(PlayView, {
    session,
    viewer: 0,
    names: ['You', 'Bot'],
    onChoose: (): void => undefined,
    toolbar: h(PreconStrip, {
      seed,
      armed: false,
      onArm: (): void => undefined,
      onReshuffle: (): void => undefined,
      onPin: (): void => undefined,
      pinned: false,
    }),
  }),
);
