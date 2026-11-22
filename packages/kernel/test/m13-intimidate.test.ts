/** CR 702.13 Intimidate through direct, enumerated, and submitted block legality. */
import {
  beginTrace,
  canBlock,
  eligibleAttackers,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { abilities, controlledBy, copies, onlyObject, recolor, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

const INTIMIDATE = { kind: 'intimidate' as const };
const BOAR = creature('Bladetusk Boar', 3, 2, {
  cost: { generic: 3, R: 1 },
  subtypes: ['Boar'],
  keywordAbilities: [INTIMIDATE] as never,
});
const RED = creature('Red Blocker', 2, 2, { cost: { R: 1 } });
const BLUE = creature('Blue Blocker', 2, 2, { cost: { U: 1 } });
const WHITE = creature('White Blocker', 2, 2, { cost: { W: 1 } });
const ARTIFACT = creature('Artifact Blocker', 2, 2, { artifact: true });

function board(blockers = [RED, BLUE, ARTIFACT]): GameState {
  return scenario({
    battlefield: [
      { card: BOAR, controller: 0 },
      ...blockers.map((card) => ({ card, controller: 1 as const })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  }).state;
}

function toBlockers(state: GameState): GameState {
  const attacker = state.battlefield.find((oid) => state.objects[oid]?.controller === 0);
  if (attacker === undefined) throw new Error('missing attacker');
  let current = reduce(state, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: attacker, defender: 1 }],
  }).state;
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current);
    if (decision?.kind === 'declareBlockers') return current;
    if (decision?.kind !== 'priority') throw new Error(`unexpected decision ${String(decision?.kind)}`);
    current = reduce(current, { type: 'passPriority', player: decision.player }).state;
  }
  throw new Error('did not reach blockers');
}

function block(blocker: ObjectId, attacker: ObjectId): Action {
  return { type: 'declareBlockers', player: 1, blocks: [{ blocker, attacker }] };
}

describe('Intimidate block admission', () => {
  it('admits a shared current color or artifact creature and refuses a different color', () => {
    const state = board();
    const boar = oidOf(state, 'Bladetusk Boar');

    expect(canBlock(state, oidOf(state, 'Red Blocker'), boar)).toBe(true);
    expect(canBlock(state, oidOf(state, 'Blue Blocker'), boar)).toBe(false);
    expect(canBlock(state, oidOf(state, 'Artifact Blocker'), boar)).toBe(true);
  });

  it('uses current colors for colorless and multicolor attackers', () => {
    const state = board([RED, BLUE, WHITE, ARTIFACT]);
    const boar = oidOf(state, 'Bladetusk Boar');
    const red = oidOf(state, 'Red Blocker');
    const blue = oidOf(state, 'Blue Blocker');
    const white = oidOf(state, 'White Blocker');
    const artifact = oidOf(state, 'Artifact Blocker');

    const colorless = withContinuous(state, [recolor(onlyObject(boar), [])]);
    expect(canBlock(colorless, red, boar)).toBe(false);
    expect(canBlock(colorless, artifact, boar)).toBe(true);

    const multicolor = withContinuous(state, [recolor(onlyObject(boar), ['R', 'U'])]);
    expect(canBlock(multicolor, red, boar)).toBe(true);
    expect(canBlock(multicolor, blue, boar)).toBe(true);
    expect(canBlock(multicolor, white, boar)).toBe(false);

    const changedBlocker = withContinuous(state, [recolor(onlyObject(blue), ['R'])]);
    expect(canBlock(changedBlocker, blue, boar)).toBe(true);
  });

  it('follows copied abilities and current ability loss', () => {
    const plain = creature('Plain Raider', 3, 2, { cost: { generic: 2, R: 1 } });
    const state = scenario({
      battlefield: [
        { card: BOAR, controller: 0 },
        { card: plain, controller: 0 },
        { card: BLUE, controller: 1 },
      ],
      active: 0,
      turn: 6,
    }).state;
    const boar = oidOf(state, 'Bladetusk Boar');
    const raider = oidOf(state, 'Plain Raider');
    const blue = oidOf(state, 'Blue Blocker');
    const copied = withContinuous(state, [copies(onlyObject(raider), boar, { ts: 1 })]);
    const granted = withContinuous(state, [
      abilities(onlyObject(raider), { addKeywordAbilities: [INTIMIDATE] }, { ts: 1 }),
    ]);
    const removed = withContinuous(granted, [abilities(onlyObject(raider), { removeAll: true }, { ts: 2 })]);

    expect(canBlock(state, blue, raider)).toBe(true);
    expect(canBlock(copied, blue, raider)).toBe(false);
    expect(canBlock(granted, blue, raider)).toBe(false);
    expect(canBlock(removed, blue, raider)).toBe(true);
  });

  it('drops a source-bound grant when its source departs and follows current control', () => {
    const source = creature('Intimidate Source', 1, 1);
    const plain = creature('Controlled Raider', 3, 2, { cost: { generic: 2, R: 1 } });
    const state = scenario({
      battlefield: [
        { card: source, controller: 0 },
        { card: plain, controller: 0 },
        { card: BLUE, controller: 1 },
      ],
      active: 0,
      turn: 6,
      step: 'declareAttackers',
    }).state;
    const sourceOid = oidOf(state, 'Intimidate Source');
    const raider = oidOf(state, 'Controlled Raider');
    const blue = oidOf(state, 'Blue Blocker');
    const granted = withContinuous(state, [
      abilities(
        onlyObject(raider),
        { addKeywordAbilities: [INTIMIDATE] },
        {
          source: sourceOid,
          duration: 'whileSourceAndSubjectRemain',
          ts: 1,
        },
      ),
    ]);
    const departed = moveObject(beginTrace(granted), sourceOid, 'graveyard').state;
    const changedControl = withContinuous(granted, [controlledBy(onlyObject(raider), 1, { ts: 2 })]);

    expect(canBlock(granted, blue, raider)).toBe(false);
    expect(canBlock(departed, blue, raider)).toBe(true);
    expect(eligibleAttackers(granted)).toContain(raider);
    expect(eligibleAttackers(changedControl)).not.toContain(raider);
  });

  it('removes illegal pairings from enumeration and rejects constructed submissions', () => {
    const state = toBlockers(board());
    const decision = pendingDecision(state);
    if (decision?.kind !== 'declareBlockers') throw new Error('missing blocker decision');
    const boar = oidOf(state, 'Bladetusk Boar');
    const red = oidOf(state, 'Red Blocker');
    const blue = oidOf(state, 'Blue Blocker');
    const artifact = oidOf(state, 'Artifact Blocker');
    const candidates = new Map(
      decision.candidates.map((candidate) => [candidate.blocker, candidate.attackers]),
    );

    expect(candidates.get(red)).toContain(boar);
    expect(candidates.get(artifact)).toContain(boar);
    expect(candidates.get(blue) ?? []).not.toContain(boar);
    expect(validateAction(state, block(red, boar))).toBeNull();
    expect(validateAction(state, block(artifact, boar))).toBeNull();
    expect(validateAction(state, block(blue, boar))).toMatch(/cannot block/iu);
    expect(decision.options).toHaveLength(4);
    expect(
      decision.options.every(
        (option) =>
          option.type !== 'declareBlockers' || option.blocks.every((entry) => entry.blocker !== blue),
      ),
    ).toBe(true);
  });
});
