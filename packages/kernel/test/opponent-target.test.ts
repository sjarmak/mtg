/**
 * CR 115.4, "target opponent", in the kernel.
 *
 * The interesting assertion is negative. Every other player-naming mode offers
 * both seats, so the check that matters is not that a spell can hit the
 * opponent — `targetPlayer` could always do that — but that no move the
 * enumeration produces aims this one at the caster. A punisher whose legal
 * moves still included the caster would be a card the bots could point at
 * themselves, and nothing downstream would notice.
 *
 * The second half is CR 608.2b. The restriction is a relation to whoever put
 * the spell on the stack, not a property of a seat, so the recheck on
 * resolution has to read the same chooser the cast read — the argument
 * `targetCreatureYouControl` already makes one case up in the same switch.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import {
  IllegalActionError,
  legalActions,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  targetChoicesFor,
  validateAction,
} from '@mtg/kernel';
import { SWAMP, sorcery } from './cards';

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

const GLOOM_REPRISAL = sorcery(
  'Gloom Reprisal',
  [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetOpponent' } }],
  { generic: 1, B: 1 },
);

function swamps(count: number, controller: 0 | 1): { card: typeof SWAMP; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller }));
}

function opening(): GameState {
  return scenario({ battlefield: swamps(2, 0), hands: [[GLOOM_REPRISAL], []] }).state;
}

describe('target opponent', () => {
  it('draws a space with one member, and the caster is not in it', () => {
    const slots = targetChoicesFor(opening(), GLOOM_REPRISAL, 0);
    expect(slots).toEqual([[{ kind: 'player', player: 1 }]]);
  });

  /**
   * The same sentence one layer out, where a bot actually reads it: the whole
   * move list holds one cast of this card and it names the other seat. A
   * `targetPlayer` spell in the same position offers two.
   */
  it('produces exactly one cast, aimed away from the caster', () => {
    const start = opening();
    const oid = playerOf(start, 0).hand[0] ?? '';
    // `canPay` reads the pool rather than what the board could produce, so the
    // move list holds no cast until the mana is actually floating.
    const paid = reduceAll(
      start,
      start.battlefield.map((land): Action => ({
        type: 'activateManaAbility',
        player: 0,
        oid: land,
        color: 'B',
      })),
    ).state;
    const casts = legalActions(paid).filter((action) => action.type === 'castSpell' && action.oid === oid);
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({ targets: [{ kind: 'player', player: 1 }] });
  });

  it('resolves onto the opponent and leaves the caster untouched', () => {
    const start = opening();
    const oid = playerOf(start, 0).hand[0] ?? '';
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    const after = reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;

    expect(playerOf(after, 1).life).toBe(17);
    expect(playerOf(after, 0).life).toBe(20);
  });

  /**
   * CR 608.2b rechecks a chosen target against the restriction it was chosen
   * under. A tuple naming seat 0 is illegal when seat 0 asked and legal when
   * seat 1 did, which is the entire content of "opponent" and would read as
   * "always legal" if the recheck looked at the board instead of the chooser.
   */
  it('rechecks against the player who chose, not against the board', () => {
    const start = opening();
    const oid = playerOf(start, 0).hand[0] ?? '';
    const atSelf: Action = { type: 'castSpell', player: 0, oid, targets: [{ kind: 'player', player: 0 }] };
    expect(validateAction(start, atSelf)).toBe('illegal target for effect 0');
    expect(() => reduce(start, atSelf)).toThrow(IllegalActionError);

    const atThem: Action = { type: 'castSpell', player: 0, oid, targets: [{ kind: 'player', player: 1 }] };
    expect(validateAction(start, atThem)).toBeNull();
  });
});
