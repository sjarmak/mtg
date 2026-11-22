/**
 * The played table with a draw a rig can trigger, mounted for
 * `./hand-draw-scroll.browser.test.ts`.
 *
 * It is a live page rather than static markup because the subject is an effect:
 * what the hand row does on the render *after* a card arrives. The page opens on
 * a seven-card hand, reads the row through `window.mtgReadRow` (which the rig
 * supplies before the bundle runs), then swaps in the same position with an
 * eighth card, the way a draw step re-renders the table. When that render has
 * painted it marks `body[data-drawn]`, which is what the rig settles on.
 *
 * `window.mtgCase = 'mulligan'` swaps the draw for a real deal and the mulligan
 * that follows it, the new hand that must not be scrolled like a draw.
 */
import { createElement as h, useEffect, useState } from 'react';
import { EXAMPLE_CARDS, exampleCard } from '@mtg/dsl';
import { choose, createSession, DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { Shell } from '../../src/app/Shell';
import { mount } from '../../src/mount';
import { dealMirrorGame } from '../../src/routes/play/deal';
import type { DealtGame } from '../../src/routes/play/deal';
import { PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;

function hand(size: number): readonly (typeof SPELLS)[number][] {
  return Array.from({ length: size }, (_unused, index) => SPELLS[index % SPELLS.length] ?? SPELLS[0]);
}

function drawn(held: number): GameSession {
  const built = scenario({
    seed: 'ui/hand-draw-scroll',
    battlefield: [],
    hands: [hand(held), hand(7)],
    active: 0,
    turn: 4,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * A real deal stopped at the opening hand, and the same game after the person
 * takes a mulligan: a whole new seven, which is a new hand and not a draw.
 */
function mulliganed(game: DealtGame): readonly [GameSession, GameSession] {
  const options = { autoPass: DEFAULT_AUTO_PASS };
  const opening = createSession(game.config.setup, game.config.seats, options);
  const index = opening.pending?.options.findIndex((action) => action.type === 'mulligan') ?? -1;
  if (index < 0) throw new Error('the deal did not stop at a mulligan');
  return [opening, choose(opening, index, options)];
}

interface Table {
  readonly sessions: readonly [GameSession, GameSession];
  readonly viewer: PlayerId;
  readonly names: SeatNames;
}

function table(which: string | undefined): Table {
  if (which !== 'mulligan') return { sessions: [drawn(7), drawn(8)], viewer: 0, names: ['You', 'Bot'] };
  const game = dealMirrorGame(EXAMPLE_CARDS, { seed: 'ui/hand-draw-scroll' });
  return { sessions: mulliganed(game), viewer: game.config.viewer, names: game.config.names };
}

interface DrawPage {
  mtgCase?: string;
  mtgReadRow?: () => unknown;
  mtgBefore?: unknown;
  requestAnimationFrame: (callback: () => void) => void;
  document: { readonly body: { readonly dataset: Record<string, string | undefined> } };
}

const page = globalThis as unknown as DrawPage;

/** Two frames, so a measurement reads the painted layout and not the one before it. */
function afterPaint(then: () => void): void {
  page.requestAnimationFrame(() => {
    page.requestAnimationFrame(then);
  });
}

const TABLE = table(page.mtgCase);

function Harness(): ReturnType<typeof h> {
  const [step, setStep] = useState<0 | 1>(0);
  useEffect(() => {
    afterPaint(() => {
      if (step === 0) {
        page.mtgBefore = page.mtgReadRow?.();
        setStep(1);
      } else {
        page.document.body.dataset['drawn'] = 'true';
      }
    });
  }, [step]);
  return h(Shell, {
    mode: 'play',
    onSelectMode: () => undefined,
    children: h(PlayView, {
      session: TABLE.sessions[step],
      viewer: TABLE.viewer,
      names: TABLE.names,
      onChoose: () => undefined,
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      onYield: () => undefined,
    }),
  });
}

mount('root', h(Harness));
