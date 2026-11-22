// @vitest-environment jsdom
/**
 * Every zone the kernel has, and how a player reaches it.
 *
 * `mtg-bz2.11` asks for one thing per zone: the hand is always visible, the
 * zones that hold cards open into a browser you can read, and the library
 * exposes only what the player is permitted to know. Each half of that is
 * already true and each half is asserted somewhere — `../exile-zone.test.ts` for
 * exile, `../graveyard-browser.test.ts` for the graveyard, `../board.test.ts`
 * for the mat. What none of them asserts is the *claim*: that the set of zones
 * with a surface is the set of zones the kernel has.
 *
 * So this file is a census rather than a feature test, and the census is
 * `ZONE_SURFACES` — one entry per `ZoneId`, keyed by the kernel's own union.
 * `Readonly<Record<ZoneId, …>>` is what makes it a census: a seventh zone added
 * to `@mtg/kernel`'s `ZoneId` (a command zone is the obvious candidate) fails to
 * compile here until somebody says what the board does with it, and "nothing,
 * deliberately" is an answer this table can hold. A zone reachable from the
 * rules and from no pixel is the failure this is written against, and it is a
 * failure that arrives silently: the kernel grows a zone, cards start going
 * there, and the board keeps drawing the six it knew about.
 *
 * The state is one real cast rather than six hand-built positions, for the
 * reason `../exile-zone.test.ts` casts: a hand-built exile proves the component
 * draws what it is handed, and what is in question here is what the position
 * builder hands it.
 *
 * jsdom performs no layout, so nothing here measures a pixel. What is asserted
 * is what a player can reach: a name on screen, a control that opens, a count
 * standing in for the cards behind it.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, GameState, ObjectId, Target, ZoneId } from '@mtg/kernel';
import { HIDDEN_ZONES, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { Board } from '../../src/board/Board';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const PLAINS = basicLand('Plains', 'TST', 250);

/** A vanilla body whose only job is to be findable by name in exactly one zone. */
function creature(id: string, name: string, collector: number): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: collector },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    power: 2,
    toughness: 2,
  });
}

/**
 * One name per zone per seat, and none of them a substring of another.
 *
 * The library assertions are the reason for the discipline: they are `queryBy`
 * on a name that must appear nowhere, and a name that also happens to be part of
 * a card in the graveyard would pass for the wrong reason.
 */
const VICTIM = creature('tst-void-bear', 'Void Bear', 1);
const YOUR_SECRET = creature('tst-whispered-ledger', 'Whispered Ledger', 3);
const THEIR_SECRET = creature('tst-hidden-gambit', 'Hidden Gambit', 4);
const YOUR_DECK = creature('tst-sealed-tome', 'Sealed Tome', 5);
const THEIR_DECK = creature('tst-buried-atlas', 'Buried Atlas', 6);
const YOUR_DEAD = creature('tst-cinder-relic', 'Cinder Relic', 7);
const THEIR_DEAD = creature('tst-ash-pilgrim', 'Ash Pilgrim', 8);

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
 * Seat 0 exiles the creature seat 1 owns, and every other zone is loaded on the
 * way past so one position answers for all six.
 *
 * Two states come out of it because the stack is a zone that empties: `CASTING`
 * is the window where the spell is on the stack, `SETTLED` is after it resolves.
 */
function positions(): { readonly casting: GameState; readonly settled: GameState } {
  const start = scenario({
    seed: 'test/zone-surfaces',
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: VICTIM, controller: 1 },
    ],
    hands: [[BANISH, YOUR_SECRET], [THEIR_SECRET]],
    libraries: [
      [YOUR_DECK, YOUR_DECK],
      [THEIR_DECK, THEIR_DECK],
    ],
    graveyards: [[YOUR_DEAD], [THEIR_DEAD]],
  }).state;
  const spell = playerOf(start, 0).hand[0];
  if (spell === undefined) throw new Error('the caster has an empty hand');
  const targets: readonly (Target | null)[] = [{ kind: 'permanent', oid: oidNamed(start, VICTIM.name) }];
  const casting = reduce(start, { type: 'castSpell', player: 0, oid: spell, targets }).state;
  const settled = reduceAll(casting, [pass(casting), { type: 'passPriority', player: 1 }]).state;
  return { casting, settled };
}

const { casting: CASTING, settled: SETTLED } = positions();

interface ElementLike {
  readonly textContent: string | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/**
 * What testing-library hands back, narrowed to what these tests ask of it. The
 * workspace tsconfig carries no `dom` lib, so `HTMLElement` has neither of
 * these; `../exile-zone.test.ts` and `../board.test.ts` declare their own for
 * the same reason.
 */
function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.textContent !== 'string' ||
    typeof candidate.querySelectorAll !== 'function'
  ) {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function textOf(value: unknown): string {
  return asElement(value).textContent ?? '';
}

/** The table as the seat-0 player sees it, which is the view this file is about. */
function drawTable(state: GameState = SETTLED): ElementLike {
  return asElement(render(h(Board, boardPosition(state, 0, NAMES))).container);
}

/**
 * Open a zone's strip and read the names behind it.
 *
 * The names come off `.mtg-browser__name`, which is the span the browser prints
 * a card's name into, rather than off the button's accessible name: that one is
 * `faceAccessibleName`, a whole card read aloud, and matching a card in it would
 * pass on a type line as readily as on a name.
 */
function openBrowser(table: ElementLike, name: string): readonly string[] {
  fireEvent.click(screen.getByRole('button', { name }));
  const found = table.querySelectorAll('.mtg-browser__name');
  const out: string[] = [];
  for (let at = 0; at < found.length; at += 1) {
    const item = found[at];
    if (item !== undefined) out.push((item.textContent ?? '').trim());
  }
  return out;
}

/**
 * How a player reaches one zone.
 *
 * `how` is the sentence the test is named with, so a run reads as the census it
 * is. `reach` runs it. Both are required for every zone, which is the whole
 * point of the record: there is no way to add a zone here without saying what
 * happens to it.
 */
interface ZoneSurface {
  readonly how: string;
  readonly reach: () => void;
}

const ZONE_SURFACES: Readonly<Record<ZoneId, ZoneSurface>> = {
  battlefield: {
    how: 'is drawn in place, one region per seat',
    reach: () => {
      drawTable();
      expect(screen.getByLabelText('your battlefield')).toBeDefined();
      expect(screen.getByLabelText("Bot's battlefield")).toBeDefined();
      // The lands the caster paid with are still on the mat under their own
      // names, which is the whole of what "drawn in place" means here.
      expect(screen.getAllByLabelText(/^Plains/).length).toBeGreaterThan(0);
    },
  },
  hand: {
    how: 'is never hidden from the seat holding it, and never revealed to the other',
    reach: () => {
      drawTable();
      expect(screen.getByLabelText('your hand')).toBeDefined();
      // More than one match is expected and is not the claim: the rail draws the
      // face and the zoom beside it, and both carry the card's name.
      expect(screen.getAllByLabelText(new RegExp(`^${YOUR_SECRET.name}`)).length).toBeGreaterThan(0);
      // The opposing hand is a count in the pod and nothing else: no rail, no
      // face, not even a face-down slot, because the count already says it.
      expect(screen.queryByText(THEIR_SECRET.name)).toBeNull();
      expect(screen.queryByLabelText("Bot's hand")).toBeNull();
    },
  },
  graveyard: {
    how: 'opens into a browser, for both seats',
    reach: () => {
      const table = drawTable();
      // Both the creature that was already dead and the spell that just
      // resolved, so the browser is reading the kernel's zone rather than the
      // scenario's opening list.
      expect(openBrowser(table, 'your graveyard, 2 cards')).toEqual([BANISH.name, YOUR_DEAD.name]);
      expect(openBrowser(table, "Bot's graveyard, 1 card")).toContain(THEIR_DEAD.name);
    },
  },
  exile: {
    how: 'opens into a browser under the seat that owns the card',
    reach: () => {
      const table = drawTable();
      expect(openBrowser(table, "Bot's exile, 1 card")).toEqual([VICTIM.name]);
      // Seat 0 owns nothing in exile, and an empty pile draws no strip at all.
      expect(screen.queryByLabelText(/^your exile/)).toBeNull();
    },
  },
  stack: {
    how: 'is drawn in place while it holds something, and not at all when it is empty',
    reach: () => {
      drawTable(CASTING);
      const stack = screen.getByLabelText('Stack');
      expect(textOf(stack)).toContain(BANISH.name);
      cleanup();
      drawTable(SETTLED);
      expect(screen.queryByLabelText('Stack')).toBeNull();
    },
  },
  library: {
    how: 'is a count and never its contents, for either seat',
    reach: () => {
      drawTable();
      // Not one card of either library is anywhere on the page. `queryByText`
      // rather than a zone query on purpose: the claim is about the whole
      // document, since a leak would not announce itself as a library.
      expect(screen.queryByText(YOUR_DECK.name)).toBeNull();
      expect(screen.queryByText(THEIR_DECK.name)).toBeNull();
      // What stands in for them is the pod chip, which is the permitted fact.
      const counts = screen.getAllByTitle('library').map((node) => textOf(node));
      expect(counts).toEqual([
        String(SETTLED.players[0].library.length),
        String(SETTLED.players[1].library.length),
      ]);
    },
  },
};

describe('every zone the kernel has has a surface', () => {
  for (const [zone, surface] of Object.entries(ZONE_SURFACES)) {
    it(`${zone} ${surface.how}`, surface.reach);
  }
});

/**
 * One card the opposing seat holds in each zone, so the secrecy claim can be
 * made against a name rather than against a selector.
 *
 * `null` where seat 1 holds nothing there — the battlefield and the stack are
 * public anyway, and the point of the record is the same as `ZONE_SURFACES`'s:
 * a new zone has to be given an answer here too.
 */
const THEIR_CARD: Readonly<Record<ZoneId, Card | null>> = {
  battlefield: null,
  hand: THEIR_SECRET,
  library: THEIR_DECK,
  graveyard: THEIR_DEAD,
  exile: VICTIM,
  stack: null,
};

/**
 * Which zones stay secret is the kernel's answer, not this file's.
 *
 * `HIDDEN_ZONES` is the array `@mtg/kernel`'s own visibility rules run on, so
 * reading it here rather than restating `['library', 'hand']` is what makes this
 * a check on agreement: a zone that becomes hidden in the rules and stays open
 * on the board fails here on the next run rather than on a report.
 *
 * The hand is in that array and is still drawn — for its holder. That is not an
 * exception to the rule, it is the rule read from the right seat: this table is
 * rendered for seat 0, and every name asserted absent belongs to seat 1.
 */
describe("a hidden zone's contents never reach the other seat", () => {
  for (const zone of HIDDEN_ZONES) {
    const card = THEIR_CARD[zone];
    it(`draws no card from the opposing ${zone}`, () => {
      if (card === null) throw new Error(`${zone} is hidden and no card was named for it`);
      drawTable();
      expect(screen.queryByText(card.name)).toBeNull();
      expect(screen.queryByLabelText(new RegExp(`^${card.name}`))).toBeNull();
    });
  }
});
