/**
 * The two CR 611.2c conditions `mtg-nhyv.76` added, each proven on the printed
 * card that wanted it.
 *
 * `combat-rule-modifiers.test.ts` and `condition.test.ts` already pin the three
 * members that were here before, and this file does not repeat them. It exists
 * because the two new members are the first that read something other than a
 * census of the battlefield or a graveyard, and each brings its own way to be
 * wrong:
 *
 *  1. **`lifeAtLeast` must not latch.** It gates a layer-6 keyword grant and a
 *     layer-7c stat bonus off a number that moves every time anybody takes
 *     damage. A kernel that stamped flying onto the object the first time the
 *     condition held passes every board where the life total only goes up, and
 *     fails the moment it comes back down — so the affirmative board is not the
 *     evidence, the return trip is. The life total here is moved by real damage
 *     rather than by writing the seat, because that is the way it moves in a
 *     played game.
 *  2. **`noOpponentDealtDamageThisTurn` must reset.** It reads accumulated turn
 *     history rather than a state of the board, so it has an end as well as a
 *     beginning: `TurnState.damagedPlayers` is rebuilt wholesale by `beginTurn`
 *     the way `landsPlayed` is, and a kernel that accumulated the seats
 *     somewhere the turn boundary does not reach would satisfy every assertion
 *     inside one turn. The turn is therefore actually played out, through
 *     `passPriority` and an empty attack, rather than stepped over.
 *
 * Both doors are checked for the Goblin — `eligibleAttackers`, the enumeration
 * a play surface reads, and `validateAction`, the gate `reduce` enforces
 * whether or not the caller consulted the offer — for the reason
 * `combat-rule-modifiers.test.ts` states: `cantAttack` is answered by
 * `combatConditionHolds`, a second implementation of CR 611.2c written against
 * live accessors, and evidence that the layer walk reaches a member is no
 * evidence that combat does.
 */
import { describe, expect, it } from 'vitest';
import { validateCards } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  applyDamage,
  eligibleAttackers,
  hasKeyword,
  pendingDecision,
  powerOf,
  scenario,
  toughnessOf,
  validateAction,
} from '@mtg/kernel';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

/**
 * `Lifelink`
 * `As long as you have 30 or more life, this creature gets +5/+5 and has flying.`
 *
 * Two statics rather than one, because one ability carries exactly one
 * modification — the split Goblin Chieftain and Knight Exemplar already make —
 * and both carry the same `enabledWhile`, which is what makes the pair a single
 * printed sentence rather than two independent lines.
 */
const ASCENDANT = creature('Serra Ascendant', 1, 1, {
  cost: { W: 1 },
  subtypes: ['Human', 'Monk'],
  keywords: ['lifelink'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'statBonus', power: 5, toughness: 5 },
      enabledWhile: { kind: 'lifeAtLeast', atLeast: 30 },
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'grantKeyword', keyword: 'flying' },
      enabledWhile: { kind: 'lifeAtLeast', atLeast: 30 },
    },
  ],
});

/** `This creature can't attack unless an opponent has been dealt damage this turn.` */
const GOBLIN = creature('Bloodcrazed Goblin', 2, 2, {
  cost: { R: 1 },
  subtypes: ['Goblin', 'Berserker'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttack' },
      enabledWhile: { kind: 'noOpponentDealtDamageThisTurn' },
    },
  ],
});

const BEAR = creature('Runeclaw Bear', 2, 2);

/** The subject's derived size and whether the granted keyword reached it. */
function shape(state: GameState, oid: ObjectId): Readonly<Record<string, unknown>> {
  return {
    power: powerOf(state, oid),
    toughness: toughnessOf(state, oid),
    flying: hasKeyword(state, oid, 'flying'),
  };
}

/** Non-combat damage to a player, the only way this file moves a life total. */
function burn(current: ReduceResult, source: ObjectId, player: 0 | 1, amount: number): ReduceResult {
  const dealt = applyDamage({ state: current.state, events: [] }, [
    {
      sourceOid: source,
      controller: player === 0 ? 1 : 0,
      recipient: { kind: 'player', player },
      amount,
      deathtouch: false,
      lifelink: false,
      combat: false,
    },
  ]);
  return { state: dealt.state, events: [...current.events, ...dealt.events] };
}

describe('a static gated by lifeAtLeast (CR 611.2c)', () => {
  it('validates with no violations', () => {
    expect(validateCards([ASCENDANT])).toEqual([]);
  });

  it('is a plain 1/1 without flying while the life total is below the printed number', () => {
    const start = scenario({ battlefield: [{ card: ASCENDANT, controller: 0 }], life: [20, 20] });
    expect(shape(start.state, oidOf(start.state, 'Serra Ascendant'))).toEqual({
      power: 1,
      toughness: 1,
      flying: false,
    });
  });

  it('is a 6/6 with flying at the printed number exactly', () => {
    const start = scenario({ battlefield: [{ card: ASCENDANT, controller: 0 }], life: [30, 20] });
    expect(shape(start.state, oidOf(start.state, 'Serra Ascendant'))).toEqual({
      power: 6,
      toughness: 6,
      flying: true,
    });
  });

  it('reads its own controller life total rather than either seat', () => {
    const start = scenario({ battlefield: [{ card: ASCENDANT, controller: 0 }], life: [20, 40] });
    expect(shape(start.state, oidOf(start.state, 'Serra Ascendant'))).toEqual({
      power: 1,
      toughness: 1,
      flying: false,
    });
  });

  it('gives both the stats and the keyword back when the life total falls under the number again', () => {
    const start = scenario({
      battlefield: [
        { card: ASCENDANT, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      life: [30, 20],
    });
    const ascendant = oidOf(start.state, 'Serra Ascendant');
    expect(shape(start.state, ascendant)).toEqual({ power: 6, toughness: 6, flying: true });

    const burned = burn(start, oidOf(start.state, 'Runeclaw Bear'), 0, 1);
    expect(burned.state.players[0].life).toBe(29);
    expect(shape(burned.state, ascendant)).toEqual({ power: 1, toughness: 1, flying: false });
  });
});

/** Both combat doors' answer for one attacker: the offer, and the submission gate. */
function attackDoors(
  state: GameState,
  attacker: ObjectId,
): { readonly offered: boolean; readonly refusal: string | null } {
  return {
    offered: eligibleAttackers(state).includes(attacker),
    refusal: validateAction(state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    }),
  };
}

describe('cantAttack gated by noOpponentDealtDamageThisTurn (CR 611.2c)', () => {
  it('validates with no violations', () => {
    expect(validateCards([GOBLIN])).toEqual([]);
  });

  it('cannot attack on a turn nobody has been dealt damage', () => {
    const start = scenario({
      battlefield: [
        { card: GOBLIN, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const goblin = oidOf(start.state, 'Bloodcrazed Goblin');
    expect(start.state.turn.damagedPlayers).toEqual([]);
    expect(attackDoors(start.state, goblin)).toEqual({
      offered: false,
      refusal: `${goblin} cannot attack`,
    });
    expect(eligibleAttackers(start.state)).toContain(oidOf(start.state, 'Runeclaw Bear'));
  });

  it('can attack once an opponent has been dealt damage that turn', () => {
    const start = scenario({
      battlefield: [
        { card: GOBLIN, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const goblin = oidOf(start.state, 'Bloodcrazed Goblin');
    const burned = burn(start, goblin, 1, 1);

    expect(burned.state.turn.damagedPlayers).toEqual([1]);
    expect(attackDoors(burned.state, goblin)).toEqual({ offered: true, refusal: null });
  });

  it('reads the seat across the table rather than any player having taken damage', () => {
    const start = scenario({
      battlefield: [
        { card: GOBLIN, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const goblin = oidOf(start.state, 'Bloodcrazed Goblin');
    const burned = burn(start, goblin, 0, 1);

    expect(burned.state.turn.damagedPlayers).toEqual([0]);
    expect(attackDoors(burned.state, goblin)).toEqual({
      offered: false,
      refusal: `${goblin} cannot attack`,
    });
  });

  it('records the seat once however many times it is dealt damage', () => {
    const start = scenario({
      battlefield: [{ card: GOBLIN, controller: 0 }],
      step: 'declareAttackers',
    });
    const goblin = oidOf(start.state, 'Bloodcrazed Goblin');
    const twice = burn(burn(start, goblin, 1, 1), goblin, 1, 2);

    expect(twice.state.turn.damagedPlayers).toEqual([1]);
    expect(twice.state.players[1].life).toBe(17);
  });

  it('locks again on the controller next turn, because the record is turn-scoped', () => {
    const start = scenario({
      battlefield: [
        { card: GOBLIN, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
    });
    const goblin = oidOf(start.state, 'Bloodcrazed Goblin');
    const opened = burn(start, goblin, 1, 1);
    expect(opened.state.turn.damagedPlayers).toEqual([1]);

    // Two turn boundaries, played rather than stepped over, so the Goblin's
    // controller is active again and the assertion is about the same seat's
    // own combat. `landsPlayed` is read alongside as the control: it is the
    // field `damagedPlayers` was modeled on, so a turn that reset one and not
    // the other would mean the reset is not `beginTurn`'s wholesale rebuild.
    const wanted = opened.state.turn.number + 2;
    let walked: ReduceResult = opened;
    for (let guard = 0; guard < 120; guard += 1) {
      if (walked.state.turn.number === wanted && walked.state.turn.step === 'declareAttackers') break;
      const decision = pendingDecision(walked.state);
      if (decision === null) throw new Error('the board stopped owing a decision before the next turn');
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

    expect(walked.state.turn.number).toBe(wanted);
    expect(walked.state.turn.active).toBe(0);
    expect(walked.state.turn.damagedPlayers).toEqual([]);
    expect(walked.state.turn.landsPlayed).toBe(0);
    expect(attackDoors(walked.state, goblin)).toEqual({
      offered: false,
      refusal: `${goblin} cannot attack`,
    });
  });
});
