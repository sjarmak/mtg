/**
 * The damage assignment order, asked as a sequence instead of capped.
 *
 * `mtg-tb7v` stage 1. CR 509.2's ordering is a permutation, `enumerate.ts` caps
 * at 512, and six blockers on one attacker is 720 orderings — so 208 of them had
 * no index and no surface could name them. The fix is not a bigger cap: a
 * permutation is a sequence of small decisions, and asking it that way is what
 * `@mtg/engine`'s `decision.ts` says the session contract already carries.
 *
 * Every assertion here is about *reachability*, never about 512. The cap decides
 * how many positions one question settles; it no longer decides which orderings
 * exist. So the oracle is a permutation generator written in this file rather
 * than the kernel's, and the property is set equality against it.
 */
import { describe, expect, it } from 'vitest';
import type { Action, Decision, GameSession, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  chooseAction,
  choose,
  DEFAULT_ENUMERATION_CAP,
  humanSeat,
  indexOfAction,
  opponentOf,
  pendingDecision,
  reduce,
  scenario,
  serializeEvents,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { creature } from './cards';

type OrderDecision = Extract<Decision, { kind: 'orderBlockers' }>;
type OrderAction = Extract<Action, { type: 'orderBlockers' }>;

/**
 * A board parked on the damage assignment order.
 *
 * Walked there through the real actions — attack, pass, block — so every
 * position asserted about is one the kernel could have reached itself.
 * `onto[i]` is the index of the attacker blocker `i` is declared against, which
 * is how a two-attacker board says which gang is which.
 */
function orderingBoard(
  attackers: readonly Card[],
  blockers: readonly Card[],
  onto: readonly number[],
): GameState {
  const built: ReduceResult = scenario({
    seed: 'kernel/order-sequence',
    battlefield: [
      ...attackers.map((card) => ({ card, controller: 0 as const })),
      ...blockers.map((card) => ({ card, controller: 1 as const })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const attacking = built.state.battlefield.filter((oid) => built.state.objects[oid]?.controller === 0);
  const defender = opponentOf(0);
  let current = reduce(built.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: attacking.map((oid) => ({ oid, defender })),
  }).state;
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before blockers were declared');
    if (pending.kind === 'declareBlockers') {
      current = reduce(current, {
        type: 'declareBlockers',
        player: pending.player,
        blocks: pending.candidates.map((entry, index) => {
          const attacker = pending.attackers[onto[index] ?? 0];
          if (attacker === undefined) throw new Error('the board named an attacker it does not have');
          return { blocker: entry.blocker, attacker };
        }),
      }).state;
      if (current.turn.awaiting !== 'blockerOrder') throw new Error('the block asked for no ordering');
      return current;
    }
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

function orderDecisionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): OrderDecision {
  const decision = pendingDecision(state, cap);
  if (decision === null || decision.kind !== 'orderBlockers') {
    throw new Error('the board is not asking for an order');
  }
  return decision;
}

/** A session standing on a stated board, so a decision can be answered on it. */
function sessionOn(state: GameState): GameSession {
  return {
    seats: [humanSeat('you'), humanSeat('them')],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** Whether an option answers the whole question rather than one position of it. */
function finishesTheOrder(decision: OrderDecision, option: Action): boolean {
  if (option.type !== 'orderBlockers') return false;
  return decision.blocks.every((block) => {
    const entry = option.orders.find((order) => order.attacker === block.attacker);
    return entry !== undefined && entry.blockers.length === block.blockers.length;
  });
}

function asksInPieces(decision: OrderDecision): boolean {
  return decision.options.some((option) => !finishesTheOrder(decision, option));
}

/** Every permutation of `items`, written here so the oracle is not the kernel's. */
function permute<T>(items: readonly T[]): readonly (readonly T[])[] {
  if (items.length <= 1) return [items];
  const results: (readonly T[])[] = [];
  for (const [index, item] of items.entries()) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permute(rest)) results.push([item, ...tail]);
  }
  return results;
}

/** The ordering a finished board is standing on, as one comparable string. */
function spellingOf(state: GameState): string {
  return state.combat.blocks.map((block) => `${block.attacker}:${block.blockers.join(',')}`).join('|');
}

interface Walk {
  /** Every ordering some path of answers arrives at. */
  readonly orderings: ReadonlySet<string>;
  /** How many questions the sequence asked, over every path. */
  readonly questions: number;
  /** How many of them stopped listing before they ran out of legal answers. */
  readonly incomplete: number;
}

/** Answers the order every way it can be answered, and collects where that lands. */
function walkOrder(start: GameState): Walk {
  const orderings = new Set<string>();
  let questions = 0;
  let incomplete = 0;
  const visit = (state: GameState): void => {
    if (state.turn.awaiting !== 'blockerOrder') {
      orderings.add(spellingOf(state));
      return;
    }
    const decision = orderDecisionOn(state);
    questions += 1;
    if (!decision.complete) incomplete += 1;
    if (decision.options.length === 0) throw new Error('the kernel asked with no legal answer');
    for (const option of decision.options) visit(reduce(state, option).state);
  };
  visit(start);
  return { orderings, questions, incomplete };
}

/** Every ordering of one block, spelled the way `spellingOf` spells it. */
function everyOrderingOf(state: GameState): ReadonlySet<string> {
  const block = state.combat.blocks[0];
  if (block === undefined) throw new Error('nothing is blocked');
  return new Set(permute(block.blockers).map((order) => `${block.attacker}:${order.join(',')}`));
}

const VANILLA = (count: number, prefix: string): readonly Card[] =>
  Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index)}`, 2, 2));

describe('an ordering the cap used to drop', () => {
  it('is reachable, on a board with more orderings than the cap lists', () => {
    // 6! = 720 orderings against a 512 cap, which is `mtg-y1t.1`'s board.
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4)],
      VANILLA(6, 'Blocker'),
      [0, 0, 0, 0, 0, 0],
    );
    const wanted = everyOrderingOf(state);

    // The search is non-vacuous: there are 720 spellings to fail to find.
    expect(wanted.size).toBe(720);

    const walk = walkOrder(state);

    expect(walk.orderings).toEqual(wanted);
    // Every question the sequence asked, it could finish.
    expect(walk.incomplete).toBe(0);
    // And it really was asked in pieces rather than listed in one go.
    expect(walk.questions).toBeGreaterThan(1);
    expect(asksInPieces(orderDecisionOn(state))).toBe(true);
  });

  it('is reachable across two attackers, whose product the cap dropped twice over', () => {
    // 4! x 4! = 576 orderings, and the cartesian over the two blocks is where
    // the truncation used to start.
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4), creature('Emberflow Raider', 4, 4)],
      VANILLA(8, 'Blocker'),
      [0, 0, 0, 0, 1, 1, 1, 1],
    );
    const blocks = state.combat.blocks;
    expect(blocks.length).toBe(2);
    const wanted = new Set<string>();
    for (const first of permute(blocks[0]?.blockers ?? [])) {
      for (const second of permute(blocks[1]?.blockers ?? [])) {
        wanted.add(
          `${blocks[0]?.attacker ?? ''}:${first.join(',')}|${blocks[1]?.attacker ?? ''}:${second.join(',')}`,
        );
      }
    }
    expect(wanted.size).toBe(576);

    const walk = walkOrder(state);

    expect(walk.orderings).toEqual(wanted);
    expect(walk.incomplete).toBe(0);
  });

  it('keeps two blockers the board cannot tell apart one slot, at every position of the sequence', () => {
    const raider = creature('Emberflow Raider', 2, 2);
    // 7!/3! = 840 orderings that differ, out of 5,040 spellings — `mtg-2aca`'s
    // fold, which the sequence has to keep or the rail comes back one position
    // at a time.
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4)],
      [raider, raider, raider, ...VANILLA(4, 'Blocker')],
      [0, 0, 0, 0, 0, 0, 0],
    );

    const walk = walkOrder(state);

    expect(walk.orderings.size).toBe(840);
    expect(walk.incomplete).toBe(0);
    // The fold did something: 5,040 spellings went in.
    expect(everyOrderingOf(state).size).toBe(5040);
  });
});

/** 3! — the orderings of three blockers the board can tell apart (CR 510.1a). */
const THREE_BLOCKER_ORDERS = 3 * 2 * 1;

describe('an order small enough to list', () => {
  it('is still one question, and its first answer is still the block as declared', () => {
    // 3! = 6, so nothing is asked in pieces and every recorded index into this
    // list still means what it meant. Asked for at that width rather than at
    // `DEFAULT_ENUMERATION_CAP`, which is one global constant over every
    // enumeration in the kernel: six is a fact about three blockers.
    const state = orderingBoard([creature('Ravening Bellower', 4, 4)], VANILLA(3, 'Blocker'), [0, 0, 0]);
    const decision = orderDecisionOn(state, THREE_BLOCKER_ORDERS);

    expect(THREE_BLOCKER_ORDERS).toBe(6);
    expect(decision.options.length).toBe(THREE_BLOCKER_ORDERS);
    expect(decision.complete).toBe(true);
    expect(asksInPieces(decision)).toBe(false);
    const first = decision.options[0];
    expect(first?.type === 'orderBlockers' && first.orders[0]?.blockers).toEqual(
      decision.blocks[0]?.blockers,
    );
  });
});

describe('a whole ordering answered at a position asked in pieces', () => {
  function sixBlockers(): GameState {
    return orderingBoard([creature('Ravening Bellower', 4, 4)], VANILLA(6, 'Blocker'), [0, 0, 0, 0, 0, 0]);
  }

  function reversal(state: GameState): OrderAction {
    const block = state.combat.blocks[0];
    if (block === undefined) throw new Error('nothing is blocked');
    return {
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [{ attacker: block.attacker, blockers: [...block.blockers].reverse() }],
    };
  }

  it('is legal, which is what the constructing bots depend on', () => {
    const state = sixBlockers();
    const whole = reversal(state);

    expect(asksInPieces(orderDecisionOn(state))).toBe(true);
    expect(validateAction(state, whole)).toBeNull();

    const applied = reduce(state, whole);

    expect(applied.state.turn.awaiting).toBeNull();
    expect(applied.state.combat.blocks[0]?.blockers).toEqual(
      [...(state.combat.blocks[0]?.blockers ?? [])].reverse(),
    );
    expect(applied.events.filter((event) => event.type === 'blockerOrderChosen').length).toBe(1);

    // How much of the order is settled is a fact about an unfinished question,
    // so a finished board carries none of it. A state that kept the field would
    // fingerprint differently from every board recorded before the sequence
    // existed, which is what `stateFingerprint` is pinned in six committed
    // artifacts for.
    expect(applied.state.combat.ordered).toBeUndefined();
    // Non-vacuous: one position in, the field is there to be left behind.
    const step = orderDecisionOn(state).options[0];
    if (step === undefined) throw new Error('the order was asked with no answer');
    expect(reduce(state, step).state.combat.ordered).not.toBeUndefined();
  });

  it('records itself where no index names it, and replays from what it recorded', () => {
    const state = sixBlockers();
    const whole = reversal(state);

    expect(indexOfAction(orderDecisionOn(state).options, whole)).toBeNull();

    const made = chooseAction(sessionOn(state), whole);

    expect(made.choices[0]).toEqual(whole);
    const spent = choose(sessionOn(state), made.choices[0] as Action);
    expect(stateFingerprint(spent.state)).toBe(stateFingerprint(made.state));
    expect(serializeEvents(spent.events)).toBe(serializeEvents(made.events));
  });

  it('lands the board the sequence lands, and says the same thing on the way', () => {
    const state = sixBlockers();
    const whole = reversal(state);
    const target = whole.orders[0]?.blockers ?? [];

    const atOnce = reduce(state, whole);

    // The same ordering, reached one position at a time.
    let stepwise: ReduceResult = { state, events: [] };
    for (let guard = 0; guard < 10 && stepwise.state.turn.awaiting === 'blockerOrder'; guard += 1) {
      const decision = orderDecisionOn(stepwise.state);
      const option = decision.options.find((entry) => {
        if (entry.type !== 'orderBlockers') return false;
        const blockers = entry.orders[0]?.blockers ?? [];
        return blockers.every((oid, index) => target[index] === oid);
      });
      if (option === undefined) throw new Error('the sequence dropped the ordering being walked to');
      const step = reduce(stepwise.state, option);
      stepwise = { state: step.state, events: [...stepwise.events, ...step.events] };
    }

    expect(stateFingerprint(stepwise.state)).toBe(stateFingerprint(atOnce.state));
    expect(serializeEvents(stepwise.events)).toBe(serializeEvents(atOnce.events));
  });

  it('is legal at the cap the mass simulator runs, which is what keeps the sim identical', () => {
    // `@mtg/sim`'s FAST_CAPS enumerates declarations at 1 because both shipped
    // bots construct their own. Under it the order is asked in pieces at every
    // gang block, and the bot's constructed answer still lands the same board.
    const state = orderingBoard([creature('Ravening Bellower', 4, 4)], VANILLA(3, 'Blocker'), [0, 0, 0]);
    const fast = pendingDecision(state, 1);
    if (fast === null || fast.kind !== 'orderBlockers')
      throw new Error('the board is not asking for an order');

    expect(fast.complete).toBe(true);
    expect(asksInPieces(fast)).toBe(true);

    const whole = reversal(state);
    expect(validateAction(state, whole)).toBeNull();

    // And it is the same move a cap wide enough to list the space names, so a
    // fast run and a full run of the same choices are the same game rather than
    // two spellings of it. The width is 3! rather than the shipped cap, because
    // what makes the two runs one game is that the ordering has an index at all.
    const listed = orderDecisionOn(state, THREE_BLOCKER_ORDERS);
    const index = indexOfAction(listed.options, whole);
    if (index === null) throw new Error('the listed order did not name the whole ordering');
    const option = listed.options[index];
    if (option === undefined) throw new Error('the index names no option');
    expect(stateFingerprint(reduce(state, option).state)).toBe(stateFingerprint(reduce(state, whole).state));
  });
});

describe('an answer that reopens a position the sequence already settled', () => {
  /** The six-blocker board with the first position answered, whichever way. */
  function oneSettled(blockers: readonly Card[]): GameState {
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4)],
      blockers,
      blockers.map(() => 0),
    );
    const first = orderDecisionOn(state).options[0];
    if (first === undefined) throw new Error('the order was asked with no answer');
    return reduce(state, first).state;
  }

  it('is refused, where the same answer that keeps it is taken', () => {
    const state = oneSettled(VANILLA(6, 'Blocker'));
    const block = state.combat.blocks[0];
    if (block === undefined) throw new Error('nothing is blocked');
    const [held, second, third] = block.blockers;
    if (held === undefined || second === undefined || third === undefined) {
      throw new Error('the block is too small to settle a position in');
    }
    const order = (blockers: readonly ObjectId[]): Action => ({
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [{ attacker: block.attacker, blockers }],
    });

    // A different creature at the settled position, and nothing at all there.
    expect(validateAction(state, order([third, held]))).not.toBeNull();
    expect(validateAction(state, order([]))).not.toBeNull();
    // The companion: keeping it and going on is the ordinary next answer, so
    // what was refused is the reopening rather than the shape.
    expect(validateAction(state, order([held, second]))).toBeNull();
  });

  it('is refused when another attacker in the same answer moves forward', () => {
    // Two gangs, so an answer can settle a position of one attacker's order and
    // drop a settled position of the other's in the same breath. Nothing else
    // catches that: the answer does make progress, and a prefix shorter than
    // what is settled contradicts nothing it does not reach.
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4), creature('Emberflow Raider', 4, 4)],
      VANILLA(8, 'Blocker'),
      [0, 0, 0, 0, 1, 1, 1, 1],
    );
    const asked = orderDecisionOn(state).options[0];
    if (asked === undefined) throw new Error('the order was asked with no answer');
    const settledState = reduce(state, asked).state;
    const [first, second] = settledState.combat.blocks;
    if (first === undefined || second === undefined) throw new Error('two gangs were expected');
    const held = first.blockers[0];
    const other = second.blockers[0];
    if (held === undefined || other === undefined) throw new Error('a gang is empty');
    const answer = (blockers: readonly ObjectId[]): Action => ({
      type: 'orderBlockers',
      player: settledState.turn.active,
      orders: [
        { attacker: first.attacker, blockers },
        { attacker: second.attacker, blockers: [other] },
      ],
    });

    expect(validateAction(settledState, answer([]))).not.toBeNull();
    // The companion: the second attacker's position is what carries this answer
    // either way, so what was refused is the dropped position.
    expect(validateAction(settledState, answer([held]))).toBeNull();
  });

  it('is taken when the position is respelled with a creature the board cannot tell from it', () => {
    // Three copies of one card, so the settled position holds a slot rather than
    // a creature (`damage-order.ts`) and either twin spells it. Eight blockers,
    // because 8!/3! orderings is what puts the board on the stepwise branch —
    // six would be listed whole and settle every position at once.
    const raider = creature('Emberflow Raider', 2, 2);
    const state = oneSettled([raider, raider, raider, ...VANILLA(5, 'Blocker')]);
    const block = state.combat.blocks[0];
    if (block === undefined) throw new Error('nothing is blocked');
    const [held, twin] = block.blockers;
    if (held === undefined || twin === undefined) throw new Error('the block is too small');
    expect(state.objects[held]?.card.name).toBe(state.objects[twin]?.card.name);

    const respelled: Action = {
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [{ attacker: block.attacker, blockers: [twin, held] }],
    };

    expect(validateAction(state, respelled)).toBeNull();
    // And it lands on the creature the board was already holding there, rather
    // than swapping two objects the position has nothing to say about.
    expect(reduce(state, respelled).state.combat.blocks[0]?.blockers[0]).toBe(held);
  });
});

describe('an answer that settles nothing', () => {
  it('is refused, where the same answer with one position in it is taken', () => {
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4)],
      VANILLA(6, 'Blocker'),
      [0, 0, 0, 0, 0, 0],
    );
    const block = state.combat.blocks[0];
    if (block === undefined) throw new Error('nothing is blocked');
    const empty: Action = { type: 'orderBlockers', player: state.turn.active, orders: [] };
    const nothingNamed: Action = {
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [{ attacker: block.attacker, blockers: [] }],
    };
    const onePosition: Action = {
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [{ attacker: block.attacker, blockers: [block.blockers[2] as ObjectId] }],
    };

    expect(validateAction(state, empty)).not.toBeNull();
    expect(validateAction(state, nothingNamed)).not.toBeNull();
    // The companion: the shape is not what was refused, the emptiness was.
    expect(validateAction(state, onePosition)).toBeNull();
  });

  it('is refused when it names a creature that is not in the block', () => {
    const state = orderingBoard(
      [creature('Ravening Bellower', 4, 4)],
      VANILLA(6, 'Blocker'),
      [0, 0, 0, 0, 0, 0],
    );
    const block = state.combat.blocks[0];
    if (block === undefined) throw new Error('nothing is blocked');
    const stranger = state.combat.attacks[0]?.oid;
    if (stranger === undefined) throw new Error('nothing is attacking');
    const wrong: Action = {
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [{ attacker: block.attacker, blockers: [stranger] }],
    };
    const twice: Action = {
      type: 'orderBlockers',
      player: state.turn.active,
      orders: [
        {
          attacker: block.attacker,
          blockers: [block.blockers[0] as ObjectId, block.blockers[0] as ObjectId],
        },
      ],
    };

    expect(validateAction(state, wrong)).not.toBeNull();
    expect(validateAction(state, twice)).not.toBeNull();
    expect(
      validateAction(state, {
        type: 'orderBlockers',
        player: state.turn.active,
        orders: [{ attacker: block.attacker, blockers: [block.blockers[0] as ObjectId] }],
      }),
    ).toBeNull();
  });
});
