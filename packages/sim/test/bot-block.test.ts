/**
 * Block-policy unit tests on constructed board states.
 *
 * The attack is declared through the real reducer, so the block decision the
 * policy sees is the one the kernel would actually ask for, and the resulting
 * declaration is checked against `validateAction` — a block the kernel would
 * reject is a failing test, not a silently dropped assignment. That check is
 * the whole of the `mustBeBlockedIfAble` suite at the bottom: every one of the
 * declarations it asserts on used to be refused outright, because a policy that
 * prices what the defender would *choose* has nothing to say about a
 * requirement the attacker's controller imposes.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { pendingDecision, reduce, scenario, validateAction } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, chooseBlocks } from '@mtg/sim';
import { creature, creatureWithStatic } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

interface Position {
  readonly state: GameState;
  readonly byName: ReadonlyMap<string, ObjectId>;
}

/** Builds a board, declares an attack with every creature the attacker owns. */
function attackingPosition(
  attacker: PlayerId,
  attackers: readonly { card: ReturnType<typeof creature>; tapped?: boolean }[],
  defenders: readonly { card: ReturnType<typeof creature>; tapped?: boolean }[],
  life: readonly [number, number] = [20, 20],
): Position {
  const defender: PlayerId = attacker === 0 ? 1 : 0;
  const built = scenario({
    active: attacker,
    step: 'declareAttackers',
    life,
    battlefield: [
      ...attackers.map((entry) => ({
        card: entry.card,
        controller: attacker,
        tapped: entry.tapped ?? false,
      })),
      ...defenders.map((entry) => ({
        card: entry.card,
        controller: defender,
        tapped: entry.tapped ?? false,
      })),
    ],
  });
  const byName = new Map<string, ObjectId>();
  for (const [oid, object] of Object.entries(built.state.objects)) {
    if (object.zone === 'battlefield') byName.set(object.card.name, oid);
  }
  const declaration: Action = {
    type: 'declareAttackers',
    player: attacker,
    attackers: attackers.map((entry) => ({
      oid: byName.get(entry.card.name) ?? '',
      defender,
    })),
  };
  let state = reduce(built.state, declaration).state;
  // Both players get priority in the declare-attackers step before blockers are
  // declared; pass through it so the pending decision is the block itself.
  for (let guard = 0; guard < 16; guard += 1) {
    const decision = pendingDecision(state, 1);
    if (decision === null || decision.kind !== 'priority') break;
    state = reduce(state, { type: 'passPriority', player: decision.player }).state;
  }
  return { state, byName };
}

function blocksFor(position: Position, me: PlayerId): readonly { blocker: string; attacker: string }[] {
  const decision = pendingDecision(position.state, 1);
  if (decision === null || decision.kind !== 'declareBlockers') {
    throw new Error(`expected a block decision, got ${decision?.kind ?? 'none'}`);
  }
  const blocks = chooseBlocks(position.state, me, decision.attackers, decision.eligible, config);
  const reason = validateAction(position.state, { type: 'declareBlockers', player: me, blocks });
  expect(reason).toBeNull();
  const nameOf = (oid: ObjectId): string => position.state.objects[oid]?.card.name ?? '?';
  return blocks.map((block) => ({ blocker: nameOf(block.blocker), attacker: nameOf(block.attacker) }));
}

describe('block policy', () => {
  it('takes a block that kills the attacker and survives', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Raider', 2, 2) }],
      [{ card: creature('Guard', 3, 3) }],
    );
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Guard', attacker: 'Raider' }]);
  });

  it('trades up: loses a small body to kill a bigger one', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Behemoth', 5, 2) }],
      [{ card: creature('Skirmisher', 2, 2) }],
    );
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Skirmisher', attacker: 'Behemoth' }]);
  });

  it('declines a block that throws a creature away for nothing', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Colossus', 6, 6) }],
      [{ card: creature('Whelp', 1, 1) }],
    );
    expect(blocksFor(position, 0)).toEqual([]);
  });

  it('chump blocks when the damage coming through is lethal', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Colossus', 6, 6) }],
      [{ card: creature('Whelp', 1, 1) }],
      [4, 20],
    );
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Whelp', attacker: 'Colossus' }]);
  });

  it('does not chump a trampler that kills us anyway', () => {
    // 6 trample over a 1/1 still puts 5 through, and we are at 4.
    const position = attackingPosition(
      1,
      [{ card: creature('Stampeder', 6, 6, ['trample']) }],
      [{ card: creature('Whelp', 1, 1) }],
      [4, 20],
    );
    expect(blocksFor(position, 0)).toEqual([]);
  });

  it('needs two bodies for a menace attacker and will not offer one', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Stalker', 3, 3, ['menace']) }],
      [{ card: creature('Guard', 4, 4) }],
    );
    expect(blocksFor(position, 0)).toEqual([]);
  });

  it('double blocks a menace attacker when the pair is worth it', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Stalker', 3, 3, ['menace']) }],
      [{ card: creature('Guard A', 4, 4) }, { card: creature('Guard B', 4, 4) }],
    );
    expect(blocksFor(position, 0)).toHaveLength(2);
  });

  it('cannot block a flyer with a grounded creature', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Drake', 3, 3, ['flying']) }],
      [{ card: creature('Footman', 4, 4) }],
    );
    expect(blocksFor(position, 0)).toEqual([]);
  });

  it('blocks a flyer with reach', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Drake', 3, 3, ['flying']) }],
      [{ card: creature('Spider', 4, 4, ['reach']) }],
    );
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Spider', attacker: 'Drake' }]);
  });

  it('blocks a lure it would otherwise decline (CR 509.1c)', () => {
    // The same board as "throws a creature away for nothing" above, one printed
    // line different: the 1/1 has to get in front of the 6/6 now.
    const position = attackingPosition(
      1,
      [{ card: creatureWithStatic('Lure Colossus', 6, 6, { kind: 'mustBeBlockedIfAble' }) }],
      [{ card: creature('Whelp', 1, 1) }],
    );
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Whelp', attacker: 'Lure Colossus' }]);
  });

  it('gives up a profitable block when the lure needs that creature', () => {
    const position = attackingPosition(
      1,
      [
        { card: creatureWithStatic('Lure Colossus', 6, 6, { kind: 'mustBeBlockedIfAble' }) },
        { card: creature('Raider', 2, 2) },
      ],
      [{ card: creature('Guard', 3, 3) }],
    );
    // Guard eats Raider for free and would rather do that; the requirement is
    // not its to weigh, and the only creature able to serve it is Guard.
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Guard', attacker: 'Lure Colossus' }]);
  });

  it('covers two lures the one way the evasion split allows', () => {
    const position = attackingPosition(
      1,
      [
        { card: creatureWithStatic('Ground Magnet', 6, 6, { kind: 'mustBeBlockedIfAble' }) },
        { card: creatureWithStatic('Sky Magnet', 3, 3, { kind: 'mustBeBlockedIfAble' }, ['flying']) },
      ],
      [{ card: creature('Footman', 4, 4) }, { card: creature('Spider', 2, 2, ['reach']) }],
    );
    // Spider is the only blocker that can reach Sky Magnet, so spending it on
    // the ground lure would leave the other uncovered — legal pair by pair, and
    // refused as a whole declaration.
    expect(blocksFor(position, 0)).toEqual([
      { blocker: 'Footman', attacker: 'Ground Magnet' },
      { blocker: 'Spider', attacker: 'Sky Magnet' },
    ]);
  });

  it('spends its blockers on the biggest threats first', () => {
    const position = attackingPosition(
      1,
      [{ card: creature('Small', 1, 1) }, { card: creature('Large', 4, 4) }],
      [{ card: creature('Guard', 5, 5) }],
    );
    expect(blocksFor(position, 0)).toEqual([{ blocker: 'Guard', attacker: 'Large' }]);
  });
});
