/** Angelic Arbiter through turn history and live attack/cast legality. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  cleanupTurnEffects,
  copySpellOnStack,
  eligibleAttackers,
  legalActions,
  moveObject,
  pendingDecision,
  scenario,
  stateFingerprint,
  validateAction,
  type ReduceResult,
} from '@mtg/kernel';
import { abilities, controlledBy, copies, onlyObject, withContinuous } from './continuous-helpers';
import { creature, instant, ISLAND } from './cards';
import { apply, handOidOf, oidOf } from './helpers';
import { staticPlayerRuleApplies } from '../src/player-rules';

const ARBITER = parseCard({
  kind: 'creature',
  id: 'tst-angelic-arbiter',
  name: 'Angelic Arbiter',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 4 },
  colors: ['W'],
  manaCost: { generic: 5, W: 2 },
  power: 5,
  toughness: 6,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'cantAttackWithCreaturesIfCastSpellThisTurn',
    },
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'cantCastSpellsIfAttackedWithCreatureThisTurn',
    },
  ],
});

const BEAR = creature('Arbiter Bear', 2, 2);
const RESPONSE: Card = instant(
  'Arbiter Response',
  [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  { U: 1 },
);

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('Angelic Arbiter probe lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

function settleStack(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 12; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    walked = pass(walked);
  }
  throw new Error('Angelic Arbiter probe did not settle the stack');
}

function advanceToAttack(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 120; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind === 'declareAttackers') return walked;
    if (decision === null) throw new Error('Angelic Arbiter game ended before combat');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`Angelic Arbiter has no ${decision.kind} option`);
    walked = apply(walked, option);
  }
  throw new Error('Angelic Arbiter never reached attackers');
}

function castResponse(current: ReduceResult, player: 0 | 1): ReduceResult {
  return apply(current, {
    type: 'castSpell',
    player,
    oid: handOidOf(current.state, player, RESPONSE.name),
    targets: [null],
  });
}

function board(withArbiter = true): ReduceResult {
  return scenario({
    battlefield: [
      ...(withArbiter ? [{ card: ARBITER, controller: 1 as const }] : []),
      { card: BEAR, controller: 0, summoningSick: false },
      { card: ISLAND, controller: 0 },
    ],
    hands: [[RESPONSE], withArbiter ? [] : [ARBITER]],
  });
}

describe('Angelic Arbiter in the kernel', () => {
  it('records a cast and refuses both enumerated and hostile attacks while the Arbiter is live', () => {
    const cast = castResponse(board(), 0);
    expect(cast.state.turn.playersWhoCastSpellThisTurn).toEqual([0]);
    expect(cast.state.stack).toHaveLength(1);

    const resolved = settleStack(cast);
    const bear = oidOf(resolved.state, BEAR.name);
    expect(eligibleAttackers(resolved.state)).not.toContain(bear);
    const combat = {
      ...resolved.state,
      turn: {
        ...resolved.state.turn,
        step: 'declareAttackers' as const,
        priority: null,
        awaiting: 'attackers' as const,
        awaitingPlayer: 0 as const,
      },
    };
    expect(
      legalActions(combat).some(
        (action) =>
          action.type === 'declareAttackers' && action.attackers.some((attack) => attack.oid === bear),
      ),
    ).toBe(false);
    expect(
      validateAction(combat, {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: bear, defender: 1 }],
      }),
    ).toContain("can't attack with creatures after casting a spell this turn");
  });

  it('accepts the enumerated empty declaration when the live rule leaves no eligible attacker', () => {
    const resolved = settleStack(castResponse(board(), 0));
    const combatState = {
      ...resolved.state,
      turn: {
        ...resolved.state.turn,
        step: 'declareAttackers' as const,
        priority: null,
        awaiting: 'attackers' as const,
        awaitingPlayer: 0 as const,
      },
    };
    const declarations = legalActions(combatState).filter((action) => action.type === 'declareAttackers');
    expect(declarations).toEqual([{ type: 'declareAttackers', player: 0, attackers: [] }]);
    const declaration = declarations[0];
    if (declaration === undefined) throw new Error('Angelic Arbiter offered no attack declaration');
    expect(validateAction(combatState, declaration)).toBeNull();
    expect(() => apply({ ...resolved, state: combatState }, declaration)).not.toThrow();
  });

  it('records a nonempty attack and refuses both enumerated and hostile casts', () => {
    const combat = advanceToAttack(board());
    const bear = oidOf(combat.state, BEAR.name);
    const attacked = apply(combat, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: bear, defender: 1 }],
    });
    expect(attacked.state.turn.playersWhoAttackedWithCreatureThisTurn).toEqual([0]);
    const spell = handOidOf(attacked.state, 0, RESPONSE.name);
    expect(legalActions(attacked.state).some((action) => action.type === 'castSpell')).toBe(false);
    expect(
      validateAction(attacked.state, { type: 'castSpell', player: 0, oid: spell, targets: [null] }),
    ).toContain("can't cast spells after attacking with a creature this turn");
  });

  it('does not count declining every attack as attacking with a creature', () => {
    const combat = advanceToAttack(board());
    const declined = apply(combat, { type: 'declareAttackers', player: 0, attackers: [] });
    expect(declined.state.turn.playersWhoAttackedWithCreatureThisTurn).toEqual([]);
    expect(legalActions(declined.state).some((action) => action.type === 'castSpell')).toBe(true);
  });

  it('starts and stops the attack restriction with the live source, without disturbing the stack', () => {
    const cast = castResponse(board(false), 0);
    const bear = oidOf(cast.state, BEAR.name);
    expect(eligibleAttackers(cast.state)).toContain(bear);
    const existingSpell = cast.state.stack[0]?.oid;

    const arbiterInHand = handOidOf(cast.state, 1, ARBITER.name);
    const arrived = moveObject(beginTrace(cast.state), arbiterInHand, 'battlefield', { controller: 1 });
    expect(eligibleAttackers(arrived.state)).not.toContain(bear);
    expect(arrived.state.stack[0]?.oid).toBe(existingSpell);

    const gone = moveObject(arrived, arbiterInHand, 'graveyard');
    expect(eligibleAttackers(gone.state)).toContain(bear);
    expect(gone.state.stack[0]?.oid).toBe(existingSpell);
  });

  it('uses the source current controller when deciding who is an opponent', () => {
    const cast = castResponse(board(), 0);
    const bear = oidOf(cast.state, BEAR.name);
    const arbiter = oidOf(cast.state, ARBITER.name);
    expect(eligibleAttackers(cast.state)).not.toContain(bear);

    const changed = withContinuous(cast.state, [controlledBy(onlyObject(arbiter), 0)]);
    expect(eligibleAttackers(changed)).toContain(bear);
  });

  it('copies player rules in layer 1 and removes them with all abilities in layer 6', () => {
    const start = board();
    const arbiter = oidOf(start.state, ARBITER.name);
    const bear = oidOf(start.state, BEAR.name);
    const acted = {
      ...start.state,
      turn: {
        ...start.state.turn,
        playersWhoCastSpellThisTurn: [0, 1] as const,
      },
    };
    const copied = withContinuous(acted, [
      copies(onlyObject(bear), arbiter),
      abilities(onlyObject(arbiter), { removeAll: true }),
    ]);

    expect(staticPlayerRuleApplies(copied, 0, 'cantAttackWithCreaturesIfCastSpellThisTurn')).toBe(false);
    expect(staticPlayerRuleApplies(copied, 1, 'cantAttackWithCreaturesIfCastSpellThisTurn')).toBe(true);

    const stripped = withContinuous(copied, [abilities(onlyObject(bear), { removeAll: true })]);
    expect(staticPlayerRuleApplies(stripped, 1, 'cantAttackWithCreaturesIfCastSpellThisTurn')).toBe(false);
  });

  it('fails closed when the battlefield contains a dangling rule source', () => {
    const cast = castResponse(board(), 0);
    const arbiter = oidOf(cast.state, ARBITER.name);
    const objects = Object.fromEntries(Object.entries(cast.state.objects).filter(([oid]) => oid !== arbiter));
    expect(objects[arbiter]).toBeUndefined();
    expect(() =>
      staticPlayerRuleApplies(
        { ...cast.state, battlefield: [arbiter], objects },
        0,
        'cantAttackWithCreaturesIfCastSpellThisTurn',
      ),
    ).toThrow(`unknown game object: ${arbiter}`);
  });

  it('does not count a copied spell as another cast', () => {
    const cast = castResponse(board(), 0);
    const spell = cast.state.stack[0]?.oid;
    if (spell === undefined) throw new Error('Angelic Arbiter probe found no spell to copy');
    const before = cast.state.turn.playersWhoCastSpellThisTurn;
    const copied = copySpellOnStack(beginTrace(cast.state), spell);
    expect(copied.state.turn.playersWhoCastSpellThisTurn).toEqual(before);
  });

  it('fingerprints both histories and clears them at cleanup', () => {
    const withoutArbiter = board(false);
    const cast = settleStack(castResponse(withoutArbiter, 0));
    const combat = advanceToAttack(cast);
    const bear = oidOf(combat.state, BEAR.name);
    const acted = apply(combat, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: bear, defender: 1 }],
    });
    expect(acted.state.turn.playersWhoCastSpellThisTurn).toEqual([0]);
    expect(acted.state.turn.playersWhoAttackedWithCreatureThisTurn).toEqual([0]);
    expect(stateFingerprint(acted.state)).not.toBe(
      stateFingerprint({
        ...acted.state,
        turn: {
          ...acted.state.turn,
          playersWhoCastSpellThisTurn: [],
          playersWhoAttackedWithCreatureThisTurn: [],
        },
      }),
    );

    const cleaned = cleanupTurnEffects(beginTrace(acted.state));
    expect(cleaned.state.turn.playersWhoCastSpellThisTurn).toEqual([]);
    expect(cleaned.state.turn.playersWhoAttackedWithCreatureThisTurn).toEqual([]);
  });
});
