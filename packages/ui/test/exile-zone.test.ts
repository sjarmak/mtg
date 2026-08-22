// @vitest-environment jsdom
/**
 * Exile, drawn: the zone a card goes to when it is removed, under the seat that
 * owns it.
 *
 * `mtg-iidz`. The kernel has had `exileTarget` since `kernel/test/exile.test.ts`
 * was written, and until now the board drew nothing for it: a removal spell
 * resolved, the permanent left the battlefield, and the card was in a place with
 * no representation on screen at all. What that reads as, from the chair, is a
 * card that stopped existing — which is the one thing exile is not, since the
 * kernel keeps the object, its owner and its zone exactly as it keeps a
 * graveyard's.
 *
 * Three properties, and each is somewhere a different lane could break it:
 *
 *  1. The zone itself draws newest-first with its own empty sentence, which is
 *     the graveyard's contract restated rather than a second contract. The Arena
 *     defect that contract is written down for names this zone by name.
 *  2. `Board` hangs it off the seat's pod under the graveyard, and draws no
 *     strip at all when the caller supplies none.
 *  3. Both position builders split the kernel's one game-wide exile by the
 *     object's OWNER. This is the property with a real wrong answer available:
 *     the state carries a controller too, and an exiled permanent that was
 *     stolen before it left would file under the thief.
 *
 * jsdom performs no layout, so nothing here measures the pod column. What is
 * asserted is the markup, the order and the split.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_CARDS, basicLand, parseCard } from '@mtg/dsl';
import type { Action, GameState, ObjectId, PlayerId, Target } from '@mtg/kernel';
import { playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { Board } from '../src/board/Board';
import type { BoardSide } from '../src/board/Board';
import { Exile } from '../src/board/Exile';
import type { ExileCard } from '../src/board/Exile';
import { zoneSelector } from '../src/motion/geometry';
import { boardFrame } from '../src/routes/replay/frame';
import type { ReplayNames } from '../src/routes/replay/narrate';
import { boardPosition } from '../src/routes/play/position';
import type { SeatNames } from '../src/routes/play/position';
import type { LogPlayerId } from '../src/routes/replay/log-schema';
import { EXILED_CARD, SEAT_LABELS, syntheticLog } from './replay/support/synthetic-log';

afterEach(cleanup);

const PLAINS = basicLand('Plains', 'TST', 250);

const NAMES: SeatNames = ['You', 'Bot'];

/**
 * The same table with the seats named the other way round.
 *
 * `SeatNames` is indexed by seat id rather than by near and far, so reading the
 * position from seat 1 does not make seat 1 the second person: the label does
 * (`src/seat.ts`). This is the tuple that puts the owner of the exiled card in
 * the chair.
 */
const OWNER_NEAR: SeatNames = ['Bot', 'You'];

/** The kernel's exile array is oldest-first, and so is this. */
function pile(count: number): readonly ExileCard[] {
  return EXAMPLE_CARDS.slice(0, count).map((card, index) => ({ key: `x${String(index)}`, card }));
}

const BEAR: Card = parseCard({
  kind: 'creature',
  id: 'tst-void-bear',
  name: 'Void Bear',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  power: 2,
  toughness: 2,
});

const BANISH: Card = parseCard({
  kind: 'sorcery',
  id: 'tst-banish',
  name: 'Banish to the Void',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }],
});

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

function oidNamed(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

/**
 * Player 0 exiles the bear player 1 owns.
 *
 * A real cast rather than a hand-built position, so what is drawn is what the
 * kernel actually produces: the object stays in `state.objects` with its owner
 * intact and its id in the one game-wide `state.exile`.
 */
function exiledPosition(): GameState {
  const start = scenario({
    seed: 'test/exile-zone',
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: BEAR, controller: 1 },
    ],
    hands: [[BANISH], []],
  }).state;
  const victim = oidNamed(start, 'Void Bear');
  const spell = playerOf(start, 0).hand[0];
  if (spell === undefined) throw new Error('the caster has an empty hand');
  const targets: readonly (Target | null)[] = [{ kind: 'permanent', oid: victim }];
  const cast = reduce(start, { type: 'castSpell', player: 0, oid: spell, targets });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

const EXILED = exiledPosition();

interface ElementLike {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/**
 * What testing-library hands back, narrowed to what these tests ask of it. The
 * workspace tsconfig has no `lib: dom`, so `HTMLElement` carries none of these;
 * `graveyard-browser.test.ts` and `board.test.ts` declare their own for the same
 * reason.
 */
function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.getAttribute !== 'function' ||
    typeof candidate.querySelectorAll !== 'function'
  ) {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function names(list: ArrayLike<ElementLike>): readonly string[] {
  const out: string[] = [];
  for (let at = 0; at < list.length; at += 1) {
    const item = list[at];
    if (item !== undefined) out.push((item.textContent ?? '').trim());
  }
  return out;
}

describe('the exile zone', () => {
  it('says it is empty in its own words rather than the graveyard one', () => {
    render(h(Exile, { label: 'Your exile', cards: [] }));
    expect(screen.getByText('exile is empty')).toBeDefined();
    expect(screen.queryByText('graveyard is empty')).toBeNull();
  });

  it('lists newest first, which is the order the graveyard already promises', () => {
    const cards = pile(4);
    render(h(Exile, { label: 'Your exile', cards }));
    // Closed by default, and the strip names the first entry of the open list.
    const head = screen.getByRole('button', { name: 'Your exile, 4 cards' });
    const newest = cards[cards.length - 1];
    if (newest === undefined) throw new Error('the pile is empty');
    expect(asElement(head).textContent).toContain(newest.card.name);

    fireEvent.click(head);
    const list = asElement(screen.getByRole('list'));
    expect(names(list.querySelectorAll('.mtg-browser__name'))).toEqual(
      [...cards].reverse().map((entry) => entry.card.name),
    );
  });

  it('carries the seat through to the browser, so a mover can find the right pile', () => {
    const view = render(h(Exile, { label: "Bot's exile", cards: pile(1), seat: 'opponent' }));
    const zone = asElement(view.container).querySelectorAll('.mtg-browser')[0];
    if (zone === undefined) throw new Error('no browser rendered');
    expect(zone.getAttribute('data-seat')).toBe('opponent');
  });
});

/** A seat with nothing but a status, which is the smallest `Board` will take. */
function bareSide(name: string): BoardSide {
  return {
    status: {
      name,
      life: 20,
      handCount: 0,
      libraryCount: 30,
      graveyardCount: 0,
      active: false,
      priority: false,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    },
    battlefield: { label: `${name} battlefield`, permanents: [] },
  };
}

describe('the board hangs exile off the seat that owns it', () => {
  it('draws no exile strip for a seat that supplies none', () => {
    render(
      h(Board, {
        you: bareSide('You'),
        opponent: bareSide('Bot'),
        stack: { entries: [] },
      }),
    );
    expect(screen.queryByText('exile is empty')).toBeNull();
  });

  it('draws one per seat, under the graveyard of that seat', () => {
    const view = render(
      h(Board, {
        you: {
          ...bareSide('You'),
          graveyard: { label: 'Your graveyard', cards: pile(1) },
          exile: { label: 'Your exile', cards: pile(2) },
        },
        opponent: {
          ...bareSide('Bot'),
          exile: { label: "Bot's exile", cards: pile(1) },
        },
        stack: { entries: [] },
      }),
    );
    expect(screen.getByRole('button', { name: 'Your exile, 2 cards' })).toBeDefined();
    expect(screen.getByRole('button', { name: "Bot's exile, 1 card" })).toBeDefined();

    // Order within the pod: the pile the seat owns comes after the pile it
    // buried, which is the arrangement `Board.ts` argues rather than an accident
    // of the spread.
    const zones = names(asElement(view.container).querySelectorAll('.mtg-zone__label'));
    expect(zones.indexOf('Your exile')).toBeGreaterThan(zones.indexOf('Your graveyard'));
  });
});

describe('the live position splits one game-wide exile by owner', () => {
  it('files the exiled card under the seat that owns it, not the seat that exiled it', () => {
    expect(EXILED.exile.length).toBe(1);
    const victim = EXILED.exile[0];
    if (victim === undefined) throw new Error('nothing was exiled');
    // The premise: the object is still there, and its owner is the seat it was
    // taken from while the spell that took it belonged to the other seat.
    expect(EXILED.objects[victim]?.owner).toBe(1);
    expect(EXILED.objects[victim]?.card.name).toBe('Void Bear');

    const position = boardPosition(EXILED, 0, NAMES);
    expect(position.you.exile).toBeUndefined();
    expect(position.opponent.exile?.cards.map((entry) => entry.card.name)).toEqual(['Void Bear']);
    expect(position.opponent.exile?.label).toBe("Bot's exile");
  });

  it('names the near seat in the possessive rather than as a label', () => {
    // Read from the far seat, so the owner of the exiled card is the viewer and
    // the zone's name goes through `seatPossessive` the way every other region
    // of a seat does (`test/play/seat-voice.test.ts` holds the rule).
    const position = boardPosition(EXILED, 1, OWNER_NEAR);
    expect(position.you.exile?.label).toBe('your exile');
    expect(position.opponent.exile).toBeUndefined();
  });

  it('omits the zone entirely on a board where nothing is exiled', () => {
    const quiet = scenario({ seed: 'test/exile-zone/quiet' }).state;
    const position = boardPosition(quiet, 0, NAMES);
    expect(quiet.exile).toEqual([]);
    expect(position.you.exile).toBeUndefined();
    expect(position.opponent.exile).toBeUndefined();
  });

  it('draws the pile on the rendered board, under the seat that owns it', () => {
    const position = boardPosition(EXILED, 0, NAMES);
    const view = render(h(Board, position));
    const zone = asElement(view.container).querySelectorAll('.mtg-browser[data-seat="opponent"]');
    const labels = names(zone).filter((said) => said.includes('exile'));
    expect(labels.length).toBeGreaterThan(0);
    const head = screen.getByRole('button', { name: "Bot's exile, 1 card" });
    fireEvent.click(head);
    // Read off the browser's own name span rather than by text: the row also
    // carries the zoom panel, which prints the same name on the full face.
    const list = asElement(screen.getByRole('list'));
    expect(names(list.querySelectorAll('.mtg-browser__name'))).toEqual(['Void Bear']);
  });
});

/** Every seat the viewer can be, so neither arm of `boardPosition` is untested. */
describe('both viewers see the same split', () => {
  it('puts the one exiled card under the same owner from either chair', () => {
    for (const viewer of [0, 1] as const) {
      const position = boardPosition(EXILED, viewer as PlayerId, NAMES);
      const owned = viewer === 1 ? position.you : position.opponent;
      const other = viewer === 1 ? position.opponent : position.you;
      expect(owned.exile?.cards.length).toBe(1);
      expect(other.exile).toBeUndefined();
    }
  });
});

/**
 * The replay viewer reads the same zone off a recorded snapshot.
 *
 * Two boards, one rule: `frame.ts` builds the same `BoardSide` the live surface
 * does, and a zone wired into one of them and not the other is the drift both
 * files already carry comments about avoiding. The snapshot's exile is one
 * game-wide array like the kernel's, and the object table records `owner`, so
 * the split is available there and is made from the same field.
 */
describe('the replay frame draws exile from the recorded snapshot', () => {
  const log = syntheticLog([
    { controllers: [0, 0], events: [] },
    { controllers: [0, 0], exiled: ['x1'], events: [] },
  ]);
  const game = log.games[0];
  if (game === undefined) throw new Error('the synthetic log holds no game');
  const replayNames: ReplayNames = {
    player: (player: LogPlayerId): string => SEAT_LABELS[player],
    card: (oid: string): string => game?.objects.get(oid)?.card.name ?? oid,
    target: (oid: string): string => game?.objects.get(oid)?.card.name ?? oid,
  };

  function frameAt(index: number): ReturnType<typeof boardFrame> {
    const step = game?.steps[index];
    if (step === undefined || game === undefined) throw new Error(`the log has no step ${String(index)}`);
    return boardFrame(game, step.state, 0, null, replayNames);
  }

  it('draws no zone on the step before anything is exiled', () => {
    const frame = frameAt(0);
    expect(frame.you.exile).toBeUndefined();
    expect(frame.opponent.exile).toBeUndefined();
  });

  it('files the exiled object under its owner rather than under the near seat', () => {
    // `x1` is owned by seat 1, which is the far seat from seat 0's chair, and
    // the snapshot says nothing about whose exile it is in.
    const frame = frameAt(1);
    expect(frame.you.exile).toBeUndefined();
    expect(frame.opponent.exile?.cards.map((entry) => entry.card.name)).toEqual([EXILED_CARD.name]);
    expect(frame.opponent.exile?.label).toBe("Beta's exile");
  });
});

/**
 * The mover has to tell the two piles apart now that a seat has both.
 *
 * `../src/motion/geometry.ts` found a graveyard by `data-seat` alone, which was
 * unambiguous while a seat had exactly one browser. It no longer is, and the
 * failure it would produce is silent: `querySelector` answers with whichever
 * strip the pod happens to draw first, so a card going to the graveyard would
 * fly to the graveyard today and to the exile the first time somebody reordered
 * the pod. So the selector names the zone, and both zones write it.
 */
describe("a card in flight can find the right one of a seat's two piles", () => {
  it('picks out one browser per zone rather than one per seat', () => {
    const view = render(
      h(Board, {
        you: {
          ...bareSide('You'),
          graveyard: { label: 'Your graveyard', cards: pile(1) },
          exile: { label: 'Your exile', cards: pile(2) },
        },
        opponent: bareSide('Bot'),
        stack: { entries: [] },
      }),
    );
    const container = asElement(view.container);
    for (const [zone, expected] of [
      ['graveyard', 'Your graveyard'],
      ['exile', 'Your exile'],
    ] as const) {
      const selector = zoneSelector(zone, 'you');
      if (selector === null) throw new Error(`${zone} has no selector`);
      const found = container.querySelectorAll(selector);
      expect(found.length, `${zone} browsers matched`).toBe(1);
      expect(found[0]?.getAttribute('aria-label')).toBe(expected);
    }
  });

  it('matches nothing, rather than the wrong pile, for a zone the pod does not draw', () => {
    const view = render(
      h(Board, {
        you: { ...bareSide('You'), graveyard: { label: 'Your graveyard', cards: pile(1) } },
        opponent: bareSide('Bot'),
        stack: { entries: [] },
      }),
    );
    const selector = zoneSelector('exile', 'you');
    if (selector === null) throw new Error('exile has no selector');
    expect(asElement(view.container).querySelectorAll(selector).length).toBe(0);
  });
});
