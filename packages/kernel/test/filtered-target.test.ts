/**
 * A filter on the target slot, in the kernel: the two spaces and the four
 * dimensions that cut them down.
 *
 * `targetChoicesForEffects` enumerates a slot as the spell goes on the stack
 * (CR 601.2c) and `isTargetStillLegal` rechecks the chosen target as it
 * resolves (CR 608.2b). Those are separate functions in separate files, and the
 * regression `artifact-enchantment-target.test.ts` was written for is a kind
 * wired into one and forgotten in the other — so every case here asserts the
 * enumeration and then asks `validateAction` about a target the enumeration
 * refused, because a kernel that offers a move and then throws on it is worse
 * than one that never offered it.
 *
 * Each spell is a printed M11 or M13 card, and each board carries a negative
 * control that the filter must leave out. A test whose board holds only the
 * matching permanent passes on a kernel that ignored the filter entirely.
 *
 * The artifact-creature case is the one that is about something other than the
 * filter machinery. CR 205.1a: an artifact creature is both card types at once,
 * and `printedCharacteristics` reported only `creature` for it, so a Smelt
 * could not name a Juggernaut — the card the M11 audit found the gap with
 * (`mtg-6y4g`).
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import {
  IllegalActionError,
  opponentOf,
  pendingDecision,
  reduce,
  scenario,
  targetChoicesFor,
  validateAction,
} from '@mtg/kernel';
import {
  FOREST,
  MOUNTAIN,
  PLAINS,
  SWAMP,
  artifact,
  creature,
  enchantment,
  instant,
  planeswalker,
} from './cards';
import { apply, oidOf } from './helpers';

/** `Destroy target artifact.` (M11) */
const SMELT = instant(
  'Smelt',
  [{ kind: 'destroyPermanent', target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } } }],
  { R: 1 },
);

/** `Destroy target noncreature permanent.` — Bramblecrush (M12), the exclusion arm. */
const BRAMBLECRUSH = instant(
  'Bramblecrush',
  [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['creature'] } },
    },
  ],
  { generic: 2, G: 2 },
);

/** `Destroy target nonblack creature.` — Doom Blade (M11/M12/M13). */
const DOOM_BLADE = instant(
  'Doom Blade',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature', filter: { excludeColors: ['B'] } } }],
  { generic: 1, B: 1 },
);

/** `Destroy target attacking or blocking creature.` — Divine Verdict (M11/M13). */
const DIVINE_VERDICT = instant(
  'Divine Verdict',
  [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { combat: 'attackingOrBlocking' } },
    },
  ],
  { generic: 3, W: 1 },
);

/** `Destroy target artifact or enchantment.` — Naturalize (M11/M13). */
const NATURALIZE = instant(
  'Naturalize',
  [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }],
  { generic: 1, G: 1 },
);

/** `Lava Axe deals 5 damage to target player or planeswalker.` (M11/M13) */
const LAVA_AXE = instant(
  'Lava Axe',
  [{ kind: 'dealDamage', amount: 5, target: { kind: 'targetPlayerOrPlaneswalker' } }],
  { generic: 4, R: 1 },
);

const MONUMENT = artifact('Bronze Monument');
const JUGGERNAUT = creature('Juggernaut', 5, 3, { cost: { generic: 4 }, artifact: true });
const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 1, G: 1 } });
const BANNER = enchantment('Ward Banner', { W: 1 });
const ZOMBIE = creature('Diregraf Ghoul', 2, 2, { cost: { B: 1 } });
const WALKER = planeswalker('Chandra Testbound', 4, []);

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: string } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

/** The one slot this spell has, as the kernel offers it. */
function onlySlot(state: GameState, spell: Card): readonly unknown[] {
  const slots = targetChoicesFor(state, spell, 0);
  expect(slots).toHaveLength(1);
  return slots[0] ?? [];
}

/** Asks `validateAction` about a cast of `spell` aimed at one named permanent. */
function castAt(state: GameState, name: string): Action {
  return {
    type: 'castSpell',
    player: 0,
    oid: state.players[0].hand[0] ?? '',
    targets: [permanentNamed(state, name)],
  };
}

/**
 * Casts that same declaration for real and passes until the stack is empty, so
 * the assertion afterwards is about `isTargetStillLegal` rather than about the
 * enumeration that offered the target in the first place.
 */
function castAndSettle(state: GameState, name: string): GameState {
  let current = reduce(state, castAt(state, name)).state;
  for (let guard = 0; guard < 4 && current.stack.length > 0; guard += 1) {
    const priority = current.turn.priority;
    if (priority === null) break;
    current = reduce(current, { type: 'passPriority', player: priority }).state;
  }
  return current;
}

describe('a card-type filter on the widest object space', () => {
  /** Every permanent kind at once, so "artifact" has four things to not be. */
  function board(spell: Card): GameState {
    return scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: MONUMENT, controller: 1 },
        { card: JUGGERNAUT, controller: 1 },
        { card: BEAR, controller: 1 },
        { card: BANNER, controller: 1 },
      ],
      hands: [[spell], []],
    }).state;
  }

  it('offers the artifacts and nothing else, the artifact creature among them', () => {
    const state = board(SMELT);
    expect(onlySlot(state, SMELT)).toEqual([
      permanentNamed(state, 'Bronze Monument'),
      permanentNamed(state, 'Juggernaut'),
    ]);
  });

  it('refuses the creature the enumeration left out, at validation and at reduce', () => {
    const state = board(SMELT);
    expect(validateAction(state, castAt(state, 'Runeclaw Bear'))).toBe('illegal target for effect 0');
    expect(() => reduce(state, castAt(state, 'Runeclaw Bear'))).toThrow(IllegalActionError);
    expect(validateAction(state, castAt(state, 'Juggernaut'))).toBeNull();
  });

  /**
   * The exclusion arm on the same board, and it is the exact complement of the
   * case above rather than a second spelling of it: the artifact creature is
   * refused here *because* it is a creature, which is the same CR 205.1a
   * reading that admitted it to Smelt.
   */
  it('excludes a card type without naming the other five', () => {
    const state = board(BRAMBLECRUSH);
    const bodies = [oidOf(state, 'Juggernaut'), oidOf(state, 'Runeclaw Bear')];
    // Written as "the battlefield minus the creatures" rather than as a list,
    // because that is what the card says and a list would quietly become a
    // statement about the four lands too.
    expect(onlySlot(state, BRAMBLECRUSH)).toEqual(
      state.battlefield.filter((oid) => !bodies.includes(oid)).map((oid) => ({ kind: 'permanent', oid })),
    );
    expect(validateAction(state, castAt(state, 'Juggernaut'))).toBe('illegal target for effect 0');
    expect(validateAction(state, castAt(state, 'Ward Banner'))).toBeNull();
  });

  /** A land is a permanent, and `targetPermanent` is the only kind that can say so. */
  it('reaches a land, which no other object kind in this vocabulary does', () => {
    const craterize = instant(
      'Craterize',
      [{ kind: 'destroyPermanent', target: { kind: 'targetPermanent', filter: { cardTypes: ['land'] } } }],
      { generic: 2, R: 1 },
    );
    const state = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: SWAMP, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      hands: [[craterize], []],
    }).state;
    expect(onlySlot(state, craterize)).toEqual([
      permanentNamed(state, 'Mountain'),
      permanentNamed(state, 'Swamp'),
    ]);
  });
});

/**
 * CR 205.1a read at resolution rather than at the cast.
 *
 * Everything above stops at `validateAction`, and the recheck is a different
 * function in a different file — so an artifact creature a Smelt may legally
 * name could still walk away from the Smelt. Both routes to that same
 * permanent are here because they reach its type line through different code:
 * a `cardTypes` filter compiles to an `ObjectFilter` and is answered by
 * `matchesFilter`, while `targetArtifactOrEnchantment` is a kind and asks
 * `hasCardType`. Either one alone would leave the other unpinned.
 *
 * The plain creature on the same board is the negative control: a kernel that
 * destroyed whatever it was pointed at would pass the first assertion of each
 * test and fail the last.
 */
describe('a destroy that resolves onto an artifact creature', () => {
  function board(spell: Card): GameState {
    return scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: JUGGERNAUT, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      hands: [[spell], []],
    }).state;
  }

  it('kills it through a card-type filter that names the artifact half', () => {
    const state = board(SMELT);
    const after = castAndSettle(state, 'Juggernaut');

    expect(after.objects[oidOf(state, 'Juggernaut')]?.zone).toBe('graveyard');
    expect(after.objects[oidOf(state, 'Runeclaw Bear')]?.zone).toBe('battlefield');
  });

  it('kills it through the artifact-or-enchantment kind, which carries no filter', () => {
    const state = board(NATURALIZE);
    const after = castAndSettle(state, 'Juggernaut');

    expect(onlySlot(state, NATURALIZE)).toEqual([permanentNamed(state, 'Juggernaut')]);
    expect(after.objects[oidOf(state, 'Juggernaut')]?.zone).toBe('graveyard');
    expect(after.objects[oidOf(state, 'Runeclaw Bear')]?.zone).toBe('battlefield');
  });
});

describe('a color filter on the creature space', () => {
  function board(): GameState {
    return scenario({
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: ZOMBIE, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      hands: [[DOOM_BLADE], []],
    }).state;
  }

  it('leaves out the color it refuses', () => {
    const state = board();
    expect(onlySlot(state, DOOM_BLADE)).toEqual([permanentNamed(state, 'Runeclaw Bear')]);
  });

  it('refuses the black creature at validation', () => {
    const state = board();
    expect(validateAction(state, castAt(state, 'Diregraf Ghoul'))).toBe('illegal target for effect 0');
    expect(validateAction(state, castAt(state, 'Runeclaw Bear'))).toBeNull();
  });

  /**
   * The word the card prints is nonblack, and that is not the same word as
   * some other color: a colorless creature has no black in it either, so an
   * artifact creature is a legal Doom Blade target. That is the case the two
   * tests above cannot see, because a green bear is admitted by a kernel that
   * read `excludeColors` as "must have a color, and not that one" too.
   */
  it('admits the colorless creature, and destroys it', () => {
    const state = scenario({
      battlefield: [
        { card: SWAMP, controller: 0 },
        { card: SWAMP, controller: 0 },
        { card: JUGGERNAUT, controller: 1 },
        { card: ZOMBIE, controller: 1 },
      ],
      hands: [[DOOM_BLADE], []],
    }).state;
    const after = castAndSettle(state, 'Juggernaut');

    expect(onlySlot(state, DOOM_BLADE)).toEqual([permanentNamed(state, 'Juggernaut')]);
    expect(validateAction(state, castAt(state, 'Juggernaut'))).toBeNull();
    expect(after.objects[oidOf(state, 'Juggernaut')]?.zone).toBe('graveyard');
    expect(after.objects[oidOf(state, 'Diregraf Ghoul')]?.zone).toBe('battlefield');
  });
});

describe('a combat-role filter', () => {
  /**
   * A real combat, declared through the public actions: an attacker, a blocker,
   * and a creature on each side doing neither. `state.combat` is the only place
   * either role is recorded (CR 506.4), so a board assembled by hand would
   * assert nothing about how the kernel reads it.
   */
  function combat(): GameState {
    const start = scenario({
      battlefield: [
        { card: JUGGERNAUT, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: ZOMBIE, controller: 1 },
        { card: MONUMENT, controller: 1 },
        { card: PLAINS, controller: 1 },
        { card: PLAINS, controller: 1 },
        { card: PLAINS, controller: 1 },
        { card: PLAINS, controller: 1 },
      ],
      hands: [[], [DIVINE_VERDICT]],
      active: 0,
      turn: 4,
      step: 'declareAttackers',
    });
    let current = apply(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: oidOf(start.state, 'Juggernaut'), defender: opponentOf(0) }],
    });
    // Both players get priority in the declare-attackers step before the
    // defender is asked to block (CR 508.2), so the blocks are declared when
    // the kernel asks for them rather than at a step number this test guessed.
    for (let guard = 0; guard < 8; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision === null || decision.kind === 'declareBlockers') break;
      if (decision.kind !== 'priority') throw new Error(`unexpected decision ${decision.kind}`);
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    current = apply(current, {
      type: 'declareBlockers',
      player: 1,
      blocks: [
        {
          blocker: oidOf(current.state, 'Diregraf Ghoul'),
          attacker: oidOf(current.state, 'Juggernaut'),
        },
      ],
    });
    // The active player gets priority first once blockers are declared (CR
    // 509.4), and it is the defender who is holding the trick, so the board
    // this returns is the one where the defender may actually cast it.
    for (let guard = 0; guard < 8; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision === null || (decision.kind === 'priority' && decision.player === 1)) break;
      if (decision.kind !== 'priority') throw new Error(`unexpected decision ${decision.kind}`);
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    return current.state;
  }

  it('offers the attacker and the blocker and neither creature standing by', () => {
    const state = combat();
    const slots = targetChoicesFor(state, DIVINE_VERDICT, 1);
    expect(slots[0]).toEqual([permanentNamed(state, 'Juggernaut'), permanentNamed(state, 'Diregraf Ghoul')]);
  });

  it('refuses a creature that is in the combat but not in it', () => {
    const state = combat();
    const cast: Action = {
      type: 'castSpell',
      player: 1,
      oid: state.players[1].hand[0] ?? '',
      targets: [permanentNamed(state, 'Runeclaw Bear')],
    };
    expect(validateAction(state, cast)).toBe('illegal target for effect 0');
  });

  /**
   * The half of CR 608.2b a filter adds: the target was legal when it was
   * chosen and is not legal now. Removing the creature from combat is what a
   * blocker being destroyed does, and `state.combat` is where the kernel reads
   * the role from, so emptying `blocks` is the same board the rules describe.
   */
  it('is rechecked as the spell resolves, not only as it is cast', () => {
    const state = combat();
    const blocker = oidOf(state, 'Diregraf Ghoul');
    const chosen: Action = {
      type: 'castSpell',
      player: 1,
      oid: state.players[1].hand[0] ?? '',
      targets: [{ kind: 'permanent', oid: blocker }],
    };
    expect(validateAction(state, chosen)).toBeNull();

    const cast = reduce(state, chosen);
    const settle = (from: GameState): GameState =>
      reduce(reduce(from, { type: 'passPriority', player: 1 }).state, {
        type: 'passPriority',
        player: 0,
      }).state;

    // The control: left in combat, the same spell resolves and the blocker dies.
    // Without it this test would pass on a kernel where the spell never
    // resolved at all.
    expect(settle(cast.state).objects[blocker]?.zone).toBe('graveyard');

    const removed: GameState = { ...cast.state, combat: { ...cast.state.combat, blocks: [] } };
    expect(settle(removed).objects[blocker]?.zone).toBe('battlefield');
  });
});

describe('the player-or-planeswalker space', () => {
  function board(): GameState {
    return scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: WALKER, controller: 1 },
        { card: BEAR, controller: 1 },
      ],
      hands: [[LAVA_AXE], []],
    }).state;
  }

  it('offers both seats and the planeswalker and no creature', () => {
    const state = board();
    expect(onlySlot(state, LAVA_AXE)).toEqual([
      { kind: 'player', player: 0 },
      { kind: 'player', player: 1 },
      permanentNamed(state, 'Chandra Testbound'),
    ]);
  });

  it('refuses a creature, which the any-target space would have admitted', () => {
    const state = board();
    expect(validateAction(state, castAt(state, 'Runeclaw Bear'))).toBe('illegal target for effect 0');
    expect(validateAction(state, castAt(state, 'Chandra Testbound'))).toBeNull();
  });
});
