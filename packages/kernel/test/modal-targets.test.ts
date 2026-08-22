/**
 * The two places inside the kernel that still read a card's effect list to aim
 * a spell, and what a modal card (CR 700.2) does to each.
 *
 * A modal spell's `card.effects` is empty by construction — `checkEffects`
 * refuses a spell that carries both a flat list and `modes` — so a walk over
 * it never throws and never finds anything. `modal-and-may.test.ts` covers the
 * cast path itself, where `legal.ts` resolves the mode before anything reads an
 * effect. This file covers the two readers that stand outside that resolution:
 * the kernel's own heuristic agent, which scores a cast it is handed, and
 * `targetChoicesFor`, which is exported and can be handed a card by a caller
 * that never went through `castOptions` at all.
 */
import { describe, expect, it } from 'vitest';
import type { Card, ManaCostInput, Mode } from '@mtg/dsl';
import { colorsFromCost, effectsFor, mana, parseCard } from '@mtg/dsl';
import type { Action } from '@mtg/kernel';
import {
  everySlotHasAChoice,
  pendingDecision,
  scenario,
  simpleAgent,
  targetChoicesFor,
  targetChoicesForEffects,
} from '@mtg/kernel';
import { creature, FOREST, lands, sorcery } from './cards';

let fixtureCounter = 0;

function modalSorcery(name: string, modes: readonly Mode[], cost: ManaCostInput = { generic: 1 }): Card {
  fixtureCounter += 1;
  const manaCost = mana(cost);
  return parseCard({
    kind: 'sorcery',
    id: `tst-modal-target-${String(fixtureCounter)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: (fixtureCounter % 900) + 1 },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects: [],
    modes,
  });
}

const BOLT_MODE: Mode = { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }] };
const DRAW_MODE: Mode = { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] };
const DRAIN_MODE: Mode = { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetPlayer' } }] };
const PUMP_MODE: Mode = {
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } }],
};

/**
 * Mine on the battlefield first, so the enumeration offers the bolt at my own
 * creature before it offers it at the opponent's. That ordering is what makes
 * the assertion below an assertion: an agent that scores every cast the same
 * takes the first option it was handed, which on this board is the one that
 * shoots its own bear.
 */
function boardWith(spell: Card) {
  const start = scenario({
    battlefield: [
      { card: creature('Audit Bear', 2, 2), controller: 0 },
      { card: creature('Ashen Rook', 2, 2), controller: 1 },
      ...lands(FOREST, 1).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[spell], []],
  });
  return { start, spell };
}

function board() {
  return boardWith(modalSorcery('Fork in the Road', [BOLT_MODE, DRAW_MODE]));
}

function castOptionsOf(options: readonly Action[]): readonly Extract<Action, { type: 'castSpell' }>[] {
  return options.filter((action): action is Extract<Action, { type: 'castSpell' }> => {
    return action.type === 'castSpell';
  });
}

describe('the kernel agent scores a modal cast by the mode it is casting', () => {
  it('bolts the opponent creature rather than its own', () => {
    const { start } = board();
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody has priority');
    const mine = start.state.battlefield[0];
    const theirs = start.state.battlefield[1];
    // Non-vacuity: the wrong choice really was on the table, aimed at a
    // creature this seat controls, and it was offered first.
    const bolts = castOptionsOf(decision.options).filter((action) => action.mode === 0);
    expect(bolts.map((action) => action.targets[0])).toEqual([
      { kind: 'permanent', oid: mine },
      { kind: 'permanent', oid: theirs },
    ]);

    const chosen = simpleAgent('bot').decide({ state: start.state, player: 0, decision });
    expect(chosen).toEqual({
      type: 'castSpell',
      player: 0,
      oid: start.state.players[0].hand[0],
      targets: [{ kind: 'permanent', oid: theirs }],
      mode: 0,
    });
  });

  it('scores a mode that wants no target above one aimed at its own creature', () => {
    const { start } = board();
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody has priority');
    const mine = start.state.battlefield[0];
    const agent = simpleAgent('bot');

    const selfBolt = castOptionsOf(decision.options).find(
      (action) =>
        action.mode === 0 && action.targets[0]?.kind === 'permanent' && action.targets[0].oid === mine,
    );
    const draw = castOptionsOf(decision.options).find((action) => action.mode === 1);
    if (selfBolt === undefined || draw === undefined) throw new Error('the board did not offer both modes');

    // Two options, one seat, one agent: whichever the agent takes when it is
    // shown only these two is the one it scores higher. A reader of
    // `card.effects` scores both at zero and takes the first, so this pins the
    // ordering rather than the arithmetic.
    const first = agent.decide({
      state: start.state,
      player: 0,
      decision: { ...decision, options: [selfBolt, draw] },
    });
    const second = agent.decide({
      state: start.state,
      player: 0,
      decision: { ...decision, options: [draw, selfBolt] },
    });
    expect(first).toEqual(draw);
    expect(second).toEqual(draw);
  });

  /**
   * The two assertions above pin "reads the modes at all" and stop there: both
   * boards score every mode of `card.effects` at zero, so an agent hard-wired to
   * mode 0 passes them. This one separates "reads the chosen mode" from "reads
   * the first mode", which is a different claim and the one the action's `mode`
   * field exists for.
   *
   * It needs a card whose two modes disagree about what a good target is, not
   * merely about how good one is. Mode 0 burns a player and mode 1 pumps a
   * creature, so the sign of every mode-1 option flips when it is scored as
   * mode 0: pumping my own bear is the best cast on the board (+7) read
   * correctly and the worst (-8) read as a burn spell, while pumping the
   * opponent's bear is the reverse. An agent stuck on mode 0 therefore does not
   * mis-rank the modes by a point — it hands the opponent's creature +2/+2.
   */
  it('scores the mode the action names rather than the first mode the card prints', () => {
    const { start } = boardWith(modalSorcery('Fork in the Path', [DRAIN_MODE, PUMP_MODE]));
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody has priority');
    const mine = start.state.battlefield[0];
    const theirs = start.state.battlefield[1];

    // Non-vacuity: the pump really is offered at both creatures, so the cast
    // this agent must not make was on the table beside the one it must.
    expect(castOptionsOf(decision.options).map((action) => [action.mode, action.targets[0]])).toEqual([
      [0, { kind: 'player', player: 0 }],
      [0, { kind: 'player', player: 1 }],
      [1, { kind: 'permanent', oid: mine }],
      [1, { kind: 'permanent', oid: theirs }],
    ]);

    const chosen = simpleAgent('bot').decide({ state: start.state, player: 0, decision });
    expect(chosen).toEqual({
      type: 'castSpell',
      player: 0,
      oid: start.state.players[0].hand[0],
      targets: [{ kind: 'permanent', oid: mine }],
      mode: 1,
    });
  });
});

describe('targetChoicesFor refuses a modal card rather than answering with no slots', () => {
  it('throws, because an empty slot list reads as "every slot has a choice"', () => {
    const { start, spell } = board();
    expect(() => targetChoicesFor(start.state, spell, 0)).toThrow(/requires a chosen mode/);
    // The companion the throw exists for: an empty answer is not a refusal.
    // `everySlotHasAChoice` says yes to it, so the silent version of this bug
    // reported a modal card castable with no target at all.
    expect(everySlotHasAChoice([])).toBe(true);
  });

  it('had real targets to find, so the empty answer was never "nothing to aim at"', () => {
    const { start, spell } = board();
    const slots = targetChoicesForEffects(start.state, effectsFor(spell, 0), 0);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual([
      { kind: 'permanent', oid: start.state.battlefield[0] },
      { kind: 'permanent', oid: start.state.battlefield[1] },
    ]);
  });

  it('is not on the cast path: the enumeration offers every mode of the same card', () => {
    const { start } = board();
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'priority') throw new Error('nobody has priority');
    expect(
      castOptionsOf(decision.options)
        .map((action) => action.mode)
        .sort(),
    ).toEqual([0, 0, 1]);
  });

  it('still answers for a non-modal spell, which is the shape it was written for', () => {
    const { start } = board();
    const bolt = sorcery('Bolt of Lightning', [
      { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } },
    ]);
    expect(targetChoicesFor(start.state, bolt, 0)).toEqual([
      [
        { kind: 'permanent', oid: start.state.battlefield[0] },
        { kind: 'permanent', oid: start.state.battlefield[1] },
      ],
    ]);
  });
});
