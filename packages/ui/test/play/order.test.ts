// @vitest-environment jsdom
/**
 * Ordering the blockers, when the ordering space is bigger than the column.
 *
 * `mtg-0pca`. CR 509.2 asks the attacking player to order the creatures blocking
 * each of their attackers, and the kernel enumerates that as the permutations of
 * every multiply-blocked attacker's blockers crossed together: n! per attacker,
 * so eight blockers on one creature is 40,320 spellings and 3,360 genuine
 * orderings once `mtg-2aca`'s fold has merged the ones the position cannot tell
 * apart. The rail printed one prose sentence per option and a player clicked
 * through them. `src/routes/play/order.ts` replaced that list with the same
 * roster-and-confirm the two combat declarations use, and the playtester's own words
 * for what it is for: "closer to the UX of MTGO and less clicking pop up
 * sentences".
 *
 * **The load-bearing test is the completeness walk**, for `declare.test.ts`'s
 * reason: narrowing the rail is only honest if nothing was narrowed away. A
 * board whose whole ordering space is six is driven to every one of them through
 * rendered clicks, and each has to submit its own index into `decision.options`.
 *
 * The other three are the states a list never had. A half-built order is not a
 * move and offers no confirm. An order spelled with the twins the other way
 * round is the *same* move and must record the same integer, which is the whole
 * of why `settledAction` is exported from the kernel. And past the 512-option cap
 * — which the bead's own eight-blocker board is a long way past — the ordering
 * goes over as itself and the kernel applies it.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Decision, GameSession, GameState } from '@mtg/kernel';
import {
  asksInSteps,
  choose,
  DEFAULT_ENUMERATION_CAP,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { blockerCount, orderChoice, orderPlan, placeOf, withPress } from '../../src/routes/play/order';
import type { OrderGroup, OrderPlan, Ordering } from '../../src/routes/play/order';
import { ORDER_CLEAR_LABEL, orderGroupLabel } from '../../src/routes/play/order-panel';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

/** Seat 0 attacks and is the viewer everywhere below: CR 509.2 asks the attacker. */
const SEATS: SeatNames = ['You', 'Bot'];

let minted = 0;

/** A creature invented for this file, so no set's own card name is borrowed. */
function creature(name: string): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `slc-order-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'SLC', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
  });
}

/**
 * A board parked on the damage assignment order, with every blocker on the first
 * attacker.
 *
 * Walked there through the kernel's own machinery — attack with everything,
 * declare every eligible blocker against the first attacker, pass CR 508.2's
 * priority — so the position is one the game could have reached rather than one
 * fabricated beside it. Passing the same `Card` twice is what makes two blockers
 * a pair the position cannot tell apart, which is `mtg-2aca`'s fold and the
 * subject of one describe below.
 */
function orderingState(attackers: readonly Card[], blockers: readonly Card[]): GameState {
  const built = scenario({
    seed: 'test/play/order',
    battlefield: [
      ...attackers.map((card) => ({ card, controller: 0 as const, summoningSick: false })),
      ...blockers.map((card) => ({ card, controller: 1 as const, summoningSick: false })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const opening = pendingDecision(built.state);
  if (opening === null || opening.kind !== 'declareAttackers') {
    throw new Error('the board never reached an attack declaration');
  }
  // Driven to the end of the declaration rather than reduced once: past the
  // enumeration cap the kernel asks about one creature at a time (`mtg-tb7v`,
  // `mtg-y16d`).
  let current = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 40; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before the order was asked');
    if (pending.kind === 'orderBlockers') return current;
    if (pending.kind === 'declareBlockers') {
      const attacker = pending.attackers[0];
      if (attacker === undefined) throw new Error('nothing is attacking');
      current = reduce(current, {
        type: 'declareBlockers',
        player: pending.player,
        blocks: pending.eligible.map((oid) => ({ blocker: oid, attacker })),
      }).state;
      continue;
    }
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a damage assignment order');
}

function sessionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): GameSession {
  const pending = pendingDecision(state, cap);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat(SEATS[0]), humanSeat(SEATS[1])],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function decisionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): Decision {
  const decision = pendingDecision(state, cap);
  if (decision === null) throw new Error('the board left nobody to ask');
  return decision;
}

function planOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): OrderPlan {
  const plan = orderPlan(state, SEATS, decisionOn(state, cap));
  if (plan === null) throw new Error('the ordering decision produced no plan');
  return plan;
}

/**
 * How many damage assignment orders a group of blockers has.
 *
 * CR 510.1a orders the blockers of one attacker, so it is a permutation count,
 * divided by the interchangeable copies of each repeated card: two objects of
 * the same card in the same place are the same order, which is the fold
 * `order.ts` exists for. Stated here so the counts below are read off the
 * fixture rather than off `DEFAULT_ENUMERATION_CAP` — the cap is one global
 * constant over every enumeration in the kernel, and 60 is a fact about six
 * blockers in three classes, not about 512.
 */
function orderSpace(classSizes: readonly number[]): number {
  const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
  const total = classSizes.reduce((sum, size) => sum + size, 0);
  return classSizes.reduce((count, size) => count / factorial(size), factorial(total));
}

function onlyGroup(plan: OrderPlan): OrderGroup {
  const group = plan.groups[0];
  if (group === undefined || plan.groups.length !== 1) throw new Error('expected one blocked attacker');
  return group;
}

function rail(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function accessibleName(node: unknown): string {
  return attr(node, 'aria-label') ?? (node as { textContent?: string | null }).textContent ?? '';
}

/** One attacker's rows, in the order the group lists its blockers. */
function rows(group: OrderGroup): readonly unknown[] {
  return within(screen.getByRole('group', { name: orderGroupLabel(group) })).getAllByRole('button');
}

/**
 * The row for one blocker, found by its position rather than by its name.
 *
 * Three copies of one card are three rows reading the same words — that is the
 * board `mtg-2aca` is about and this file's eight-blocker fixture holds one — so
 * a name is not a key here. The rows are drawn in `group.blockers` order, which
 * one test below asserts outright.
 */
function rowFor(group: OrderGroup, oid: string): unknown {
  const at = group.blockers.findIndex((blocker) => blocker.oid === oid);
  const row = rows(group)[at];
  if (row === undefined) throw new Error(`no row for ${oid}`);
  return row;
}

function click(node: unknown): void {
  fireEvent.click(node as Parameters<typeof fireEvent.click>[0]);
}

/**
 * Presses the group's rows until they hold `order`, first place first.
 *
 * Every press is a real click on a rendered button, so what this walks is the
 * surface rather than the model under it.
 */
function drive(group: OrderGroup, order: readonly string[]): void {
  for (const oid of order) click(rowFor(group, oid));
}

/** The eight-blocker board the bead was filed off: 8!/(3!·2!) = 3,360 orderings. */
function beadBoard(): GameState {
  const trio = creature('Fen Trio Guard');
  const pair = creature('Salt Pair Guard');
  return orderingState(
    [creature('Verge Harrier')],
    [
      trio,
      trio,
      trio,
      pair,
      pair,
      creature('Lone Picket'),
      creature('Reed Watchman'),
      creature('Tin Lantern'),
    ],
  );
}

describe('the ordering model', () => {
  it('offers one row per blocker rather than one button per ordering', () => {
    const state = beadBoard();
    const decision = decisionOn(state);
    if (decision.kind !== 'orderBlockers') throw new Error('the board is not ordering blockers');

    const plan = planOn(state);
    expect(plan.groups).toHaveLength(1);
    expect(blockerCount(plan)).toBe(8);

    // What the rail is handed on a board this size. It used to be the cap's 512
    // spellings of 3,360, with the kernel saying outright that it had not
    // finished; `mtg-tb7v` sequenced the decision, so past the cap it asks about
    // one position at a time and the list is one entry per blocker the position
    // can tell apart. The rail below is unchanged by that, which is the point of
    // asserting it here: `order.ts` builds from `decision.blocks` and never
    // reads the option list.
    //
    // Counted off the board rather than written down, because the property is
    // "one per distinguishable blocker" and 5 is only what these eight
    // creatures happen to make it. Names stand in for damage-order classes on
    // this board: `beadBoard` gives the twins the same card, so two blockers
    // read alike exactly when they are one class.
    const distinct = new Set(onlyGroup(plan).blockers.map((blocker) => blocker.name)).size;
    expect(distinct).toBeLessThan(blockerCount(plan));
    expect(asksInSteps(decision)).toBe(true);
    expect(decision.options).toHaveLength(distinct);
    expect(decision.complete).toBe(true);

    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose: vi.fn() }));
    // Eight rows and no confirm, because nothing is placed yet. Linear in the
    // block where the flat list was factorial in it, which is the whole bead.
    expect(within(rail()).getAllByRole('button')).toHaveLength(8);
    expect(within(rail()).queryByRole('note')).not.toBeNull();
    // And they are drawn in the group's own order, which is what makes a row
    // findable on a board where three of them read the same words.
    const group = onlyGroup(plan);
    expect(rows(group).map((row) => accessibleName(row).split(',')[0])).toEqual(
      group.blockers.map((blocker) => blocker.name),
    );
  });

  it('leaves every other decision listing one button per option', () => {
    const priority = scenario({ seed: 'test/play/order/priority', active: 0, turn: 3 }).state;
    const decision = pendingDecision(priority);
    if (decision === null) throw new Error('the priority board left nobody to ask');
    expect(orderPlan(priority, SEATS, decision)).toBeNull();
  });

  it('leaves a settled one-option order to the flat list', () => {
    // Three copies of one card blocking one attacker. `mtg-2aca`'s fold makes
    // that one option rather than six, and a question with one answer is not a
    // question: the panel would draw three rows and a confirm to reach the move
    // the flat list already states in a line.
    const same = creature('Coil Sentry');
    const state = orderingState([creature('Dune Runner')], [same, same, same]);
    const decision = decisionOn(state);
    expect(decision.options).toHaveLength(1);
    expect(decision.complete).toBe(true);
    expect(orderPlan(state, SEATS, decision)).toBeNull();

    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose: vi.fn() }));
    expect(within(rail()).getAllByRole('button')).toHaveLength(1);
  });

  it('places a blocker on the first press and takes it back on the second', () => {
    const state = orderingState(
      [creature('Gale Skirmisher')],
      [creature('Warren Picket'), creature('Pier Watchman')],
    );
    const group = onlyGroup(planOn(state));
    const [first, second] = group.blockers;
    if (first === undefined || second === undefined) throw new Error('the group is missing a blocker');

    let ordering: Ordering = new Map();
    ordering = withPress(ordering, group, first.oid);
    ordering = withPress(ordering, group, second.oid);
    expect(placeOf(ordering, group, first.oid)).toBe(1);
    expect(placeOf(ordering, group, second.oid)).toBe(2);

    // Taking the first one out closes the gap behind it rather than leaving a
    // hole, which is the one rule a damage assignment order has no room for.
    ordering = withPress(ordering, group, first.oid);
    expect(placeOf(ordering, group, first.oid)).toBeNull();
    expect(placeOf(ordering, group, second.oid)).toBe(1);
  });
});

describe('the completeness walk', () => {
  it('reaches every enumerated ordering through the panel, each submitting its own index', () => {
    const state = orderingState(
      [creature('Ember Courser')],
      [creature('Quarry Hound'), creature('Stone Piper'), creature('Reed Sentry')],
    );
    // Three distinct blockers on one attacker: 3! = 6, every one of them a
    // decision the fold keeps apart. Small on purpose — every iteration is a
    // real click into a rendered React tree.
    const space = orderSpace([1, 1, 1]);
    expect(space).toBe(6);
    const decision = decisionOn(state, space);
    if (decision.kind !== 'orderBlockers') throw new Error('the board is not ordering blockers');
    expect(decision.options).toHaveLength(space);
    expect(decision.complete).toBe(true);

    const group = onlyGroup(planOn(state, space));
    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state, space), viewer: 0, names: SEATS, onChoose }));

    const submitted = new Set<number>();
    for (const [index, option] of decision.options.entries()) {
      if (option.type !== 'orderBlockers') throw new Error('a non-ordering was enumerated');
      const order = option.orders[0]?.blockers;
      if (order === undefined) throw new Error('an ordering named no attacker');
      const clear = screen.queryByRole('button', { name: ORDER_CLEAR_LABEL });
      if (clear !== null) click(clear);
      onChoose.mockClear();
      drive(group, order);
      const confirm = within(rail()).getAllByRole('button')[0];
      if (confirm === undefined) throw new Error('the panel offered nothing to confirm');
      click(confirm);
      expect(onChoose, `order ${order.join('>')} submitted nothing`).toHaveBeenCalledTimes(1);
      expect(onChoose.mock.calls[0]?.[0]).toBe(index);
      submitted.add(index);
    }

    // Every one of the six: the narrowing removed no ordering and invented none.
    expect(submitted.size).toBe(space);
  });

  it('offers nothing to confirm until every blocker has a place', () => {
    const state = orderingState(
      [creature('Fen Outrider')],
      [creature('Marsh Drover'), creature('Salt Harrier'), creature('Cliff Runner')],
    );
    const group = onlyGroup(planOn(state));
    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose }));

    const first = group.blockers[0];
    if (first === undefined) throw new Error('the group is missing a blocker');
    click(rowFor(group, first.oid));
    // Half an order is where every player building one starts, and CR 509.2 has
    // no move for it. The three rows are still there and still pressable, which
    // is what makes the state escapable rather than a dead end; the fourth
    // button is Clear, which arrives with the first placement.
    expect(within(rail()).queryByRole('note')).not.toBeNull();
    expect(rows(group)).toHaveLength(3);
    expect(within(rail()).getAllByRole('button')).toHaveLength(4);
    expect(accessibleName(rowFor(group, first.oid))).toBe(`${first.name}, damage 1 of 3`);
    expect(onChoose).not.toHaveBeenCalled();

    drive(
      group,
      group.blockers.slice(1).map((blocker) => blocker.oid),
    );
    expect(within(rail()).queryByRole('note')).toBeNull();
    const confirm = within(rail()).getAllByRole('button')[0];
    if (confirm === undefined) throw new Error('the finished order offered nothing to confirm');
    click(confirm);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

describe('two blockers the position cannot tell apart', () => {
  it('records the enumerated index whichever twin was pressed first', () => {
    // `mtg-2aca`'s fold seen from the surface. Two copies of one card and one
    // other creature: three orderings rather than six, and the enumeration keeps
    // one spelling of each. A player pressing the other twin first has made the
    // same move, so the surface owes the same integer — which is what
    // `settledAction` is exported from the kernel to decide.
    const twin = creature('Twin Sentry');
    const state = orderingState([creature('Ridge Courier')], [twin, twin, creature('Odd Picket')]);
    const decision = decisionOn(state);
    if (decision.kind !== 'orderBlockers') throw new Error('the board is not ordering blockers');
    expect(decision.options).toHaveLength(3);

    const plan = planOn(state);
    const group = onlyGroup(plan);
    const [one, two, odd] = group.blockers;
    if (one === undefined || two === undefined || odd === undefined) throw new Error('the block is wrong');

    // The spelling the fold dropped: no option lists it, so a bare index lookup
    // finds nothing and the confirm would have submitted a constructed action on
    // a board whose whole space is enumerated.
    const swapped: Ordering = new Map([[group.attacker, [two.oid, one.oid, odd.oid]]]);
    const listed = decision.options.some(
      (option) =>
        option.type === 'orderBlockers' &&
        option.orders[0]?.blockers.join('>') === [two.oid, one.oid, odd.oid].join('>'),
    );
    expect(listed).toBe(false);

    const choice = orderChoice(state, plan, swapped);
    expect(typeof choice).toBe('number');
    const settled = decision.options[choice as number];
    expect(settled).toEqual({
      type: 'orderBlockers',
      player: 0,
      orders: [{ attacker: group.attacker, blockers: [one.oid, two.oid, odd.oid] }],
    });
    // And the two spellings are one move on the board, which is what made the
    // fold legitimate in the first place.
    const straight: Ordering = new Map([[group.attacker, [one.oid, two.oid, odd.oid]]]);
    expect(orderChoice(state, plan, straight)).toBe(choice);
  });
});

/**
 * The cap is the case the bead is about: the eight-blocker board offers 3,360
 * genuine orderings and the kernel enumerates 512 of them, so a surface that can
 * only submit an index cannot reach most of the moves the player is entitled to.
 * `orderChoice` sends the ordering itself there, exactly as `declare.ts` does one
 * decision earlier and as `chooseAction` was built for.
 */
describe('a block bigger than the enumeration cap', () => {
  it('folds the fixture the way the bead counted it', () => {
    // The eight-blocker board's 3,360 is 8!/(3!·2!) — three copies of one card,
    // two of another, three singletons — and the cap hides that arithmetic
    // behind a truncated 512. So the same shape is asserted one size down, where
    // the enumeration finishes: six blockers, 6!/(3!·2!) = 60, complete. Without
    // this the count in every comment above is a number nothing checks.
    const trio = creature('Fen Trio Guard');
    const pair = creature('Salt Pair Guard');
    const state = orderingState(
      [creature('Verge Harrier')],
      [trio, trio, trio, pair, pair, creature('Lone Picket')],
    );
    const space = orderSpace([3, 2, 1]);
    expect(space).toBe(60);
    const decision = decisionOn(state, space);
    expect(decision.options).toHaveLength(space);
    expect(decision.complete).toBe(true);
  });

  it('submits an ordering the enumeration never listed, as the ordering itself', () => {
    const state = beadBoard();
    const decision = decisionOn(state);
    if (decision.kind !== 'orderBlockers') throw new Error('the board is not ordering blockers');
    const plan = planOn(state);
    const group = onlyGroup(plan);
    // Every blocker in reverse, which is always past the point the
    // lexicographic truncation reached.
    const reversed = [...group.blockers].reverse().map((blocker) => blocker.oid);
    const ordering: Ordering = new Map([[group.attacker, reversed]]);

    const submitted = orderChoice(state, plan, ordering);
    expect(typeof submitted).not.toBe('number');
    expect(submitted).toEqual({
      type: 'orderBlockers',
      player: 0,
      orders: [{ attacker: group.attacker, blockers: reversed }],
    });

    // And the same ordering through the surface: eight rows pressed in that
    // order, then the confirm.
    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose }));
    drive(group, reversed);
    const confirm = within(rail()).getAllByRole('button')[0];
    if (confirm === undefined) throw new Error('the panel offered nothing to confirm');
    click(confirm);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]?.[0]).toEqual(submitted);
  });

  it('is applied by the kernel, so the order reaches the board', () => {
    const state = beadBoard();
    const plan = planOn(state);
    const group = onlyGroup(plan);
    const reversed = [...group.blockers].reverse().map((blocker) => blocker.oid);
    const submitted = orderChoice(state, plan, new Map([[group.attacker, reversed]]));
    if (submitted === null) throw new Error('the ordering named nothing to submit');

    const applied = choose(sessionOn(state), submitted);

    // The kernel settles a position on the creature the board is already
    // holding there rather than swapping two the position cannot tell apart
    // (`damage-order.ts`), so a run of twins comes back in the board's spelling
    // and not the caller's. That is the same move, and it is the same move the
    // test above submits, so what has to match is the run of creatures.
    const named = new Map(group.blockers.map((blocker) => [blocker.oid, blocker.name]));
    const placed = applied.state.combat.blocks[0]?.blockers ?? [];
    expect(placed.map((oid) => named.get(oid))).toEqual(reversed.map((oid) => named.get(oid)));
    // And the same creatures, so a spelling that dropped or duplicated one
    // cannot pass by reading alike.
    expect([...placed].sort()).toEqual([...reversed].sort());
    expect(applied.choices).toEqual([submitted]);
  });
});

describe('the board half', () => {
  const BLOCKER_FACES = '.mtg-card';

  interface Node {
    getAttribute(name: string): string | null;
    querySelectorAll(selector: string): ArrayLike<Node>;
  }

  function faces(): readonly Node[] {
    const body = (globalThis as { document?: { body?: Node } }).document?.body;
    if (body === undefined) throw new Error('no document');
    return Array.from(body.querySelectorAll(BLOCKER_FACES));
  }

  /** One card face, by the name it publishes; `block-gesture.test.ts`'s rule. */
  function face(name: string): Node {
    const found = faces().filter((node) => node.getAttribute('aria-label')?.startsWith(`${name}.`) === true);
    const first = found[0];
    if (first === undefined) throw new Error(`no card face named ${name}`);
    return first;
  }

  it('lights the blockers and places one where the player pressed it', () => {
    // The gesture the playtester asked for: the order is built on the creatures
    // rather than in a list of sentences about them. CR 509.2 asks the attacking
    // player, so for once the pressable cards are the opponent's.
    const state = orderingState(
      [creature('Cloud Runner')],
      [creature('Bank Sentinel'), creature('Kiln Warden'), creature('Tide Picket')],
    );
    const group = onlyGroup(planOn(state));
    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose: vi.fn() }));

    const second = group.blockers[1];
    if (second === undefined) throw new Error('the group is missing a blocker');
    const card = face('Kiln Warden');
    expect(attr(card, 'data-interactive')).toBe('true');
    click(card);

    // The panel and the board agree, because both read one ordering: the row
    // says where the creature sits and the card wears the same number. Drawn
    // rather than silent, unlike the staged block one step earlier — nothing
    // else on the board carries the number, and `Battlefield.ts` argues it.
    expect(accessibleName(rowFor(group, second.oid))).toBe(`${second.name}, damage 1 of 3`);
    const mark = screen.getByRole('img', {
      name: 'Takes damage 1 in the order being assigned; not confirmed yet.',
    });
    expect(attr(mark, 'data-mark')).toBe('damage-order');
    expect((mark as { textContent?: string | null }).textContent).toBe('#1');
  });
});
