/**
 * Whether the kernel's own bot acts at all when the only target is its own.
 *
 * `agent-target-sign.test.ts` is the other half of the same reported game and
 * asks which of two creatures the bot points a spell at. This file asks the
 * question that comes first: with nothing across the table worth pointing at,
 * does it point the spell at its own board anyway?
 *
 * It did. `castValue` prices the act of casting at 40 plus the card's mana
 * cost, `effectTargetBonus` charges a flat -8 for aiming a harmful effect at a
 * permanent the caster controls, and `passPriority` scores zero — so a three-
 * mana removal spell scored 35 against doing nothing's 0 and the bot exiled its
 * own creature. Aiming was a comparison between targets and was fixed as one;
 * the decision to act was never a comparison at all.
 *
 * Both arms that can decline are here, because the arithmetic that was wrong is
 * shared: an activated ability scored a flat 20 for the act and the same -8 for
 * the aim, so a pinger facing an empty board shot one of its own creatures for
 * exactly the same reason.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Effect } from '@mtg/dsl';
import type { Action, Decision, GameState, ObjectId } from '@mtg/kernel';
import { pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import { artifact, creature, FOREST, instant, lands } from './cards';
import { oidOf } from './helpers';

const MINE = 'Pasture Goat';
const THEIRS = 'Brigand Scout';
const PINGER = 'Guardian Beacon';

/** "Exile target creature." — one clause, one target, harmful. */
const EXILE: readonly Effect[] = [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }];

/** `{T}: Guardian Beacon deals 2 damage to target creature.` */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
};

interface Board {
  readonly state: GameState;
  readonly decision: Decision;
  readonly mine: ObjectId;
}

/**
 * The bot's board, with `opposed` deciding whether there is anything across the
 * table to point at.
 *
 * Everything else is identical either way, so the only thing separating the two
 * runs is the existence of a target worth having. The removal spell's cost is
 * generic so four Forests can pay it: a spell the bot cannot afford is never
 * offered, and a test built on an unaffordable card would pass whatever this
 * agent decided.
 *
 * `hand` empties it because a bad activation is only the *best* option once
 * there is no spell to outrank it. With the removal spell in hand the old
 * arithmetic scored the cast at 35 and the activation at 12, so a run that left
 * the card there passed on the cast's score and said nothing about the
 * activation at all.
 */
function board(opposed: boolean, hand: 'removal' | 'empty' = 'removal'): Board {
  const start = scenario({
    battlefield: [
      { card: creature(MINE, 1, 3), controller: 0 },
      { card: artifact(PINGER, { generic: 2 }, [PING]), controller: 0 },
      ...(opposed ? [{ card: creature(THEIRS, 1, 3), controller: 1 as const }] : []),
      ...lands(FOREST, 4).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [hand === 'removal' ? [instant('Sealed Away', EXILE, { generic: 3 })] : [], []],
  });
  const decision = pendingDecision(start.state);
  if (decision === null || decision.kind !== 'priority') throw new Error('the bot was not offered priority');
  return { state: start.state, decision, mine: oidOf(start.state, MINE) };
}

function decide(where: Board): Action {
  return simpleAgent('bot').decide({ state: where.state, player: 0, decision: where.decision });
}

/** The permanents this decision offers as the first target of `type`. */
function offeredAt(where: Board, type: 'castSpell' | 'activateAbility'): readonly ObjectId[] {
  const targets: ObjectId[] = [];
  for (const option of where.decision.options) {
    if (option.type !== type) continue;
    const first = option.targets[0];
    if (first?.kind === 'permanent') targets.push(first.oid);
  }
  return targets;
}

describe('the kernel bot holds a spell it can only point at itself', () => {
  it('is offered the bad cast, so declining it is a choice and not an absence', () => {
    const where = board(false);
    expect(offeredAt(where, 'castSpell')).toStrictEqual([where.mine]);
  });

  it('passes priority rather than exiling its own creature', () => {
    expect(decide(board(false)).type).toBe('passPriority');
  });

  it('still casts the same spell once there is something to aim it at', () => {
    expect(decide(board(true)).type).toBe('castSpell');
  });
});

describe('the kernel bot holds an activation it can only point at itself', () => {
  it('is offered the bad activation, so declining it is a choice and not an absence', () => {
    const where = board(false, 'empty');
    expect(offeredAt(where, 'activateAbility')).toStrictEqual([where.mine]);
  });

  it('passes priority rather than shooting its own creature', () => {
    expect(decide(board(false, 'empty')).type).toBe('passPriority');
  });

  it('still activates once there is something to aim it at', () => {
    expect(decide(board(true, 'empty')).type).toBe('activateAbility');
  });
});
