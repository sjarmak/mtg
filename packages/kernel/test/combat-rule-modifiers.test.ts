/**
 * The six combat rule modifiers `mtg-t3ik` generalized off the Aura-only path,
 * proven on a plain printed static rather than on an attached enchantment.
 *
 * `attack-restrictions.test.ts` already pins `cantAttack` through Pacifism and
 * this file does not repeat that case; it exists because `hasCombatModification`
 * (`combat.ts`) reads *any* battlefield source's static abilities, and the claim
 * worth a standing test is that a creature's own printed line reaches the same
 * two doors an Aura does — `eligibleAttackers`/`eligibleBlockers`/`canBlock` (the
 * enumeration a play surface reads) and `validateAction` (the gate `reduce`
 * actually enforces, reached whether or not a caller consulted the enumeration
 * first).
 *
 * `attacksEachCombatIfAble` and `mustBeBlockedIfAble` are requirements rather
 * than restrictions (CR 508.1d, CR 509.1c), so the interesting failure mode is
 * not "an illegal action is accepted" but "a legal-looking omission is not
 * refused" — a declaration that simply leaves the compelled creature out. Those
 * two describe blocks test the omission directly, and `mustBeBlockedIfAble`
 * adds a genuine resource-contention board (two must-attackers sharing one
 * capable blocker) because a per-attacker check would pass a declaration that a
 * joint maximum refuses.
 */
import { describe, expect, it } from 'vitest';
import {
  canBlock,
  eligibleAttackers,
  eligibleBlockers,
  pendingDecision,
  reduce,
  satisfyMustBeBlocked,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { creature } from './cards';
import { withCounters } from './continuous-helpers';
import { oidOf, playCombat } from './helpers';

const BEAR = creature('Runeclaw Bear', 2, 2);
const DRAKE = creature('Test Drake', 2, 2, { keywords: ['flying'] });
const DUELIST = creature('Test Duelist', 2, 2, { keywords: ['firstStrike'] });

const GROUNDED = creature('Grounded Golem', 3, 3, {
  abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantAttack' } }],
});

/**
 * `mtg-jp23`: `hasCombatModification` reads `staticIsEnabled`, which now
 * dispatches through `combatConditionHolds`'s `anyCreatureHasCounter` arm
 * (`combat.ts`) rather than only `controlsSubtype`. This fixture is what
 * proves that arm is actually reached from the combat-legality doors and not
 * just from the `LayerContext`-based `conditionHolds` `characteristics.ts`
 * uses for non-combat statics — the two are separate implementations of the
 * same CR 611.2c predicate, argued in `combatConditionHolds`'s own docblock.
 */
/**
 * `mtg-nhyv.28`: the same door, reached through the condition member that
 * reads a *zone*. `combatConditionHolds` is a second implementation of CR
 * 611.2c written against live accessors rather than a `LayerContext`, so every
 * member it grows needs its own evidence that the combat doors reach it — a
 * graveyard count that worked in the layer walk and returned a constant here
 * would show up nowhere else.
 */
const GRAVE_GROUNDED = creature('Grave-Grounded Golem', 3, 3, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttack' },
      enabledWhile: { kind: 'opponentGraveyardAtLeast', atLeast: 3 },
    },
  ],
});

const CONDITIONAL_GROUNDED = creature('Gloom-Grounded Golem', 3, 3, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttack' },
      enabledWhile: { kind: 'anyCreatureHasCounter', counter: 'gloom' },
    },
  ],
});

const PASSIVE = creature('Passive Sentinel', 2, 2, {
  abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantBlock' } }],
});

const PHANTOM = creature('Phantom Raider', 2, 2, {
  abilities: [{ kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantBeBlocked' } }],
});

/**
 * Named `keyword` is `firstStrike` rather than `flying` on purpose: `flying`
 * would make the required-keyword check indistinguishable from CR 702.9b's
 * base evasion rule, which already refuses a non-flying, non-reach blocker
 * against a flying attacker regardless of this static. A keyword with no
 * blocking rule of its own isolates what `requiredBlockKeywords` adds.
 */
const HIGHGUARD = creature('Highguard Sentinel', 2, 3, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'blockOnlyCreaturesWithKeyword', keyword: 'firstStrike' },
    },
  ],
});

const ZEALOT = creature('Reckless Zealot', 2, 2, {
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'attacksEachCombatIfAble' } },
  ],
});

const GROUND_MAGNET = creature('Ground Magnet', 2, 2, {
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});

const OTHER_MAGNET = creature('Second Magnet', 2, 2, {
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});

/**
 * Juggernaut's second line (CR 509.1b), on the mirror of `HIGHGUARD`'s axis:
 * the scope names the *attacker* and the field names the class of blocker the
 * restriction excludes, so the fixture that proves it is an attacker rather
 * than a blocker.
 *
 * Two of them because the combining rule is the interesting half. `TUNNELER`
 * prints one restriction, `BREACHER` prints two, and CR 509.1b asks that no
 * restriction be disobeyed — so the second board's forbidden set is the union
 * of the two named subtypes rather than either one alone.
 */
const TUNNELER = creature('Tunneling Colossus', 5, 3, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantBeBlockedBySubtype', subtype: 'Wall' },
    },
  ],
});

const BREACHER = creature('Breachwork Colossus', 5, 3, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantBeBlockedBySubtype', subtype: 'Wall' },
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantBeBlockedBySubtype', subtype: 'Soldier' },
    },
  ],
});

const RAMPART = creature('Test Rampart', 0, 4, { subtypes: ['Wall'] });
const PIKEMAN = creature('Test Pikeman', 1, 1, { subtypes: ['Soldier'] });

const STALKER = creature('Test Stalker', 3, 3, { keywords: ['menace'] });

/**
 * The combination no card in the set prints and three of them grant: a lure
 * that is also blocked by two creatures or by none. Printed here rather than
 * granted because the two doors under test read `hasKeyword` and
 * `hasCombatModification`, and neither cares where the keyword came from.
 */
const MENACE_MAGNET = creature('Menacing Magnet', 3, 3, {
  keywords: ['menace'],
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});

const SKY_MAGNET = creature('Sky Magnet', 2, 2, {
  keywords: ['flying'],
  abilities: [
    { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
  ],
});

function swingWith(...attackers: readonly ObjectId[]): Action {
  return { type: 'declareAttackers', player: 0, attackers: attackers.map((oid) => ({ oid, defender: 1 })) };
}

/** `attack-restrictions.test.ts`'s pattern: offered, and separately accepted. */
function attackDoors(state: GameState, oid: ObjectId): { offered: boolean; refusal: string | null } {
  return {
    offered: eligibleAttackers(state).includes(oid),
    refusal: validateAction(state, swingWith(oid)),
  };
}

/**
 * Declares the given attack and passes priority until the defending player is
 * asked to declare blockers, without answering that question.
 *
 * `helpers.ts`'s `playCombat` walks a script all the way to a finished game;
 * these tests want the board frozen at the moment blockers are asked for, so
 * they can probe `eligibleBlockers`/`canBlock` (the offer) and `validateAction`
 * (the submission gate) separately before anything resolves.
 */
function toDeclareBlockers(state: GameState, attack: Action): GameState {
  let current = reduce(state, attack);
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.state.turn.step === 'declareBlockers') return current.state;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') {
      throw new Error(`toDeclareBlockers: unexpected decision ${String(decision?.kind ?? 'none')}`);
    }
    current = reduce(current.state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('toDeclareBlockers: did not reach declareBlockers');
}

describe("cantAttack, off a creature's own static rather than an Aura", () => {
  it('refuses the printed source at both doors and leaves a plain creature alone', () => {
    const start = scenario({
      battlefield: [
        { card: GROUNDED, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const grounded = oidOf(start.state, 'Grounded Golem');
    expect(attackDoors(start.state, grounded)).toEqual({
      offered: false,
      refusal: `${grounded} cannot attack`,
    });
    expect(eligibleAttackers(start.state)).toContain(oidOf(start.state, 'Runeclaw Bear'));
  });
});

describe("cantAttack gated by anyCreatureHasCounter (CR 611.2c), off a creature's own conditional static", () => {
  it('attacks freely while no creature on the battlefield carries the counter', () => {
    const start = scenario({
      battlefield: [
        { card: CONDITIONAL_GROUNDED, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const grounded = oidOf(start.state, 'Gloom-Grounded Golem');
    expect(attackDoors(start.state, grounded)).toEqual({ offered: true, refusal: null });
  });

  it('loses the right to attack once any creature on the battlefield carries the counter', () => {
    // Both creatures under one controller, matching the unconditional
    // `cantAttack` test above: with `BEAR` still eligible to attack,
    // `validateAttackerDeclaration` reaches the per-attacker legality check
    // (`grounded cannot attack`) instead of the "declaration incomplete"
    // check a wholly ineligible board would hit first. "Regardless of
    // controller" is the claim `condition.test.ts`'s
    // `anyCreatureHasCounter` suite proves directly against `conditionHolds`;
    // this test's job is only that `combatConditionHolds` is reached at all.
    const start = scenario({
      battlefield: [
        { card: CONDITIONAL_GROUNDED, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const grounded = oidOf(start.state, 'Gloom-Grounded Golem');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const withGloom = withCounters(start.state, bear, 'gloom', 1);
    expect(attackDoors(withGloom, grounded)).toEqual({
      offered: false,
      refusal: `${grounded} cannot attack`,
    });
    expect(eligibleAttackers(withGloom)).toContain(bear);
  });
});

describe('cantAttack gated by opponentGraveyardAtLeast (CR 611.2c)', () => {
  function graveBoard(mine: number, theirs: number): GameState {
    return scenario({
      battlefield: [
        { card: GRAVE_GROUNDED, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      graveyards: [
        Array.from({ length: mine }, (_, index) => creature(`Mine ${String(index)}`, 1, 1)),
        Array.from({ length: theirs }, (_, index) => creature(`Theirs ${String(index)}`, 1, 1)),
      ],
      step: 'declareAttackers',
    }).state;
  }

  it('attacks freely while the opposing graveyard is short of the floor', () => {
    const state = graveBoard(0, 2);
    expect(attackDoors(state, oidOf(state, 'Grave-Grounded Golem'))).toEqual({
      offered: true,
      refusal: null,
    });
  });

  it('loses the right to attack once the opposing graveyard reaches it', () => {
    const state = graveBoard(0, 3);
    const grounded = oidOf(state, 'Grave-Grounded Golem');
    expect(attackDoors(state, grounded)).toEqual({ offered: false, refusal: `${grounded} cannot attack` });
    expect(eligibleAttackers(state)).toContain(oidOf(state, 'Runeclaw Bear'));
  });

  it('reads the other seat graveyard rather than the source controller own', () => {
    const state = graveBoard(6, 0);
    expect(attackDoors(state, oidOf(state, 'Grave-Grounded Golem'))).toEqual({
      offered: true,
      refusal: null,
    });
  });
});

describe("cantBlock, off a creature's own static rather than an Aura", () => {
  it('drops the printed source from the offer and refuses it at submission', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: PASSIVE, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const passive = oidOf(start.state, 'Passive Sentinel');
    const blocking = toDeclareBlockers(start.state, swingWith(bear));
    expect(eligibleBlockers(blocking)).not.toContain(passive);
    expect(canBlock(blocking, passive, bear)).toBe(false);
    const refusal = validateAction(blocking, {
      type: 'declareBlockers',
      player: 1,
      blocks: [{ blocker: passive, attacker: bear }],
    });
    expect(refusal).not.toBeNull();
  });
});

describe("cantBeBlocked, off a creature's own static rather than an Aura", () => {
  it('refuses every potential blocker and resolves unblocked', () => {
    const start = scenario({
      battlefield: [
        { card: PHANTOM, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const phantom = oidOf(start.state, 'Phantom Raider');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    expect(canBlock(start.state, bear, phantom)).toBe(false);

    const done = playCombat(start, { attackers: [phantom], blocks: [] });
    expect(done.state.players[1].life).toBe(18);
  });
});

describe('blockOnlyCreaturesWithKeyword (CR 509.1b), printed rather than granted by an Aura', () => {
  it('refuses a blocker against an attacker missing the named keyword, and allows one that has it', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: DUELIST, controller: 0 },
        { card: HIGHGUARD, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const duelist = oidOf(start.state, 'Test Duelist');
    const highguard = oidOf(start.state, 'Highguard Sentinel');
    expect(canBlock(start.state, highguard, bear)).toBe(false);
    expect(canBlock(start.state, highguard, duelist)).toBe(true);
  });
});

describe("cantBeBlockedBySubtype (CR 509.1b), Juggernaut's second line", () => {
  it('refuses a blocker of the named subtype and allows one that is not', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: RAMPART, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const tunneler = oidOf(start.state, 'Tunneling Colossus');
    const rampart = oidOf(start.state, 'Test Rampart');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    expect(canBlock(start.state, rampart, tunneler)).toBe(false);
    expect(canBlock(start.state, bear, tunneler)).toBe(true);
  });

  it('is a property of the attacker, not of the board', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: RAMPART, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const rampart = oidOf(start.state, 'Test Rampart');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    expect(canBlock(start.state, rampart, bear)).toBe(true);
  });

  /**
   * CR 509.1b: the declaration is illegal if *any* restriction is disobeyed, so
   * two restrictions on one attacker forbid the union of what each names. This
   * is the same rule `requiredBlockKeywords` implements as an intersection —
   * that one states a permission and this one states a prohibition, and the set
   * operation follows from which.
   */
  it('combines two restrictions as the union of the subtypes they forbid', () => {
    const start = scenario({
      battlefield: [
        { card: BREACHER, controller: 0 },
        { card: RAMPART, controller: 1 },
        { card: PIKEMAN, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const breacher = oidOf(start.state, 'Breachwork Colossus');
    expect(canBlock(start.state, oidOf(start.state, 'Test Rampart'), breacher)).toBe(false);
    expect(canBlock(start.state, oidOf(start.state, 'Test Pikeman'), breacher)).toBe(false);
    expect(canBlock(start.state, oidOf(start.state, 'Runeclaw Bear'), breacher)).toBe(true);
  });

  it('refuses the declaration at the gate, not only in the enumeration', () => {
    const start = scenario({
      battlefield: [
        { card: TUNNELER, controller: 0 },
        { card: RAMPART, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const tunneler = oidOf(start.state, 'Tunneling Colossus');
    const rampart = oidOf(start.state, 'Test Rampart');
    const blocking = toDeclareBlockers(start.state, swingWith(tunneler));
    expect(
      validateAction(blocking, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker: rampart, attacker: tunneler }],
      }),
    ).not.toBeNull();
  });
});

describe('attacksEachCombatIfAble (CR 508.1d)', () => {
  it('refuses a declaration that leaves it home while it is able', () => {
    const start = scenario({
      battlefield: [{ card: ZEALOT, controller: 0 }],
      step: 'declareAttackers',
    });
    const zealot = oidOf(start.state, 'Reckless Zealot');
    expect(eligibleAttackers(start.state)).toContain(zealot);
    const refusal = validateAction(start.state, { type: 'declareAttackers', player: 0, attackers: [] });
    expect(refusal).toBe(`${zealot} attacks each combat if able and must attack`);
  });

  it('offers no enumerated declaration that leaves it home', () => {
    const start = scenario({
      battlefield: [
        { card: ZEALOT, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const zealot = oidOf(start.state, 'Reckless Zealot');
    const decision = pendingDecision(start.state);
    if (decision === null || decision.kind !== 'declareAttackers') {
      throw new Error('expected a declareAttackers decision');
    }
    const leavesZealotHome = decision.options.some(
      (option) =>
        option.type === 'declareAttackers' && !option.attackers.some((declared) => declared.oid === zealot),
    );
    expect(leavesZealotHome).toBe(false);
  });

  it('imposes no requirement when the creature is not able (tapped)', () => {
    const start = scenario({
      battlefield: [
        { card: ZEALOT, controller: 0, tapped: true },
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    expect(eligibleAttackers(start.state)).toEqual([bear]);
    expect(validateAction(start.state, { type: 'declareAttackers', player: 0, attackers: [] })).toBeNull();
  });
});

describe('mustBeBlockedIfAble (CR 509.1c)', () => {
  it('refuses a declaration that leaves it unblocked while a capable blocker stands home', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Ground Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));
    const refusal = validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [] });
    expect(refusal).not.toBeNull();
    const accepted = validateAction(blocking, {
      type: 'declareBlockers',
      player: 1,
      blocks: [{ blocker: bear, attacker: magnet }],
    });
    expect(accepted).toBeNull();
  });

  /**
   * Two must-attackers over a blocker pool only one of them fully shares: a
   * flying evasion split means the ground blocker can answer only the ground
   * must-attacker, so the largest *jointly* satisfiable coverage is two,
   * reached exactly one way. Spending the flexible flying blocker on the
   * must-attacker the ground blocker could have covered leaves the other
   * uncovered — legal creature-by-creature, illegal as a whole declaration,
   * which is the case a per-attacker check (rather than a joint maximum) would
   * wrongly accept.
   */
  it('refuses a wasteful assignment and accepts the one that jointly covers both', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: SKY_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: DRAKE, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const groundMagnet = oidOf(start.state, 'Ground Magnet');
    const skyMagnet = oidOf(start.state, 'Sky Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const drake = oidOf(start.state, 'Test Drake');
    const blocking = toDeclareBlockers(start.state, swingWith(groundMagnet, skyMagnet));

    // Bear cannot reach the flying must-attacker at all: the only assignment
    // that covers both is bear-on-ground, drake-on-sky.
    expect(canBlock(blocking, bear, skyMagnet)).toBe(false);

    const wasteful = validateAction(blocking, {
      type: 'declareBlockers',
      player: 1,
      blocks: [{ blocker: drake, attacker: groundMagnet }],
    });
    expect(wasteful).not.toBeNull();

    const optimal = validateAction(blocking, {
      type: 'declareBlockers',
      player: 1,
      blocks: [
        { blocker: bear, attacker: groundMagnet },
        { blocker: drake, attacker: skyMagnet },
      ],
    });
    expect(optimal).toBeNull();
  });

  /**
   * `mtg-f0yd`: a lure that also has menace is blocked by two creatures or by
   * none (CR 702.110b), so with one creature able to block it the requirement
   * is not able to be satisfied and declining to block is the legal
   * declaration. The joint maximum used to price every lure at one blocker, so
   * it read this board as "one requirement satisfiable", refused the empty
   * declaration, and refused the single block too on the menace rule — leaving
   * the defending player no legal answer at all. A Sealed run found it: the set
   * prints three lures and grants menace on three other cards, so the
   * combination arrives on the battlefield rather than on a card.
   */
  it('lets a defender decline a menace lure only one creature can block', () => {
    const start = scenario({
      battlefield: [
        { card: MENACE_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Menacing Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));

    expect(canBlock(blocking, bear, magnet)).toBe(true);
    expect(validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [] })).toBeNull();
    expect(
      validateAction(blocking, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker: bear, attacker: magnet }],
      }),
    ).not.toBeNull();
  });

  it('still compels both blockers when a menace lure has two of them', () => {
    const start = scenario({
      battlefield: [
        { card: MENACE_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: DUELIST, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Menacing Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const duelist = oidOf(start.state, 'Test Duelist');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));

    expect(validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [] })).not.toBeNull();
    expect(
      validateAction(blocking, {
        type: 'declareBlockers',
        player: 1,
        blocks: [
          { blocker: bear, attacker: magnet },
          { blocker: duelist, attacker: magnet },
        ],
      }),
    ).toBeNull();
  });

  /**
   * Where the joint maximum stops being a matching. Three lures and three
   * blockers that can each block any of them: pairing them off one to one says
   * three requirements are satisfiable, but the menace lure eats two blockers
   * and is served all or nothing, so no declaration serves more than two — the
   * two plain lures, or the menace lure and one plain one. A ceiling of three
   * would make every declaration on this board illegal.
   */
  it('prices a menace lure at two blockers when several lures compete for them', () => {
    const start = scenario({
      battlefield: [
        { card: MENACE_MAGNET, controller: 0 },
        { card: GROUND_MAGNET, controller: 0 },
        { card: OTHER_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: DUELIST, controller: 1 },
        { card: DRAKE, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const menacing = oidOf(start.state, 'Menacing Magnet');
    const ground = oidOf(start.state, 'Ground Magnet');
    const other = oidOf(start.state, 'Second Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const duelist = oidOf(start.state, 'Test Duelist');
    const drake = oidOf(start.state, 'Test Drake');
    const blocking = toDeclareBlockers(start.state, swingWith(menacing, ground, other));

    // Both shapes of a two-requirement declaration are legal.
    expect(
      validateAction(blocking, {
        type: 'declareBlockers',
        player: 1,
        blocks: [
          { blocker: bear, attacker: ground },
          { blocker: duelist, attacker: other },
        ],
      }),
    ).toBeNull();
    expect(
      validateAction(blocking, {
        type: 'declareBlockers',
        player: 1,
        blocks: [
          { blocker: bear, attacker: menacing },
          { blocker: duelist, attacker: menacing },
          { blocker: drake, attacker: ground },
        ],
      }),
    ).toBeNull();

    // One requirement is one short of what this board jointly allows.
    expect(
      validateAction(blocking, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker: bear, attacker: ground }],
      }),
    ).not.toBeNull();
  });
});

/**
 * `satisfyMustBeBlocked` is the other half of CR 509.1c: `validateBlockDeclaration`
 * says which declarations are refused, and this says what a constructing agent
 * should have submitted instead. The two have to agree, so every case here
 * asserts the repaired declaration through `validateAction` as well as
 * inspecting it — a repair the kernel itself would reject is the failure mode
 * worth a standing test, and the only reason the function lives beside the rule
 * rather than in `@mtg/sim` next to the policy that needs it.
 */
describe('satisfyMustBeBlocked (CR 509.1c repair)', () => {
  it('leaves a declaration that already covers the requirement alone', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Ground Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));
    const declared = [{ blocker: bear, attacker: magnet }];
    expect(satisfyMustBeBlocked(blocking, declared)).toBe(declared);
  });

  it('covers a lure nobody chose to block, with the creature that was standing home', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Ground Magnet');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));
    const repaired = satisfyMustBeBlocked(blocking, []);
    expect(repaired).toEqual([{ blocker: bear, attacker: magnet }]);
    expect(
      validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [...repaired] }),
    ).toBeNull();
  });

  /**
   * The menace cleanup. Both blockers were committed to the menace attacker,
   * and the lure needs one of them; the block that is left behind is a single
   * body in front of a menace creature, which `validateBlocks` refuses, so the
   * repair gives up the whole voluntary block rather than hand back a
   * declaration the kernel would throw out.
   */
  it('drops a two-body menace block whose second blocker the lure takes', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_MAGNET, controller: 0 },
        { card: STALKER, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: DUELIST, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Ground Magnet');
    const stalker = oidOf(start.state, 'Test Stalker');
    const bear = oidOf(start.state, 'Runeclaw Bear');
    const duelist = oidOf(start.state, 'Test Duelist');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet, stalker));
    const doubleBlock = [
      { blocker: bear, attacker: stalker },
      { blocker: duelist, attacker: stalker },
    ];
    expect(
      validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: doubleBlock }),
    ).not.toBeNull();

    const repaired = satisfyMustBeBlocked(blocking, doubleBlock);
    expect(repaired).toHaveLength(1);
    expect(repaired[0]?.attacker).toBe(magnet);
    expect(
      validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [...repaired] }),
    ).toBeNull();
  });

  /**
   * The repair that produced `mtg-f0yd`. One creature can block, the lure has
   * menace, and the old repair handed back the single block the same file's
   * `validateBlocks` then threw out — `IllegalActionError` in the middle of a
   * Sealed run, from a declaration the kernel had constructed itself.
   */
  it('leaves the declaration alone when a menace lure cannot be blocked at all', () => {
    const start = scenario({
      battlefield: [
        { card: MENACE_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Menacing Magnet');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));
    const repaired = satisfyMustBeBlocked(blocking, []);
    expect(repaired).toEqual([]);
    expect(
      validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [...repaired] }),
    ).toBeNull();
  });

  it('covers a menace lure with both blockers when both are standing home', () => {
    const start = scenario({
      battlefield: [
        { card: MENACE_MAGNET, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: DUELIST, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const magnet = oidOf(start.state, 'Menacing Magnet');
    const blocking = toDeclareBlockers(start.state, swingWith(magnet));
    const repaired = satisfyMustBeBlocked(blocking, []);
    expect(repaired).toHaveLength(2);
    expect(repaired.every((block) => block.attacker === magnet)).toBe(true);
    expect(
      validateAction(blocking, { type: 'declareBlockers', player: 1, blocks: [...repaired] }),
    ).toBeNull();
  });
});
