/**
 * `counterSpell`'s filter: which spell on the stack, not which permanent.
 *
 * The spell filter is a second seam rather than a second spelling of the target
 * filter. `counterSpell` carries no `TargetSpec` at all — it names the stack
 * directly — so `targetChoicesForEffects` answers it in its own branch, and the
 * object it is asked about is in a zone the CR 613 layer walk does not cover
 * (CR 613.1: layers apply to permanents). `spellSatisfiesFilter` therefore
 * reads printed characteristics where `satisfiesTargetFilter` reads derived
 * ones, and this file is what holds those two apart (`mtg-6y4g`).
 *
 * Two spells are on the stack in every case, one of each kind, because a stack
 * holding only the matching spell passes on a kernel that ignored the filter.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@mtg/kernel';
import { playerOf, reduce, scenario, targetChoicesFor, validateAction } from '@mtg/kernel';
import { FOREST, ISLAND, MOUNTAIN, PLAINS, creature, instant } from './cards';
import { oidOf } from './helpers';

/** `Counter target creature spell.` — Essence Scatter (M11/M12/M13). */
const ESSENCE_SCATTER = instant(
  'Essence Scatter',
  [{ kind: 'counterSpell', spellFilter: { cardTypes: ['creature'] } }],
  { generic: 1, U: 1 },
);

/** `Counter target noncreature spell.` — Negate (M11/M12/M13). */
const NEGATE = instant(
  'Negate',
  [{ kind: 'counterSpell', spellFilter: { excludeCardTypes: ['creature'] } }],
  { generic: 1, U: 1 },
);

/** The unfiltered counter, as the control on both of them. */
const CANCEL = instant('Cancel', [{ kind: 'counterSpell' }], { generic: 1, U: 1 });

const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 1, G: 1 } });
const BOLT = instant('Lightning Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
  R: 1,
});

/** The stack entry whose card has this name. */
function spellNamed(state: GameState, name: string): { kind: 'spell'; oid: string } {
  const entry = state.stack.find((candidate) => state.objects[candidate.oid]?.card.name === name);
  if (entry === undefined) throw new Error(`no spell named ${name} on the stack`);
  return { kind: 'spell', oid: entry.oid };
}

/** A creature spell and an instant on the stack, and a counter in the defender's hand. */
function stacked(counter: typeof CANCEL): GameState {
  const start = scenario({
    battlefield: [
      { card: FOREST, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: ISLAND, controller: 1 },
      { card: ISLAND, controller: 1 },
    ],
    hands: [[BEAR, BOLT], [counter]],
  });
  const bear = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: playerOf(start.state, 0).hand[0] ?? '',
    targets: [],
  });
  const bolt = reduce(bear.state, {
    type: 'castSpell',
    player: 0,
    oid: playerOf(bear.state, 0).hand[0] ?? '',
    targets: [{ kind: 'player', player: 1 }],
  });
  // CR 117.3c leaves priority with the caster, so the defender cannot answer
  // either spell until it comes round. Both stay on the stack while it does.
  return reduce(bolt.state, { type: 'passPriority', player: 0 }).state;
}

/** The cast the defender is considering, aimed at one named spell. */
function counterAt(state: GameState, name: string): Parameters<typeof validateAction>[1] {
  return {
    type: 'castSpell',
    player: 1,
    oid: playerOf(state, 1).hand[0] ?? '',
    targets: [spellNamed(state, name)],
  };
}

describe('a counter that names a card type', () => {
  it('offers the creature spell and not the instant', () => {
    const state = stacked(ESSENCE_SCATTER);
    expect(targetChoicesFor(state, ESSENCE_SCATTER, 1)).toEqual([[spellNamed(state, 'Runeclaw Bear')]]);
  });

  it('refuses the instant at validation, where the unfiltered counter takes it', () => {
    const state = stacked(ESSENCE_SCATTER);
    expect(validateAction(state, counterAt(state, 'Lightning Bolt'))).toBe('illegal target for effect 0');
    expect(validateAction(state, counterAt(state, 'Runeclaw Bear'))).toBeNull();

    const unfiltered = stacked(CANCEL);
    expect(validateAction(unfiltered, counterAt(unfiltered, 'Lightning Bolt'))).toBeNull();
  });

  it('counters the spell it named, leaving the other on the stack', () => {
    const state = stacked(ESSENCE_SCATTER);
    const bear = spellNamed(state, 'Runeclaw Bear').oid;
    const cast = reduce(state, counterAt(state, 'Runeclaw Bear'));
    const resolved = reduce(reduce(cast.state, { type: 'passPriority', player: 1 }).state, {
      type: 'passPriority',
      player: 0,
    });
    expect(resolved.state.objects[bear]?.zone).toBe('graveyard');
    expect(resolved.state.stack.map((entry) => resolved.state.objects[entry.oid]?.card.name)).toEqual([
      'Lightning Bolt',
    ]);
  });
});

describe('a counter that excludes a card type', () => {
  it('is the exact complement on the same stack', () => {
    const state = stacked(NEGATE);
    expect(targetChoicesFor(state, NEGATE, 1)).toEqual([[spellNamed(state, 'Lightning Bolt')]]);
    expect(validateAction(state, counterAt(state, 'Runeclaw Bear'))).toBe('illegal target for effect 0');
  });
});

describe('the unfiltered counter', () => {
  it('still offers every spell on the stack', () => {
    const state = stacked(CANCEL);
    expect(targetChoicesFor(state, CANCEL, 1)).toEqual([
      [spellNamed(state, 'Runeclaw Bear'), spellNamed(state, 'Lightning Bolt')],
    ]);
  });

  /** A permanent is not a spell: no filter reaches off the stack. */
  it('never offers a permanent, filtered or not', () => {
    const state = stacked(ESSENCE_SCATTER);
    const forest = oidOf(state, 'Forest');
    const slots = targetChoicesFor(state, ESSENCE_SCATTER, 1);
    expect(slots[0]?.some((target) => target?.kind === 'permanent' && target.oid === forest)).toBe(false);
  });
});
