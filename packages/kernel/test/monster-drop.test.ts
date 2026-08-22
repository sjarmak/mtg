/**
 * the flagship set's loop, in one test.
 *
 * the set design document writes it as three sentences: "Silver
 * Direhorn dies and leaves a Trophy Horn. The horn's counter grants first strike
 * and a stat bonus. The upgraded creature kills King Wyrmhead." The first
 * sentence needed triggered abilities (`mtg-bc2.132.2`); the third needed
 * activated abilities, a sacrifice cost, and a counter kind that declares what
 * carrying it means, and `packages/kernel/test/fuse.test.ts` plays that half
 * off a printed artifact card.
 *
 * The sentence between them is this file. The horn a Direhorn leaves is a token,
 * and until `mtg-bc2.132.7` a token was a vanilla creature body: `TokenSpec`
 * had no abilities field to print Fuse in and no way to be an artifact rather
 * than a creature. So the drop and the mechanic could not be the same object.
 *
 * Nothing here is a token-shaped special case. The horn's ability is enumerated
 * by `legalActions`, paid for by `reduce` and resolved by `stack.ts` through
 * exactly the code a printed card's ability goes through. One thing differs,
 * and it is CR 111.7 rather than anything about abilities: the sacrificed token
 * reaches the graveyard the cost was paid into and then stops existing, which
 * state-based actions do to it before this test can look (CR 704.5d).
 */
import { describe, expect, it } from 'vitest';
import { renderOracleText, renderTokenOracleText, TokenSpecSchema } from '@mtg/dsl';
import type { Action, GameState, ObjectId } from '@mtg/kernel';
import {
  getObject,
  hasKeyword,
  IllegalActionError,
  legalActions,
  onlyObject,
  playerOf,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  validateAction,
} from '@mtg/kernel';
import { creature, FOREST, instant } from './cards';

/**
 * "A part token is an artifact whose only ability is `Fuse {cost}: Sacrifice
 * this. Put a <part> counter on target creature you control.`" — the design
 * document, quoted in full now that `TARGET_KINDS` has the word for it.
 */
const TROPHY_HORN = TokenSpecSchema.parse({
  name: 'Trophy Horn',
  subtypes: ['Part'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [
        {
          kind: 'putCounters',
          counter: 'horn',
          count: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
  ],
});

const SILVER_DIREHORN = creature('Silver Direhorn', 4, 4, {
  cost: { generic: 3, R: 1 },
  subtypes: ['Direhorn', 'Monster'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'createToken', count: 1, token: TROPHY_HORN }],
    },
  ],
});

const SPROUT = creature('Bramble Sprout', 2, 2, { cost: { generic: 1 } });

/** The other seat's body, so "you control" has something to exclude. */
const GUARDIAN = creature('Rusted Guardian', 3, 3, { cost: { generic: 3 } });

/**
 * The DSL cannot say "destroy target creature an opponent controls", and a
 * death trigger is controlled by the dying permanent's controller (CR 603.2),
 * so the hunter kills the Monster on their own side of the table and takes the
 * drop. Decision 4 of the design document is that both players are hunters and
 * Monsters are a shared resource, which is that arrangement one seat wide.
 */
const ANCIENT_BLADE = instant('Ancient Blade', [
  { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
]);

interface Board {
  readonly state: GameState;
  readonly direhorn: ObjectId;
  readonly sprout: ObjectId;
  readonly guardian: ObjectId;
}

function board(): Board {
  const started = scenario({
    battlefield: [
      { card: SILVER_DIREHORN, controller: 0 },
      { card: SPROUT, controller: 0 },
      { card: GUARDIAN, controller: 1 },
      ...Array.from({ length: 3 }, () => ({ card: FOREST, controller: 0 as const })),
    ],
    hands: [[ANCIENT_BLADE], []],
  });
  const state = started.state;
  const named = (name: string): ObjectId => {
    const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
    if (found === undefined) throw new Error(`no battlefield object named ${name}`);
    return found;
  };
  return {
    state,
    direhorn: named('Silver Direhorn'),
    sprout: named('Bramble Sprout'),
    guardian: named('Rusted Guardian'),
  };
}

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

/** Kills the Monster and lets its death trigger resolve. */
function killTheMonster(state: GameState, direhorn: ObjectId): GameState {
  const blade = playerOf(state, 0).hand[0];
  if (blade === undefined) throw new Error('Ancient Blade is not in hand');
  const cast = reduce(state, {
    type: 'castSpell',
    player: 0,
    oid: blade,
    targets: [{ kind: 'permanent', oid: direhorn }],
  });
  return reduceAll(cast.state, [...PASS, ...PASS]).state;
}

function tokenOid(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find(
    (oid) => state.objects[oid]?.token === true && state.objects[oid]?.card.name === name,
  );
  if (found === undefined) throw new Error(`no token named ${name} on the battlefield`);
  return found;
}

describe('a Monster that drops a part', () => {
  it('leaves an artifact token with no body and one printed ability', () => {
    const { state, direhorn } = board();
    const dropped = killTheMonster(state, direhorn);
    const horn = getObject(dropped, tokenOid(dropped, 'Trophy Horn'));

    expect(horn.card.kind).toBe('artifact');
    expect(horn.card.power).toBeUndefined();
    expect(horn.card.toughness).toBeUndefined();
    expect(horn.card.abilities).toHaveLength(1);
    expect(horn.card.abilities[0]?.kind).toBe('activated');
  });

  it('prints Fuse on the token, and the drop on the Monster', () => {
    const fuse =
      '{1}, Sacrifice Trophy Horn: Put a horn counter on target creature you control. (A creature with a horn counter gets +1/+1 and has first strike.)';
    expect(renderTokenOracleText(TROPHY_HORN)).toBe(fuse);
    // Moved by `mtg-hmb`: the Monster used to quote the whole of Fuse, which
    // put this 141-character ability inside every card that drops a part. The
    // token's card carries it once and the Monster names the token instead, so
    // the Monster's own printed text now fits the 140-character cap.
    expect(renderOracleText(SILVER_DIREHORN)).toBe(
      "When Silver Direhorn dies, create a Trophy Horn token. It's an artifact.",
    );
    expect(renderOracleText(SILVER_DIREHORN).length).toBeLessThanOrEqual(140);
  });

  it("offers the horn's Fuse, spends it, and the creature is permanently better", () => {
    const { state, direhorn, sprout } = board();
    const dropped = killTheMonster(state, direhorn);
    const horn = tokenOid(dropped, 'Trophy Horn');

    expect(powerOf(dropped, sprout)).toBe(2);
    expect(hasKeyword(dropped, sprout, 'firstStrike')).toBe(false);

    // Enumerated by the same walk that offers a printed card's activation:
    // `activationOptions` reads `card.abilities` off every permanent this
    // player controls, and a token is a permanent.
    const activation = legalActions(dropped).find(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === horn &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === sprout),
    );
    if (activation === undefined) throw new Error('the horn offered no Fuse activation');

    // The sacrifice is paid before the ability goes on the stack (CR 601.2h),
    // so the horn is already gone while its own ability waits, and CR 608.2
    // resolves it anyway. Gone means exile: the horn went to its owner's
    // graveyard as the cost, and the state-based action for a token in a zone
    // other than the battlefield (CR 704.5d) ran inside the same reduction.
    const activated = reduce(dropped, activation);
    expect(getObject(activated.state, horn).zone).toBe('exile');
    expect(activated.state.stack).toHaveLength(1);

    const settled = reduceAll(activated.state, PASS).state;
    expect(getObject(settled, sprout).counters.horn).toBe(1);
    expect(powerOf(settled, sprout)).toBe(3);
    expect(toughnessOf(settled, sprout)).toBe(3);
    expect(hasKeyword(settled, sprout, 'firstStrike')).toBe(true);
  });

  /**
   * "Target creature you control" is enforced and not only printed.
   *
   * Both halves are asserted, because they are two different pieces of code and
   * either one alone leaves the other free to disagree with the card. The
   * enumeration is `targetChoicesForEffects`, which draws the slot from the
   * creatures this player controls; `validateAction` is `isTargetStillLegal`,
   * which re-derives the same answer for an agent that built the action itself
   * rather than picking it off the list.
   */
  it('offers the horn no creature the other seat controls, and refuses one submitted', () => {
    const { state, direhorn, guardian } = board();
    const dropped = killTheMonster(state, direhorn);
    const horn = tokenOid(dropped, 'Trophy Horn');

    const offered = legalActions(dropped).filter(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === horn &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === guardian),
    );
    expect(offered).toEqual([]);

    const submitted: Action = {
      type: 'activateAbility',
      player: 0,
      oid: horn,
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: guardian }],
      sacrifices: [],
    };
    expect(validateAction(dropped, submitted)).toBe('illegal target for effect 0');
    expect(() => reduce(dropped, submitted)).toThrow(IllegalActionError);
  });

  /**
   * CR 608.2b, on the one target kind whose legality another player can change.
   *
   * The horn's ability is on the stack with a legal target, the creature
   * changes hands underneath it, and the ability resolves onto nothing. Control
   * is read through the layer system, so the control-change is one continuous
   * record rather than a rewrite of the object, and the recheck sees it for the
   * same reason every other control-sensitive read does.
   */
  it('drops the target if the creature stops being one you control', () => {
    const { state, direhorn, sprout } = board();
    const dropped = killTheMonster(state, direhorn);
    const horn = tokenOid(dropped, 'Trophy Horn');

    const activation = legalActions(dropped).find(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === horn &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === sprout),
    );
    if (activation === undefined) throw new Error('the horn offered no Fuse activation');
    const activated = reduce(dropped, activation);

    const stolen: GameState = {
      ...activated.state,
      continuous: [
        ...activated.state.continuous,
        {
          kind: 'control',
          layer: '2',
          id: 'test-control-change',
          timestamp: activated.state.continuous.length,
          sourceOid: sprout,
          duration: 'permanent',
          affects: onlyObject(sprout),
          controller: 1,
          enabledWhile: null,
        },
      ],
    };

    const settled = reduceAll(stolen, PASS).state;
    expect(getObject(settled, sprout).counters.horn).toBeUndefined();
  });
});
