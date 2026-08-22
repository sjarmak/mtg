/**
 * Every restriction on declaring an attacker, asked of both doors.
 *
 * Two doors, because a rule enforced in one and not the other is how a surface
 * and the kernel come to disagree about a legal play — the argument
 * `activated-abilities.test.ts` makes for the tap symbol, made here for CR
 * 508.1a. `eligibleAttackers` is the enumeration a play surface builds its
 * roster and its board ring from (`@mtg/ui`'s `declare.ts` reads
 * `decision.eligible` and nothing else); `validateAttackerDeclaration`, reached
 * through `validateAction`, is what `chooseAction` and `choose` put a
 * *constructed* declaration through — the shape a bot, the netplay wire and the
 * board-band confirm can all submit past the enumeration cap.
 *
 * The playtester, 2026-08-17, of a lab game: "it let me attack with it the turn I
 * played it even though it has trample not haste". The report did not reproduce
 * against either door (see the session note on the bead), so this file is the
 * standing pin: whatever the surface does, a creature the rules hold back is
 * refused twice.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  eligibleAttackers,
  reduce,
  reduceAll,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { creature, lands, PLAINS } from './cards';
import { oidOf } from './helpers';

/** The card the report was written about: 3/3 trample, no haste. */
const RAMPAGER = creature('Arena Rampager', 3, 3, {
  keywords: ['trample'],
  cost: { generic: 2, R: 1 },
});
const HASTY_RAMPAGER = creature('Hasted Rampager', 3, 3, {
  keywords: ['haste', 'trample'],
  cost: { generic: 2, R: 1 },
});
const WALL: Card = parseCard({
  kind: 'creature',
  id: 'test-iron-gate',
  name: 'Iron Gate',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 1 },
  colors: [],
  keywordAbilities: [{ kind: 'defender' }],
  power: 0,
  toughness: 4,
});
const BEAR = creature('Runeclaw Bear', 2, 2);

const PACIFISM: Card = parseCard({
  kind: 'enchantment',
  id: 'test-pacifism',
  name: 'Pacifism',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [{ kind: 'cantAttack' }] },
});

/** The whole declaration a surface would construct for one attacker. */
function swingWith(oid: ObjectId): Action {
  return { type: 'declareAttackers', player: 0, attackers: [{ oid, defender: 1 }] };
}

/** What the two doors say about one creature: offered, and accepted. */
function doors(state: GameState, oid: ObjectId): { offered: boolean; refusal: string | null } {
  return {
    offered: eligibleAttackers(state).includes(oid),
    refusal: validateAction(state, swingWith(oid)),
  };
}

describe('CR 508.1a: which creatures may be declared as attackers', () => {
  it('refuses a summoning-sick creature with trample and no haste, at both doors', () => {
    const start = scenario({
      battlefield: [
        { card: RAMPAGER, controller: 0, summoningSick: true },
        // A second, legal attacker, so the step still opens the question: a
        // board with nothing to declare skips to priority and the constructed
        // door would refuse for the wrong reason.
        { card: BEAR, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const rampager = oidOf(start.state, 'Arena Rampager');
    expect(doors(start.state, rampager)).toEqual({
      offered: false,
      refusal: `${rampager} cannot attack`,
    });
    expect(eligibleAttackers(start.state)).toContain(oidOf(start.state, 'Runeclaw Bear'));
  });

  it('allows a summoning-sick creature that has haste (CR 702.10b)', () => {
    const start = scenario({
      battlefield: [{ card: HASTY_RAMPAGER, controller: 0, summoningSick: true }],
      step: 'declareAttackers',
    });
    const hasted = oidOf(start.state, 'Hasted Rampager');
    expect(doors(start.state, hasted)).toEqual({ offered: true, refusal: null });
  });

  it('refuses a tapped creature', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0, tapped: true },
        { card: RAMPAGER, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const bear = oidOf(start.state, 'Runeclaw Bear');
    expect(doors(start.state, bear)).toEqual({ offered: false, refusal: `${bear} cannot attack` });
  });

  it('refuses a creature with defender (CR 702.3b)', () => {
    const start = scenario({
      battlefield: [
        { card: WALL, controller: 0 },
        { card: RAMPAGER, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const wall = oidOf(start.state, 'Iron Gate');
    expect(doors(start.state, wall)).toEqual({ offered: false, refusal: `${wall} cannot attack` });
  });

  it("refuses a creature an aura says can't attack", () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: RAMPAGER, controller: 0 },
        ...lands(PLAINS, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[PACIFISM], []],
    }).state;
    const bear = oidOf(start, 'Runeclaw Bear');
    const aura = start.players[0].hand[0];
    if (aura === undefined) throw new Error('no Pacifism in hand');
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid: aura,
      targets: [{ kind: 'permanent', oid: bear }],
    });
    const resolved = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    const combat = reduceAll(resolved.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]).state;
    expect(combat.turn.step).toBe('declareAttackers');
    expect(doors(combat, bear)).toEqual({ offered: false, refusal: `${bear} cannot attack` });
    expect(eligibleAttackers(combat)).toContain(oidOf(combat, 'Arena Rampager'));
  });
});
