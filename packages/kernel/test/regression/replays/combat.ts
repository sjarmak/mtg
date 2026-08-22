/**
 * Combat defects the bank replays.
 *
 * One entry so far: CR 509.2's damage assignment order (`9e8d268`,
 * `mtg-2aca`). `block-enumeration.test.ts` holds the fuller treatment,
 * including the 512-cap behavior on the eight-blocker board the bead was filed
 * from; what is here is the property that separates the fixed kernel from the
 * broken one, stated so it cannot pass by accident.
 */
import { expect } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action, BlockDeclaration, Decision, GameSession, GameState } from '@mtg/kernel';
import {
  chooseAction,
  humanSeat,
  indexOfAction,
  opponentOf,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { creature } from '../../cards';
import { replay } from '../bank';

const BELLOWER = creature('Ravening Bellower', 4, 4);
const RAIDER = creature('Emberflow Raider', 2, 2);
const WARDEN = creature('Stone Warden', 2, 3);

interface Gang {
  readonly state: GameState;
  readonly decision: Extract<Decision, { kind: 'orderBlockers' }>;
}

/**
 * One attacker, every listed creature blocking it, parked on CR 509.2's order.
 *
 * Walked there through the real turn machinery — the attack is an action and
 * both seats then pass through CR 508.2's priority — so the position asserted
 * about is one the kernel could have reached itself.
 */
function gangBlocked(blockers: readonly Card[], damage: readonly number[] = []): Gang {
  const built = scenario({
    seed: 'regression/damage-order',
    battlefield: [
      { card: BELLOWER, controller: 0 },
      ...blockers.map((card, index) => ({ card, controller: 1 as const, damage: damage[index] })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const attacker = built.state.battlefield.find((oid) => built.state.objects[oid]?.controller === 0);
  if (attacker === undefined) throw new Error('nothing to attack with');
  let current = reduce(built.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: attacker, defender: opponentOf(0) }],
  }).state;

  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before the order was asked for');
    if (pending.kind === 'declareBlockers') {
      current = reduce(current, {
        type: 'declareBlockers',
        player: pending.player,
        blocks: pending.candidates.map((entry): BlockDeclaration => ({
          blocker: entry.blocker,
          attacker,
        })),
      }).state;
      continue;
    }
    if (pending.kind === 'orderBlockers') return { state: current, decision: pending };
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached the damage assignment order');
}

/** What each option says, in the words a rail would print it in. */
function lines(gang: Gang): readonly string[] {
  return gang.decision.options.map((option) =>
    option.type !== 'orderBlockers'
      ? ''
      : option.orders
          .map((order) => order.blockers.map((oid) => gang.state.objects[oid]?.card.name ?? '?').join(', '))
          .join('; '),
  );
}

/** A session standing on a stated board, so a decision can be answered on it. */
function sessionOn(state: GameState, decision: Decision): GameSession {
  return {
    seats: [humanSeat('you'), humanSeat('them')],
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

/** Copies of one card, which is what a gang block is actually made of. */
function copies(count: number, card: Card): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

export const COMBAT_REPLAYS = [
  replay(
    '9e8d268',
    'CR 509.2: every listed damage assignment order reads differently from every other',
    () => {
      // The property, not a count: an option list whose printed lines repeat is
      // a list of spellings rather than of decisions, which is exactly what the
      // pre-fix `permutations` call produced. Three interchangeable blockers
      // gave six options and one line; the mixed board gave six options and
      // three lines.
      for (const gang of [gangBlocked(copies(3, RAIDER)), gangBlocked([RAIDER, RAIDER, WARDEN])]) {
        const printed = lines(gang);
        expect(printed.length).toBeGreaterThan(0);
        expect(new Set(printed).size, 'two enumerated orderings read identically').toBe(printed.length);
      }

      // Non-vacuity from the other side: the merge is the board's judgment and
      // not a blanket rule about same-named creatures. Mark one of two copies
      // with a point of damage and it dies to less (CR 510.1c), so the two
      // orderings become two answers and the list grows.
      const plain = gangBlocked(copies(2, RAIDER));
      const marked = gangBlocked(copies(2, RAIDER), [1, 0]);
      expect(marked.decision.options.length).toBeGreaterThan(plain.decision.options.length);
    },
  ),
  replay(
    '9e8d268',
    'CR 509.2: a spelling the enumeration folded away still resolves to the option it was folded into',
    () => {
      // The half that keeps recorded games replayable. A player who spells an
      // ordering the list no longer separates is not making an illegal move —
      // `validateOrdering` never read the list — so `chooseAction` settles the
      // spelling against the board and records the index it was folded into.
      const gang = gangBlocked(copies(3, RAIDER));
      const block = gang.decision.blocks[0];
      if (block === undefined) throw new Error('nothing is blocked');
      const swapped: Action = {
        type: 'orderBlockers',
        player: gang.decision.player,
        orders: [{ attacker: block.attacker, blockers: [...block.blockers].reverse() }],
      };

      expect(indexOfAction(gang.decision.options, swapped)).toBeNull();
      const applied = chooseAction(sessionOn(gang.state, gang.decision), swapped);
      expect(applied.choices).toHaveLength(1);
      expect(applied.state.combat.blocks[0]?.blockers).toEqual([...block.blockers]);
    },
  ),
];
