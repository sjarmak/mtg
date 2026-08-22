/**
 * The untargeted sweep resolving: a scope that names a region of the board
 * instead of a targeted player.
 *
 * `sweepers.test.ts` is the same four primitives one scope over, and the
 * difference is the whole of this file. A targeted sweep reads its group off
 * the player it chose, so the board it hits is downstream of a target the
 * kernel enumerated and rechecked. A board sweep chooses nothing (CR 115.1):
 * there is no slot, no recheck and no protection from it, and the group is read
 * off the battlefield as the spell resolves and then fixed for the rest of the
 * resolution (CR 609.2).
 *
 * Which permanents in the region is the `scopeFilter`'s answer and not the
 * scope's, so every case here puts something in the region the filter must
 * leave standing. A wrath tested against a board of nothing but creatures
 * passes on a kernel that ignored the filter and destroyed the lands too.
 *
 * The nine cards these assertions are shaped after are M11 and M13's printed
 * sweepers (`mtg-9u18`): Day of Judgment, Planar Cleansing, Back to Nature,
 * Pyroclasm, Rain of Blades, Glorious Charge, Inspired Charge, Cower in Fear
 * and Trumpet Blast. Temple Bell is here too, for the player sweep beside them.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import {
  characteristicsOf,
  opponentOf,
  pendingDecision,
  playerOf,
  reduce,
  reduceAll,
  scenario,
} from '@mtg/kernel';
import { playersInSweep } from '../src/effects';
import { artifact, creature, enchantment, instant, MOUNTAIN, PLAINS, sorcery, SWAMP } from './cards';
import { apply, oidOf, oidsOf } from './helpers';

/** `Destroy all creatures.` — Day of Judgment (M11 12). */
const DAY_OF_JUDGMENT = sorcery(
  'Day of Judgment',
  [
    {
      kind: 'destroyPermanent',
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
  { generic: 2, W: 2 },
);

/** `Destroy all nonland permanents.` — Planar Cleansing (M13 26). */
const PLANAR_CLEANSING = sorcery(
  'Planar Cleansing',
  [
    {
      kind: 'destroyPermanent',
      scope: 'allPermanents',
      scopeFilter: { excludeCardTypes: ['land'] },
      target: { kind: 'noTarget' },
    },
  ],
  { generic: 3, W: 3 },
);

/** `Pyroclasm deals 2 damage to each creature.` — Pyroclasm (M11 154). */
const PYROCLASM = sorcery(
  'Pyroclasm',
  [
    {
      kind: 'dealDamage',
      amount: 2,
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
  { generic: 1, R: 1 },
);

/** `Rain of Blades deals 1 damage to each attacking creature.` — Rain of Blades (M13 28). */
const RAIN_OF_BLADES = instant(
  'Rain of Blades',
  [
    {
      kind: 'dealDamage',
      amount: 1,
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'], combat: 'attacking' },
      target: { kind: 'noTarget' },
    },
  ],
  { W: 1 },
);

/** `Creatures you control get +1/+1 until end of turn.` — Glorious Charge (M13 15). */
const GLORIOUS_CHARGE = instant(
  'Glorious Charge',
  [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 1,
      toughness: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
  { generic: 1, W: 1 },
);

/** `Creatures your opponents control get -1/-1 until end of turn.` — Cower in Fear (M13 84). */
const COWER_IN_FEAR = instant(
  'Cower in Fear',
  [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -1,
      toughness: -1,
      scope: 'permanentsOpponentsControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
  { generic: 2, B: 1 },
);

/** `Each player draws a card.` — Temple Bell's activated ability, as a spell (M11 217). */
const TEMPLE_TOLL = sorcery(
  'Temple Toll',
  [{ kind: 'drawCards', count: 1, players: 'eachPlayer', target: { kind: 'noTarget' } }],
  { generic: 2 },
);

/** `Each player loses 3 life.` — Howling Banshee's entry trigger, as a spell (M11 100). */
const BANSHEE_WAIL = sorcery(
  'Banshee Wail',
  [{ kind: 'loseLife', amount: 3, players: 'eachPlayer', target: { kind: 'noTarget' } }],
  { generic: 2, B: 1 },
);

/** `Each opponent loses 3 life.` — Blood Tithe's first sentence, as a spell (M13 79). */
const BLOOD_TOLL = sorcery(
  'Blood Toll',
  [{ kind: 'loseLife', amount: 3, players: 'eachOpponent', target: { kind: 'noTarget' } }],
  { generic: 2, B: 1 },
);

/** `Each opponent draws a card.` — the other scope on the other carrier of the same field. */
const OPPOSING_TOLL = sorcery(
  'Opposing Toll',
  [{ kind: 'drawCards', count: 1, players: 'eachOpponent', target: { kind: 'noTarget' } }],
  { generic: 2 },
);

const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 1, G: 1 } });
const GIANT = creature('Hill Giant', 3, 3, { cost: { generic: 4, R: 1 } });
const RELIC = artifact('Bronze Monument');
const BANNER = enchantment('Ward Banner', { W: 1 });

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts the caster's only card at nothing, and lets it resolve. */
function castAndResolve(start: GameState, caster: 0 | 1 = 0): GameState {
  const oid = playerOf(start, caster).hand[0] ?? '';
  const cast = reduce(start, { type: 'castSpell', player: caster, oid, targets: [null] });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: opponentOf(caster) }])
    .state;
}

function nameOf(state: GameState, oid: string): string {
  return state.objects[oid]?.card.name ?? '(gone)';
}

/** Every battlefield object's name, so an assertion names what survived. */
function standing(state: GameState): readonly string[] {
  return state.battlefield.map((oid) => nameOf(state, oid)).sort();
}

function powerOfNamed(state: GameState, name: string): number {
  return characteristicsOf(state, oidOf(state, name)).power ?? 0;
}

describe('a sweep that names the whole board', () => {
  /**
   * The scope reaches both sides, which is the one thing a targeted sweep can
   * never do: `creaturesThatPlayerControls` reads one player and there is only
   * ever one target. The lands are the control — they are in the region and the
   * filter is what leaves them out, so a kernel that read the scope and ignored
   * the filter fails here rather than in a card nobody notices.
   */
  it('destroys every creature on both boards and leaves the lands', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: GIANT, controller: 1 },
        { card: BANNER, controller: 1 },
      ],
      hands: [[DAY_OF_JUDGMENT], []],
    });
    const after = castAndResolve(start.state);

    expect(standing(after)).toEqual(['Plains', 'Plains', 'Plains', 'Plains', 'Ward Banner']);
    expect(playerOf(after, 0).graveyard.map((oid) => nameOf(after, oid))).toContain('Runeclaw Bear');
    expect(playerOf(after, 1).graveyard.map((oid) => nameOf(after, oid))).toContain('Hill Giant');
  });

  /**
   * The exclusion arm of the same filter, and the reason the scope says
   * "permanents" rather than "creatures": Planar Cleansing takes the artifact
   * and the enchantment with it, and one word in the filter is the whole
   * difference between the two cards.
   */
  it('takes every nonland permanent when the filter excludes the lands instead', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: RELIC, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: BANNER, controller: 1 },
      ],
      hands: [[PLANAR_CLEANSING], []],
    });
    const after = castAndResolve(start.state);

    expect(standing(after)).toEqual(['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains']);
  });

  /**
   * Damage rather than destruction, so the survivor is a fact about toughness
   * rather than about the filter. A 3/3 through Pyroclasm is a printed
   * interaction and the reason the card is a two-mana sweeper rather than a
   * four-mana one.
   */
  it('deals its damage to every creature and kills only what it is enough for', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: GIANT, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: BANNER, controller: 1 },
      ],
      hands: [[PYROCLASM], []],
    });
    const after = castAndResolve(start.state);

    expect(standing(after)).toEqual(['Hill Giant', 'Mountain', 'Mountain', 'Ward Banner']);
    expect(after.objects[oidOf(after, 'Hill Giant')]?.damage).toBe(2);
  });
});

describe('a sweep that names one side of the board', () => {
  /**
   * `permanentsYouControl` reads the *resolving controller* and no target at
   * all, which is what the two-word difference from `creaturesThatPlayerControls`
   * buys: Glorious Charge is uncounterable-by-protection, unaimable, and pumps
   * the caster's board whoever else is at the table.
   */
  it('pumps only the caster and leaves the other board alone', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: creature('Loyal Sentry', 2, 2, { cost: { W: 1 } }), controller: 0 },
        { card: GIANT, controller: 1 },
      ],
      hands: [[GLORIOUS_CHARGE], []],
    });
    const after = castAndResolve(start.state);

    expect(powerOfNamed(after, 'Loyal Sentry')).toBe(3);
    expect(powerOfNamed(after, 'Hill Giant')).toBe(3);
  });

  /**
   * The mirror, and the one that kills: a -1/-1 through a one-toughness board is
   * a wrath the opposing creatures cannot be protected from, and it is state-
   * based actions rather than the effect that move them (CR 704.5f). The
   * caster's own 1/1 standing afterwards is what makes the scope one-sided
   * rather than a filter on a whole-board sweep.
   */
  it('shrinks only the opposing board, and the ones that reach zero toughness die', () => {
    const start = scenario({
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: creature('Doomed Traveler', 1, 1, { cost: { W: 1 } }), controller: 0 },
        { card: creature('Tireless Missionaries', 1, 1, { cost: { W: 1 } }), controller: 1 },
        { card: GIANT, controller: 1 },
      ],
      hands: [[COWER_IN_FEAR], []],
    });
    const after = castAndResolve(start.state);

    expect(oidsOf(after, 'Tireless Missionaries')).toHaveLength(0);
    expect(oidsOf(after, 'Doomed Traveler')).toHaveLength(1);
    expect(powerOfNamed(after, 'Hill Giant')).toBe(2);
  });
});

describe('a sweep read through a combat filter', () => {
  /**
   * The filter's combat half over a group rather than over a target slot. Rain
   * of Blades is the defender's card and the attacker is the one it reads, so
   * the board carries a creature on each side that stayed home: without them
   * a kernel that ignored the `combat` field and swept every creature would
   * pass.
   */
  function combat(): GameState {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 1 },
        { card: creature('Goblin Piker', 2, 1, { cost: { generic: 1, R: 1 } }), controller: 0 },
        { card: creature('Wall of Torches', 0, 4, { cost: { R: 1 } }), controller: 0 },
        { card: creature('Serra Angel', 4, 4, { cost: { generic: 3, W: 2 } }), controller: 1 },
      ],
      hands: [[], [RAIN_OF_BLADES]],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    let current: ReduceResult = apply(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: oidOf(start.state, 'Goblin Piker'), defender: opponentOf(0) }],
    });
    // Both players get priority in the declare-attackers step (CR 508.2), and
    // the defender is the one holding the trick, so this walks to the priority
    // that player actually has rather than to a step number guessed here.
    for (let guard = 0; guard < 8; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision === null || (decision.kind === 'priority' && decision.player === 1)) break;
      if (decision.kind !== 'priority') throw new Error(`unexpected decision ${decision.kind}`);
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    return current.state;
  }

  it('burns the attacker and neither creature standing by', () => {
    const after = castAndResolve(combat(), 1);

    expect(oidsOf(after, 'Goblin Piker')).toHaveLength(0);
    expect(after.objects[oidOf(after, 'Wall of Torches')]?.damage).toBe(0);
    expect(after.objects[oidOf(after, 'Serra Angel')]?.damage).toBe(0);
  });
});

describe('a sweep over the players rather than the board', () => {
  /**
   * Temple Bell's line, and the only vocabulary in the DSL that draws for
   * somebody the card never chose. The opponent's draw is the assertion that
   * matters — a kernel reading `playerTarget(ctx.target, ctx.controller)` and
   * ignoring `players` draws for the caster alone and looks correct from the
   * caster's side of the table.
   */
  it('draws for both seats, including the one that did not cast it', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[TEMPLE_TOLL], []],
      libraries: [
        [PLAINS, PLAINS],
        [PLAINS, PLAINS],
      ],
    });
    const before = [playerOf(start.state, 0).hand.length, playerOf(start.state, 1).hand.length] as const;
    const after = castAndResolve(start.state);

    // The caster's hand is one card lighter for the spell it cast and one
    // heavier for the card it drew, which is why this reads as unchanged.
    expect(playerOf(after, 0).hand).toHaveLength(before[0]);
    expect(playerOf(after, 1).hand).toHaveLength(before[1] + 1);
    expect(playerOf(after, 0).library).toHaveLength(1);
    expect(playerOf(after, 1).library).toHaveLength(1);
  });

  /**
   * The second carrier of the same field. The caster losing life is the
   * assertion that separates this from every other way of printing the line:
   * an effect that read the target slot would take three off the opponent
   * alone, which is the sentence a different card prints.
   */
  it('takes life off both seats, including the one that cast it', () => {
    const start = scenario({
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
      hands: [[BANSHEE_WAIL], []],
    });
    const before = [playerOf(start.state, 0).life, playerOf(start.state, 1).life] as const;
    const after = castAndResolve(start.state);

    expect(playerOf(after, 0).life).toBe(before[0] - 3);
    expect(playerOf(after, 1).life).toBe(before[1] - 3);
  });

  /**
   * The second member of `PLAYER_SCOPES`, and the first assertion in this
   * package that tells the two members apart. Until it landed, every sweep
   * fixture in `@mtg/kernel`, `@mtg/dsl` and `@mtg/forge-export` said
   * `eachPlayer`, so the filter in `playersInSweep` that drops the controller
   * was exercised only by the generated M11/M13 ledger.
   *
   * The caster keeping its life is the whole of it: a kernel that read
   * `eachOpponent` as `eachPlayer` takes three off both seats and passes the
   * test one case up.
   */
  it('takes life off the seat that did not cast it and spares the one that did', () => {
    const start = scenario({
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
      ],
      hands: [[BLOOD_TOLL], []],
    });
    const before = [playerOf(start.state, 0).life, playerOf(start.state, 1).life] as const;
    const after = castAndResolve(start.state);

    expect(playerOf(after, 0).life).toBe(before[0]);
    expect(playerOf(after, 1).life).toBe(before[1] - 3);
  });

  /**
   * What two seats cannot prove, proved somewhere else.
   *
   * `eachOpponent` and `targetOpponent` reach the same seat at this table, so
   * no assertion about life totals, hands or libraries separates them — the
   * board after a Blood Toll is the board after the targeted twin. What
   * separates them is upstream of the board: a target is chosen on
   * announcement and recorded on the spell (CR 115.1), so hexproof can answer
   * it and CR 608.2b can take the ability away, and a scope has no such slot.
   * This is the assertion Liliana's Specter (M11 104) and Ravenous Rats (M13
   * 106) exist as a pair to force, and it holds at any seat count.
   */
  it('records no chosen seat, which is what a targeted twin would record', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[OPPOSING_TOLL], []],
      libraries: [[PLAINS], [PLAINS, PLAINS]],
    });
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [null],
    });
    expect(cast.state.stack[0]?.targets).toEqual([null]);

    const after = reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
    expect(playerOf(after, 0).library).toHaveLength(1);
    expect(playerOf(after, 1).library).toHaveLength(1);
  });

  /**
   * The seat list read straight out of the compiler rather than off a board,
   * because the board is where the two scopes stop being distinguishable.
   *
   * Both cases fix the controller at seat 0 and move the active player, so the
   * flip is in APNAP order (CR 101.4) alone. `eachOpponent` drops the same seat
   * both times and `eachPlayer` keeps both, which is what says the filter reads
   * the controller rather than a turn position or a hardcoded index — the three
   * spellings agree at `active: 0` and only one of them keeps agreeing.
   */
  it('reads the swept seats off the controller rather than the turn order', () => {
    for (const active of [0, 1] as const) {
      const state = scenario({ active }).state;
      expect(playersInSweep(state, 'eachPlayer', 0), `eachPlayer, active ${String(active)}`).toEqual(
        active === 0 ? [0, 1] : [1, 0],
      );
      expect(playersInSweep(state, 'eachOpponent', 0), `eachOpponent, active ${String(active)}`).toEqual([1]);
      expect(playersInSweep(state, 'eachOpponent', 1), `eachOpponent, active ${String(active)}`).toEqual([0]);
    }
  });
});

/**
 * The cards that are only sweeps because the launcher can open them, which is
 * the check the DSL cannot make: the kernel is what decides that a sweep with
 * no target slot is castable at all, and `targets: [null]` is what a `noTarget`
 * spec is cast with.
 */
describe('an untargeted sweep as an action', () => {
  it('is cast with no choice recorded at all', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      hands: [[DAY_OF_JUDGMENT], []],
    });
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [null],
    });
    const spell = cast.state.stack[0];
    expect(spell?.targets).toEqual([null]);
  });
});
