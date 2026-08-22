/**
 * When two blockers are the same slot in a damage assignment order.
 *
 * CR 509.2 makes the attacking player order the creatures blocking one attacker,
 * and the enumeration of that choice is the permutations of the list. On a board
 * where every blocker is a different creature that is exactly right: six
 * blockers is 720 genuinely different answers, and `enumerate.ts` caps the list
 * and says so.
 *
 * It stops being right the moment two of the blockers are the same creature in
 * the same state. Three copies of one card and two of another gang-blocking one
 * attacker is 8! = 40,320 permutations of which only 3,360 are different
 * decisions; the other 36,960 are the same decision spelled with the twins
 * swapped. `mtg-2aca` measured what that costs a player — a rail of 512
 * seven-line paragraphs where entries 486 and 504 are character-for-character
 * identical — and it is `naming.ts`'s rule broken at the one decision where the
 * list is longest: two legal moves must not read the same.
 *
 * The fix has to be here rather than in the surface. A rail that hid the repeats
 * would be hiding options the kernel still believed in, so an index into
 * `Decision.options` would mean one thing to the kernel and another to the
 * screen. What is wrong is the enumeration: those permutations are not moves.
 *
 * # What makes two blockers one slot
 *
 * The same question `@mtg/ui`'s `distinguishingLine` answers for a label, asked
 * where the options are built and answered from the whole state rather than from
 * what a card face shows. Two blockers are one slot when *nothing in the
 * position tells them apart*, which is two claims:
 *
 *  1. **Their own record and their current characteristics are identical.**
 *     Everything `GameObject` writes down except which one it is — controller,
 *     tapped, damage marked, counters, deathtouched, token, what it is attached
 *     to — plus the layer output, so a pumped twin and a printed one never merge
 *     (CR 613).
 *  2. **Nothing else in the state points at either of them.** A relationship is
 *     not a property, so no profile can hold it: an aura on one twin, a Shock on
 *     the stack aimed at one, a continuous effect naming one, a second attacker
 *     the creature is also blocking. `pointedAt` walks the whole position for
 *     mentions rather than listing the places a mention can hide, so a kernel
 *     that learns a new field does not quietly start merging creatures that
 *     field distinguishes.
 *
 * Both directions of the answer are load-bearing. Merging two blockers a player
 * could tell apart deletes a legal decision; refusing to merge two nobody can
 * tell apart is the 512-line rail. The walk is deliberately over-eager — a
 * mention anywhere is a mention — because the first mistake is the one that
 * loses a game and the second only costs a longer list.
 */
import { canonicalJson } from '@mtg/dsl';
import type { Action } from './actions';
import { characteristicsOf } from './layers';
import type { ObjectId } from './ids';
import type { GameState } from './state';

/**
 * Every object id the position mentions outside the containers that merely hold
 * one.
 *
 * Three exclusions, and each is a claim that the container says nothing about
 * the object beyond "it is here":
 *
 *  - `state.objects` is the record of every object, so walking it would find
 *    every id by definition. The one edge an object can carry to another is
 *    `attachedTo` (CR 301.5), and both of its ends are added by hand below.
 *  - `state.battlefield` is a zone, and CR 400 gives a zone no order. Two twins
 *    sit at different indices in it and that is not a fact about either.
 *  - `state.combat.blocks` holds the very lists being ordered. A blocker's
 *    membership in its own block is the question, not an answer to it; a blocker
 *    that is in *two* blocks is genuinely singled out, which `damageOrderClasses`
 *    puts back below rather than losing with the exclusion.
 */
function pointedAt(state: GameState): ReadonlySet<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      found.add(key);
      walk(entry);
    }
  };

  // Destructured rather than listed, so a new field on `GameState` or
  // `CombatState` is walked the day it is added instead of the day somebody
  // notices it is not.
  const { objects, battlefield: _zone, combat, ...elsewhere } = state;
  walk(elsewhere);
  const { blocks: _ordered, ...restOfCombat } = combat;
  walk(restOfCombat);
  for (const object of Object.values(objects)) {
    if (object.attachedTo === undefined) continue;
    found.add(object.attachedTo);
    found.add(object.oid);
  }
  return found;
}

/** Everything the object's own record and the layers say, minus which one it is. */
function profileOf(state: GameState, oid: ObjectId): string {
  const object = state.objects[oid];
  if (object === undefined) return `missing:${oid}`;
  return canonicalJson({
    record: { ...object, oid: '' },
    current: characteristicsOf(state, oid),
  });
}

/**
 * One key per blocker, equal exactly when two of them are the same slot in the
 * damage assignment order.
 *
 * A blocker the position singles out gets a key of its own — spelled with its
 * id, which nothing else can collide with — so the merge only ever happens
 * between creatures the state has nothing to say about separately.
 */
export function damageOrderClasses(
  state: GameState,
  blockers: readonly ObjectId[],
): ReadonlyMap<ObjectId, string> {
  const pointed = pointedAt(state);
  const seen = new Set<ObjectId>();
  const blocksTwice = new Set<ObjectId>();
  for (const block of state.combat.blocks) {
    for (const blocker of block.blockers) {
      if (seen.has(blocker)) blocksTwice.add(blocker);
      seen.add(blocker);
    }
  }

  const classes = new Map<ObjectId, string>();
  for (const blocker of blockers) {
    const singled = pointed.has(blocker) || blocksTwice.has(blocker);
    classes.set(blocker, singled ? `alone:${blocker}` : profileOf(state, blocker));
  }
  return classes;
}

/** The listed ordering that says what this one says, given the block it is for. */
function settledBlockers(
  state: GameState,
  attacker: ObjectId,
  spelled: readonly ObjectId[],
): readonly ObjectId[] {
  const block = state.combat.blocks.find((entry) => entry.attacker === attacker);
  if (block === undefined) return spelled;
  const classes = damageOrderClasses(state, block.blockers);
  const keyOf = (oid: ObjectId): string => classes.get(oid) ?? oid;
  const spent = new Set<number>();
  return spelled.map((oid) => {
    const key = keyOf(oid);
    const at = block.blockers.findIndex((member, index) => !spent.has(index) && keyOf(member) === key);
    if (at === -1) return oid;
    spent.add(at);
    return block.blockers[at] ?? oid;
  });
}

/**
 * The move as the enumeration spells it, for a caller who spelled it another
 * way.
 *
 * `canonicalAction` does this for the lists the rules treat as sets, and it can
 * do it without the board because "these two entries are one set" is a fact
 * about the action alone. Which two blockers are one slot is not: it is a fact
 * about the position, so it needs the position, and that is the whole reason
 * this lives here rather than beside `canonicalAction`.
 *
 * Every other action is returned untouched, so this is `chooseAction`'s one-line
 * bridge rather than a second normalization step in the middle of it. For an
 * ordering it rewrites each slot to the first still-unspent blocker of that
 * slot's class, which is exactly the choice `distinctPermutations` made when it
 * built the list — so a spelling folded out of the enumeration lands on the
 * index of the option it was folded into, and `Decision.complete` keeps meaning
 * that every legal move has one.
 */
export function settledAction(state: GameState, action: Action): Action {
  if (action.type !== 'orderBlockers') return action;
  return {
    ...action,
    orders: action.orders.map((order) => ({
      ...order,
      blockers: settledBlockers(state, order.attacker, order.blockers),
    })),
  };
}
