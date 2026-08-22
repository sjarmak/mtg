/**
 * "It doesn't untap during its controller's next untap step" — the second
 * sentence on every playable tapper Magic prints, and the one the DSL could not
 * say until `mtg-h9gl`.
 *
 * The whole of the rider is a debt owed to one untap step, so what these tests
 * play is turns rather than resolutions. A tap that is undone four steps later
 * buys one attack; a tap that survives the next untap step costs its controller
 * a whole turn of that permanent, and the difference between the two is only
 * visible with the turn cycle running.
 *
 * Four rules, one test each:
 *
 *   - the debt is paid by the controller's *next* untap step and no other;
 *   - a bare tap owes nothing, and carries no trace of the field at all, which
 *     is what keeps `stateFingerprint`, replay and every stored position where
 *     they were;
 *   - the sweep arm holds a creature it found already tapped, so a defender
 *     cannot tap out from under it;
 *   - a zone change clears the debt (CR 400.7).
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect } from '@mtg/dsl';
import type { Action, GameState, ReduceResult, Target } from '@mtg/kernel';
import { pendingDecision, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { creature, instant, ISLAND, sorcery } from './cards';
import { apply, oidOf } from './helpers';

const SWEEP = 'creaturesThatPlayerControls' as const;
const AT_OPPONENT: Target = { kind: 'player', player: 1 };

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts the first card in player 0's hand and lets it resolve. */
function castAndResolve(start: GameState, targets: readonly (Target | null)[]): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

/** Idles forward: passes priority and takes the first option on every other decision. */
function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended before the turn arrived');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${String(turn)}`);
}

function islands(count: number, controller: 0 | 1): { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: ISLAND, controller }));
}

function tappedNamed(state: GameState, name: string): boolean {
  return state.objects[oidOf(state, name)]?.tapped === true;
}

function heldTap(target: 'one' | 'sweep'): Effect {
  return target === 'sweep'
    ? { kind: 'tapPermanent', scope: SWEEP, target: { kind: 'targetOpponent' }, doesNotUntap: true }
    : { kind: 'tapPermanent', target: { kind: 'targetCreature' }, doesNotUntap: true };
}

describe('a tap that holds', () => {
  /**
   * The rule stated as a schedule. `scenario` opens on turn 2 in the caster's
   * main phase, so the defender's untap steps are turns 3 and 5; the hold eats
   * the first, and the second gives the creature back. Asserting the release as
   * well as the skip is what separates this rider from "never untaps", which is
   * a different card.
   */
  it("costs the permanent its controller's next untap step and only that one", () => {
    const rune = instant('Stasis Rune', [heldTap('one')], { U: 1 });
    const start = scenario({
      battlefield: [...islands(2, 0), { card: creature('Ice Nightflit', 2, 2), controller: 1 }],
      hands: [[rune], []],
    });
    const held = oidOf(start.state, 'Ice Nightflit');
    const cast = castAndResolve(start.state, [{ kind: 'permanent', oid: held }]);
    expect(cast.objects[held]?.tapped).toBe(true);
    expect(cast.objects[held]?.skipsNextUntap).toBe(true);

    const theirTurn = passUntilTurn({ state: cast, events: [] }, 3);
    expect(tappedNamed(theirTurn.state, 'Ice Nightflit')).toBe(true);
    expect(theirTurn.state.objects[held]?.skipsNextUntap).toBeUndefined();
    expect(theirTurn.events.filter((event) => event.type === 'untapSkipped')).toHaveLength(1);

    const theirNextTurn = passUntilTurn(theirTurn, 5);
    expect(tappedNamed(theirNextTurn.state, 'Ice Nightflit')).toBe(false);
  });

  /**
   * The control, and the reason the rider is worth a schema field at all: the
   * same spell without it gives the creature back on the very next untap step,
   * which is one blocker for one combat.
   */
  it('is what separates the spell from a bare tap, which the next untap step undoes', () => {
    const gust = instant('Bewildering Gust', [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }], {
      U: 1,
    });
    const start = scenario({
      battlefield: [...islands(2, 0), { card: creature('Ice Nightflit', 2, 2), controller: 1 }],
      hands: [[gust], []],
    });
    const held = oidOf(start.state, 'Ice Nightflit');
    const cast = castAndResolve(start.state, [{ kind: 'permanent', oid: held }]);
    expect(cast.objects[held]?.tapped).toBe(true);

    // The field is absent rather than false. Every object written before the
    // kernel learned this word canonicalizes byte-identically after it, which
    // is what keeps `stateFingerprint`, replay and every stored position from
    // moving; a `false` here would have moved all three.
    expect('skipsNextUntap' in (cast.objects[held] ?? {})).toBe(false);

    const theirTurn = passUntilTurn({ state: cast, events: [] }, 3);
    expect(tappedNamed(theirTurn.state, 'Ice Nightflit')).toBe(false);
    expect(theirTurn.events.filter((event) => event.type === 'untapSkipped')).toHaveLength(0);
  });

  /**
   * Sleep's arm. Two things separate it from the single-target one: the sweep
   * reaches a creature no spell could have named (CR 115.1, the player is the
   * target), and it reaches one that was *already* tapped. A defender who taps
   * out in response does not get that creature back a turn early.
   */
  it('holds a creature the sweep found already tapped', () => {
    const sleep = sorcery('Sleep of the Thornwood Tree', [heldTap('sweep')], { generic: 2, U: 2 });
    const start = scenario({
      battlefield: [
        ...islands(4, 0),
        { card: creature('Standing Guard', 2, 2), controller: 1 },
        { card: creature('Spent Guard', 2, 2), controller: 1, tapped: true },
      ],
      hands: [[sleep], []],
    });
    const cast = castAndResolve(start.state, [AT_OPPONENT]);
    expect(tappedNamed(cast, 'Standing Guard')).toBe(true);
    expect(tappedNamed(cast, 'Spent Guard')).toBe(true);

    const theirTurn = passUntilTurn({ state: cast, events: [] }, 3);
    expect(tappedNamed(theirTurn.state, 'Standing Guard')).toBe(true);
    expect(tappedNamed(theirTurn.state, 'Spent Guard')).toBe(true);
    expect(theirTurn.events.filter((event) => event.type === 'untapSkipped')).toHaveLength(2);

    const theirNextTurn = passUntilTurn(theirTurn, 5);
    expect(tappedNamed(theirNextTurn.state, 'Standing Guard')).toBe(false);
    expect(tappedNamed(theirNextTurn.state, 'Spent Guard')).toBe(false);
  });

  /**
   * CR 400.7: the permanent that comes back is a new object and owes nothing.
   * Bouncing your own creature out from under a Sleep is a real line, and the
   * debt following it back would be the kernel remembering a permanent that
   * stopped existing.
   */
  it('is cleared by a zone change, like every other battlefield status', () => {
    const rune = instant('Stasis Rune', [heldTap('one')], { U: 1 });
    const bounce = instant('Aelune’s Wind', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
      U: 1,
    });
    const start = scenario({
      battlefield: [...islands(4, 0), { card: creature('Ice Nightflit', 2, 2), controller: 1 }],
      hands: [[rune, bounce], []],
    });
    const held = oidOf(start.state, 'Ice Nightflit');
    const tapped = castAndResolve(start.state, [{ kind: 'permanent', oid: held }]);
    expect(tapped.objects[held]?.skipsNextUntap).toBe(true);

    const bounced = castAndResolve(tapped, [{ kind: 'permanent', oid: held }]);
    expect(bounced.objects[held]?.zone).toBe('hand');
    expect('skipsNextUntap' in (bounced.objects[held] ?? {})).toBe(false);
  });
});
