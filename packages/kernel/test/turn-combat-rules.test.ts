/**
 * The two turn-scoped CR 508/509 combat rules: `cantBeBlockedThisTurn` and
 * `attacksYouThisTurnIfAble`.
 *
 * `combat-rule-modifiers.test.ts` covers the six permanent ones, which are
 * printed statics `hasCombatModification` re-reads off the battlefield. These
 * two are resolved effects instead, so the claims worth a standing test are
 * different in three places and this file is organized around those three:
 *
 *  1. **A resolved effect writes a record.** The rule lives in
 *     `state.turnCombatRules` (`state.ts` argues why it is a third parallel
 *     array rather than a `ContinuousEffect` or a duration on the static), so
 *     an activation that resolves has to leave one there and the combat doors
 *     have to read it. Both doors are checked, the enumeration and the
 *     submission gate, for `combat-rule-modifiers.test.ts`'s reason: a caller
 *     that never consulted the offer is still held to the rule.
 *  2. **It ends.** A printed static cannot expire; these do, twice over — at
 *     cleanup (CR 514.2) and when the creature they name leaves the
 *     battlefield. The second is not housekeeping: this kernel reuses an
 *     object's id across a zone change, so a rule left behind comes back with
 *     the card.
 *  3. **A requirement loses to a restriction (CR 508.1).** A creature that must
 *     attack and also cannot attack does not attack, and the declaration that
 *     leaves it home is legal rather than refused. That is implemented by the
 *     requirement never seeing the creature — `eligibleAttackers` has already
 *     dropped it — so the test is what proves the two rules are actually
 *     composed and not merely both present.
 *
 * The lure is the one that needs a second seat to act, because a creature is
 * lured by the player it is about to attack: every lure here is activated by
 * player 1 during player 0's turn, which is when Alluring Siren is activated at
 * a real table too.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  canBlock,
  legalActions,
  moveObject,
  pendingDecision,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { apply, oidOf, playCombat } from './helpers';

/** `{T}: Target creature with power 2 or less can't be blocked this turn.` */
const TUNNEL: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [
    {
      kind: 'cantBeBlockedThisTurn',
      target: { kind: 'targetCreature', restriction: { kind: 'maxPower', power: 2 } },
    },
  ],
};

/** `{T}: Target creature an opponent controls attacks you this turn if able.` */
const LURE: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'attacksYouThisTurnIfAble', target: { kind: 'targetCreatureYouDontControl' } }],
};

const TUNNELER = creature('Test Tunneler', 1, 1, { abilities: [TUNNEL] });
const CALLER = creature('Test Caller', 1, 1, { abilities: [LURE] });
const BEAR = creature('Runeclaw Bear', 2, 2);
const OGRE = creature('Test Ogre', 3, 3);

/**
 * The lured creature that also cannot attack, for the CR 508.1 interaction.
 * Printed on the creature rather than granted by an Aura because the door under
 * test (`eligibleAttackers`) reads `hasCombatModification`, which does not care
 * which battlefield source printed the line.
 */
const PACIFIED = creature('Test Pacified Ogre', 3, 3, {
  abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantAttack' } }],
});

function sentry(): Card {
  return planeswalker('Test Sentry', 4, [
    {
      kind: 'activated',
      loyaltyCost: 1,
      cost: { mana: {} },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ]);
}

/** Passes priority, whoever holds it, until the given step is reached. */
function advanceTo(current: ReduceResult, step: GameState['turn']['step']): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 30; guard += 1) {
    if (walked.state.turn.step === step) return walked;
    const decision = pendingDecision(walked.state);
    if (decision === null || decision.kind !== 'priority') {
      throw new Error(`advanceTo: stopped on ${String(decision?.kind ?? 'nothing')} before ${step}`);
    }
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error(`advanceTo: never reached ${step}`);
}

/**
 * Hands priority to `player`, activates the named source's first ability at
 * `target`, and passes until the stack is empty again.
 *
 * The passing is what makes this a real activation rather than a state edit:
 * the ability goes on the stack, both seats get priority on it, and the effect
 * runs through `resolveStackEntry` exactly as it would in a played game.
 */
function activateAt(
  current: ReduceResult,
  player: 0 | 1,
  sourceName: string,
  target: ObjectId,
): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 4; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision === null || decision.kind !== 'priority') throw new Error('activateAt: nobody has priority');
    if (decision.player === player) break;
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  walked = apply(walked, {
    type: 'activateAbility',
    player,
    oid: oidOf(walked.state, sourceName),
    abilityIndex: 0,
    targets: [{ kind: 'permanent', oid: target }],
    sacrifices: [],
  });
  for (let guard = 0; guard < 8; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    const decision = pendingDecision(walked.state);
    if (decision === null || decision.kind !== 'priority') throw new Error('activateAt: the stack stalled');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('activateAt: the stack did not empty');
}

function attackTargets(state: GameState, oid: ObjectId): readonly string[] {
  const seen = new Set<string>();
  for (const option of legalActions(state)) {
    if (option.type !== 'declareAttackers') continue;
    const declaration = option.attackers.find((entry) => entry.oid === oid);
    seen.add(declaration === undefined ? 'home' : JSON.stringify(declaration.defender));
  }
  return [...seen].sort();
}

function swing(oid: ObjectId): Action {
  return { type: 'declareAttackers', player: 0, attackers: [{ oid, defender: 1 }] };
}

describe('cantBeBlockedThisTurn: a resolved effect, not a printed static', () => {
  it('shuts every blocker out of the creature it named and lets the damage through', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: OGRE, controller: 1 },
      ],
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const ogre = oidOf(start.state, 'Test Ogre');
    expect(canBlock(start.state, ogre, bear)).toBe(true);

    const tunneled = activateAt(start, 0, 'Test Tunneler', bear);
    expect(tunneled.state.turnCombatRules).toEqual([
      { rule: 'cantBeBlockedThisTurn', sourceOid: oidOf(tunneled.state, 'Test Tunneler'), subject: bear },
    ]);
    expect(canBlock(tunneled.state, ogre, bear)).toBe(false);

    // Still a blocker, just not against this attacker: the rule is on the
    // creature being blocked, so the ogre keeps every other block it had.
    const combat = advanceTo(tunneled, 'declareAttackers');
    const swinging = advanceTo(apply(combat, swing(bear)), 'declareBlockers');
    const declarations = legalActions(swinging.state).filter((option) => option.type === 'declareBlockers');
    expect(declarations).not.toHaveLength(0);
    expect(declarations.every((option) => option.blocks.length === 0)).toBe(true);

    const done = playCombat(combat, { attackers: [bear], blocks: [] });
    expect(done.state.players[1].life).toBe(18);
  });

  it('refuses the block at the submission gate, not only in the offer', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: OGRE, controller: 1 },
      ],
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const ogre = oidOf(start.state, 'Test Ogre');
    const tunneled = activateAt(start, 0, 'Test Tunneler', bear);
    const combat = advanceTo(tunneled, 'declareAttackers');
    const blocking = apply(combat, swing(bear));
    const declaring = advanceTo(blocking, 'declareBlockers');
    expect(
      validateAction(declaring.state, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker: ogre, attacker: bear }],
      }),
    ).not.toBeNull();
  });

  it('is not offered a creature the restriction excludes', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: OGRE, controller: 0 },
      ],
    });
    const ogre = oidOf(start.state, 'Test Ogre');
    // The tunneler is a 1/1 and is a legal target for its own ability, so what
    // the restriction has to remove is the ogre specifically rather than every
    // permanent target.
    const offered = legalActions(start.state).filter((option) => option.type === 'activateAbility');
    expect(offered).not.toHaveLength(0);
    expect(
      offered.some((option) => {
        const target = option.targets[0];
        return target !== null && target !== undefined && target.kind === 'permanent' && target.oid === ogre;
      }),
    ).toBe(false);
    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: oidOf(start.state, 'Test Tunneler'),
        abilityIndex: 0,
        targets: [{ kind: 'permanent', oid: ogre }],
        sacrifices: [],
      }),
    ).not.toBeNull();
  });
});

describe('attacksYouThisTurnIfAble: the requirement and the player it names', () => {
  it('takes the hold-back option away from the creature it lured', () => {
    const start = scenario({
      battlefield: [
        { card: OGRE, controller: 0 },
        { card: CALLER, controller: 1 },
      ],
      step: 'beginCombat',
    });
    const ogre = oidOf(start.state, 'Test Ogre');
    // The same board without the lure, walked to the same step: two answers for
    // the ogre, and one of them is to stay home. That is what the lure removes.
    expect(attackTargets(advanceTo(start, 'declareAttackers').state, ogre)).toEqual(['1', 'home']);

    const lured = activateAt(start, 1, 'Test Caller', ogre);
    expect(lured.state.turnCombatRules).toEqual([
      {
        rule: 'attacksYouThisTurnIfAble',
        sourceOid: oidOf(lured.state, 'Test Caller'),
        subject: ogre,
        defender: 1,
      },
    ]);
    const combat = advanceTo(lured, 'declareAttackers');
    expect(attackTargets(combat.state, ogre)).toEqual(['1']);
    expect(validateAction(combat.state, { type: 'declareAttackers', player: 0, attackers: [] })).toBe(
      `${ogre} attacks that player this turn if able and must attack`,
    );
  });

  it('names the player, so a planeswalker that player controls does not satisfy it', () => {
    const start = scenario({
      battlefield: [
        { card: OGRE, controller: 0 },
        { card: CALLER, controller: 1 },
        { card: sentry(), controller: 1 },
      ],
      step: 'beginCombat',
    });
    const ogre = oidOf(start.state, 'Test Ogre');
    const walker = oidOf(start.state, 'Test Sentry');
    const lured = activateAt(start, 1, 'Test Caller', ogre);
    const combat = advanceTo(lured, 'declareAttackers');
    // Without the lure this board offers three answers for the ogre: the
    // player, the planeswalker, or nothing. The lure leaves exactly one.
    expect(attackTargets(combat.state, ogre)).toEqual(['1']);
    expect(
      validateAction(combat.state, {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: ogre, defender: { kind: 'planeswalker', oid: walker } }],
      }),
    ).toBe(`${ogre} must attack the player whose ability compelled it`);
    expect(validateAction(combat.state, swing(ogre))).toBeNull();
  });

  it('does not compel a creature that cannot attack (CR 508.1: a restriction beats a requirement)', () => {
    const start = scenario({
      battlefield: [
        { card: PACIFIED, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: CALLER, controller: 1 },
      ],
      step: 'beginCombat',
    });
    const pacified = oidOf(start.state, 'Test Pacified Ogre');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const lured = activateAt(start, 1, 'Test Caller', pacified);
    // The record is written: the effect resolved and CR 508.1a's "ignore an
    // unobeyable requirement" is decided at the declaration, not at resolution.
    expect(lured.state.turnCombatRules).toHaveLength(1);

    const combat = advanceTo(lured, 'declareAttackers');
    // Nothing is compelled, and the bear beside it is still free either way,
    // so an empty declaration is a legal answer rather than a refused one.
    expect(validateAction(combat.state, { type: 'declareAttackers', player: 0, attackers: [] })).toBeNull();
    expect(attackTargets(combat.state, bear)).toEqual(['1', 'home']);
    expect(validateAction(combat.state, swing(pacified))).toBe(`${pacified} cannot attack`);
  });
});

describe('both rules end', () => {
  it('is gone at cleanup, so the next turn is played on an unconstrained board', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: OGRE, controller: 1 },
      ],
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const ogre = oidOf(start.state, 'Test Ogre');
    const tunneled = activateAt(start, 0, 'Test Tunneler', bear);
    expect(tunneled.state.turnCombatRules).toHaveLength(1);

    const startedOn = tunneled.state.turn.number;
    let walked: ReduceResult = tunneled;
    for (let guard = 0; guard < 60; guard += 1) {
      if (walked.state.turn.number > startedOn) break;
      const decision = pendingDecision(walked.state);
      if (decision === null) break;
      if (decision.kind === 'priority') {
        walked = apply(walked, { type: 'passPriority', player: decision.player });
        continue;
      }
      if (decision.kind === 'declareAttackers') {
        walked = apply(walked, { type: 'declareAttackers', player: decision.player, attackers: [] });
        continue;
      }
      throw new Error(`unexpected decision ${decision.kind}`);
    }
    expect(walked.state.turn.number).toBeGreaterThan(startedOn);
    expect(walked.state.turnCombatRules).toEqual([]);
    expect(canBlock(walked.state, ogre, bear)).toBe(true);
  });

  it('is swept when the creature it names leaves the battlefield', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      hands: [[], []],
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const tunneled = activateAt(start, 0, 'Test Tunneler', bear);
    expect(tunneled.state.turnCombatRules).toHaveLength(1);
    const gone = moveObject(beginTrace(tunneled.state), bear, 'graveyard');
    expect(gone.state.turnCombatRules).toEqual([]);
  });
});
