/**
 * The attack declarations one question cannot list, and how they get declared.
 *
 * `enumerate.ts` caps at 512 and an attack declaration is the power set of the
 * eligible attackers (CR 508.1 lets each one attack or not, independently), so a
 * board of big creatures has more legal declarations than any list worth
 * building. Measured on this checkout against `attackerDecision`, one scenario
 * board per row, every creature untapped and able to attack, one defender, at
 * the shipped cap — the rows below are where the boundary sits when the cap is
 * 512, and the assertions read it off `DEFAULT_ENUMERATION_CAP` so that a moved
 * cap moves the boundary rather than reddening the file:
 *
 *   eligible  subsets  options  asked in steps
 *   3         8        8        no
 *   6         64       64       no
 *   8         256      256      no
 *   9         512      512      no
 *   10        1024     2        yes
 *   11        2048     2        yes
 *   12        4096     2        yes
 *
 * The list used to stop at 512 subsets plus an appended attack-with-everything,
 * and report `complete: false`. That was the defect twice over: half the
 * declarations had no index at ten creatures and 512 of 4,096 remained at
 * twelve, and because `subsets` grows the lattice one creature at a time, the
 * listed ones were every subset of a *prefix* of the board — the tenth creature
 * onward appeared in no option at all, the same shape `mtg-y1t.2` measured for
 * blocks.
 *
 * `mtg-tb7v` stage 2: past the cap the question shrinks to one creature. Attack
 * with it, at each legal defender, or hold it back, and the next question is
 * asked against what that settled — so every declaration is reachable, and it is
 * reached by exactly one path of answers. Under the cap nothing changed: the
 * same subsets in the same order, so every recorded index still names the move
 * it named. A whole declaration also stays a legal answer to a stepwise
 * question, which is what every constructing caller (both `@mtg/sim` bots, the
 * play surface's declaration panel) depends on.
 */
import { describe, expect, it } from 'vitest';
import type { Action, AttackDeclaration, Decision, GameSession, GameState, ObjectId } from '@mtg/kernel';
import {
  actionKey,
  asksInSteps,
  DEFAULT_ENUMERATION_CAP,
  canonicalAction,
  choose,
  chooseAction,
  humanSeat,
  indexOfAction,
  opponentOf,
  pendingDecision,
  sameAction,
  scenario,
  serializeEvents,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { creature, planeswalker } from './cards';

/** A board of untapped creatures of yours, parked on the attack declaration. */
function attackingState(count: number): GameState {
  const creatures: readonly Card[] = Array.from({ length: count }, (_, index) =>
    creature(`Hillside Bruiser ${String(index)}`, 3, 3),
  );
  return scenario({
    seed: 'kernel/attack-enumeration',
    battlefield: creatures.map((card) => ({ card, controller: 0 as const })),
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  }).state;
}

function attackDecisionOn(state: GameState): Extract<Decision, { kind: 'declareAttackers' }> {
  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'declareAttackers') {
    throw new Error('the board is not asking for attackers');
  }
  return decision;
}

/** A session standing on a stated board, so a decision can be answered on it. */
function sessionOn(state: GameState): GameSession {
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat('you'), humanSeat('them')],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** The whole declaration that sends exactly these creatures at the opponent. */
function whole(
  decision: Extract<Decision, { kind: 'declareAttackers' }>,
  attacking: readonly ObjectId[],
): Action {
  return {
    type: 'declareAttackers',
    player: decision.player,
    attackers: attacking.map((oid): AttackDeclaration => ({ oid, defender: decision.defender })),
  };
}

/** Every creature the option list happens to mention as an attacker. */
function namedIn(options: readonly Action[]): ReadonlySet<ObjectId> {
  const found = new Set<ObjectId>();
  for (const option of options) {
    if (option.type !== 'declareAttackers') continue;
    for (const attack of option.attackers) found.add(attack.oid);
  }
  return found;
}

/**
 * How many creatures such a board is asked about one at a time.
 *
 * `attackerDecision` shrinks the question only while the remaining space will
 * not fit, so after k steps what is left is 2^(n-k) and the list comes back
 * whole at the first k where that is at most the cap. Three at the shipped 512,
 * ten at a cap of 4 — derived rather than written down, because the cap is one
 * global constant over every enumeration in the kernel and a literal here is a
 * second place it would have to be changed.
 */
function stepsBefore(eligible: number): number {
  return Math.max(0, eligible - Math.floor(Math.log2(DEFAULT_ENUMERATION_CAP)));
}

/** Whether a board of this many attackers is listed whole rather than in steps. */
function listedWhole(eligible: number): boolean {
  return stepsBefore(eligible) === 0;
}

describe('the shape of a wide attack enumeration', () => {
  it('lists every subset while the power set fits and asks one creature at a time past it', () => {
    for (const count of [3, 6, 8, 9, 10, 11, 12]) {
      const decision = attackDecisionOn(attackingState(count));
      expect(decision.eligible.length).toBe(count);
      // `complete` says the kernel ran out of legal moves rather than stopped
      // listing, in both arms.
      expect(decision.complete).toBe(true);
      expect(asksInSteps(decision)).toBe(!listedWhole(count));
      if (listedWhole(count)) {
        expect(decision.options.length).toBe(2 ** count);
        expect(new Set(decision.options.map(actionKey)).size).toBe(2 ** count);
        continue;
      }
      // A step list is the whole of what this step can be answered with: attack
      // with the creature being asked about, or hold it back.
      expect(decision.options.length).toBe(2);
      expect(namedIn(decision.options)).toEqual(new Set([decision.eligible[0]]));
    }
    // And the boundary is where the arithmetic says it is rather than wherever
    // the loop above happened to fall: at the shipped cap, nine and ten.
    expect(listedWhole(Math.floor(Math.log2(DEFAULT_ENUMERATION_CAP)))).toBe(true);
    expect(listedWhole(Math.floor(Math.log2(DEFAULT_ENUMERATION_CAP)) + 1)).toBe(false);
  });

  it('reaches a subset no single question lists, and stops asking once the rest fits', () => {
    const state = attackingState(12);
    const opening = attackDecisionOn(state);
    const wanted = opening.eligible.filter((_, index) => index % 2 === 0);

    let session = sessionOn(state);
    let steps = 0;
    for (let guard = 0; guard < 20 && session.pending?.kind === 'declareAttackers'; guard += 1) {
      const decision = session.pending;
      if (decision.kind !== 'declareAttackers') throw new Error('unreachable');
      if (asksInSteps(decision)) {
        // Creatures are asked about in `eligible` order, which is what makes one
        // path of answers reach each declaration rather than one per
        // interleaving of the same answers.
        const asking = decision.eligible[session.state.combat.attacksSettled ?? 0];
        if (asking === undefined) throw new Error('the step asked about nobody');
        const wants = wanted.includes(asking);
        const at = decision.options.findIndex(
          (option) => option.type === 'declareAttackers' && namedIn([option]).has(asking) === wants,
        );
        expect(at).toBeGreaterThanOrEqual(0);
        session = choose(session, at);
        steps += 1;
        continue;
      }
      const finishing = decision.options.findIndex(
        (option) =>
          option.type === 'declareAttackers' && actionKey(option) === actionKey(whole(decision, wanted)),
      );
      expect(finishing).toBeGreaterThanOrEqual(0);
      session = choose(session, finishing);
    }

    // Three steps and then one answer at the shipped cap: the hybrid shrinks the
    // question only while the rest of the space will not fit, and 2^9 = 512
    // does. That is what keeps every board recorded today replaying index for
    // index.
    expect(steps).toBe(stepsBefore(12));
    expect(session.choices.length).toBe(steps + 1);
    expect(session.choices.every((choice) => typeof choice === 'number')).toBe(true);
    expect(session.state.combat.attacks.map((attack) => attack.oid)).toEqual(wanted);
    // The declaration is finished, so the interior bookkeeping is gone and the
    // attack has been announced.
    expect(session.state.combat.attacksSettled).toBeUndefined();
    expect(session.events.some((event) => event.type === 'attackersDeclared')).toBe(true);
    expect(session.pending?.kind).not.toBe('declareAttackers');
  });

  it('asks one creature at a time when several defenders make the product too wide', () => {
    // Four creatures against an opponent and three planeswalkers is 5^4 = 625
    // declarations, past the cap while the board is only four creatures wide.
    const state = scenario({
      seed: 'kernel/attack-enumeration',
      battlefield: [
        ...Array.from({ length: 4 }, (_, index) => ({
          card: creature(`Hillside Bruiser ${String(index)}`, 3, 3),
          controller: 0 as const,
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          card: planeswalker(`Warded Sentinel ${String(index)}`, 4, []),
          controller: 1 as const,
        })),
      ],
      active: 0,
      turn: 6,
      step: 'declareAttackers',
    }).state;
    const decision = attackDecisionOn(state);

    expect(decision.defenders.length).toBe(4);
    expect(asksInSteps(decision)).toBe(true);
    // Hold it back, or send it at any one of the four defenders.
    expect(decision.options.length).toBe(5);

    // Each defender is reachable for the creature being asked about, which is
    // the half of this site the single-defender board cannot exercise.
    const first = decision.eligible[0];
    const aimed = decision.options.flatMap((option) =>
      option.type === 'declareAttackers'
        ? option.attackers.filter((attack) => attack.oid === first).map((attack) => attack.defender)
        : [],
    );
    expect(aimed.length).toBe(4);
    expect(new Set(aimed.map((defender) => JSON.stringify(defender))).size).toBe(4);
  });
});

describe('a legal attack declaration no single question lists', () => {
  /** Half the board, taken from both ends so it straddles the truncation. */
  function halfOf(decision: Extract<Decision, { kind: 'declareAttackers' }>): Action {
    const chosen = decision.eligible.filter((_, index) => index % 2 === 0);
    return {
      type: 'declareAttackers',
      player: decision.player,
      attackers: chosen.map((oid): AttackDeclaration => ({ oid, defender: opponentOf(decision.player) })),
    };
  }

  it('is legal to the kernel while no index names it', () => {
    const state = attackingState(12);
    const decision = attackDecisionOn(state);
    const wanted = halfOf(decision);

    expect(wanted.type === 'declareAttackers' && wanted.attackers.length).toBe(6);
    expect(indexOfAction(decision.options, wanted)).toBeNull();
    // The two facts that make this a recording problem rather than a rules
    // problem: the kernel would take the move, and the list cannot name it.
    expect(validateAction(state, wanted)).toBeNull();
  });

  it('is declared through the constructed door and recorded as itself', () => {
    const state = attackingState(12);
    const wanted = halfOf(attackDecisionOn(state));

    const applied = chooseAction(sessionOn(state), wanted);

    expect(applied.choices.length).toBe(1);
    const recorded = applied.choices[0];
    expect(typeof recorded).not.toBe('number');
    expect(sameAction(recorded as Action, wanted)).toBe(true);
    expect(recorded).toEqual(canonicalAction(wanted));
    expect(applied.state.combat.attacks.length).toBe(6);
  });

  it('lands where spending the same recorded value lands', () => {
    const state = attackingState(12);
    const wanted = halfOf(attackDecisionOn(state));

    const made = chooseAction(sessionOn(state), wanted);
    const spent = choose(sessionOn(state), made.choices[0] as Action);

    expect(stateFingerprint(spent.state)).toBe(stateFingerprint(made.state));
    expect(serializeEvents(spent.events)).toBe(serializeEvents(made.events));
  });

  it('is still refused when it is illegal, however far past the cap it is', () => {
    // A tapped creature cannot attack (CR 508.1a), whether the enumeration
    // listed the declaration or ran out nine creatures before it.
    const state = scenario({
      seed: 'kernel/attack-enumeration',
      battlefield: Array.from({ length: 12 }, (_, index) => ({
        card: creature(`Hillside Bruiser ${String(index)}`, 3, 3),
        controller: 0 as const,
        tapped: index === 11,
      })),
      active: 0,
      turn: 6,
      step: 'declareAttackers',
    }).state;
    const decision = attackDecisionOn(state);
    const asleep = state.battlefield[11];
    if (asleep === undefined) throw new Error('the board is short a creature');
    const withTapped: Action = {
      type: 'declareAttackers',
      player: decision.player,
      attackers: [...decision.eligible, asleep].map((oid): AttackDeclaration => ({
        oid,
        defender: opponentOf(decision.player),
      })),
    };

    expect(decision.eligible.length).toBe(11);
    expect(asksInSteps(decision)).toBe(true);
    expect(() => chooseAction(sessionOn(state), withTapped)).toThrow(/cannot attack/);
    expect(() => choose(sessionOn(state), withTapped)).toThrow(/cannot attack/);
  });
});
