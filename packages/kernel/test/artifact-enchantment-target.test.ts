/**
 * `targetArtifactOrEnchantment` in the kernel: the third target space.
 *
 * Every other kind in this vocabulary draws from the creatures on the
 * battlefield or from the seats at the table. This one draws from neither, and
 * the two halves of that have to agree: `targetChoicesForEffects` enumerates
 * the space when the spell is cast, and CR 608.2b rechecks the chosen target
 * against the same restriction as it resolves. They are separate functions in
 * separate files, and a kind wired into one and forgotten in the other is the
 * regression this file exists for — the enumeration offered a Disenchant its
 * artifact, the recheck fell through to the `anyTarget` line, which admits a
 * creature, a player and a planeswalker and refuses an artifact, and the kernel
 * threw `IllegalActionError` on a cast it had just offered.
 *
 * The negative control is a creature on the same board. A test with an artifact
 * alone would pass on a kernel that had ignored the kind and offered every
 * permanent there is.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import {
  IllegalActionError,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  targetChoicesFor,
  validateAction,
} from '@mtg/kernel';
import { PLAINS, artifact, creature, enchantment, instant } from './cards';
import { oidOf } from './helpers';

const SUNDERING_LIGHT = instant(
  'Sundering Light',
  [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }],
  { generic: 1, W: 1 },
);

const BLADE = instant('Sundering Blade', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
  generic: 1,
  W: 1,
});

const MONUMENT = artifact('Bronze Monument');
const BANNER = enchantment('Ward Banner', { W: 1 });
const BEAR = creature('Runeclaw Bear', 2, 2);

/** One of each of the three permanent kinds across the table, and the mana to answer them. */
function opening(spell: typeof SUNDERING_LIGHT): GameState {
  return scenario({
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: MONUMENT, controller: 1 },
      { card: BANNER, controller: 1 },
      { card: BEAR, controller: 1 },
    ],
    hands: [[spell], []],
  }).state;
}

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: string } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

describe('a spell that names an artifact or an enchantment', () => {
  it('offers both of those permanents and neither the creature nor a seat', () => {
    const state = opening(SUNDERING_LIGHT);
    expect(targetChoicesFor(state, SUNDERING_LIGHT, 0)).toEqual([
      [permanentNamed(state, 'Bronze Monument'), permanentNamed(state, 'Ward Banner')],
    ]);
  });

  /** The control, on the identical board: the creature kind offers the creature and nothing else. */
  it('is a different space from the creature kind, on the same board', () => {
    const state = opening(BLADE);
    expect(targetChoicesFor(state, BLADE, 0)).toEqual([[permanentNamed(state, 'Runeclaw Bear')]]);
  });

  /**
   * The recheck, which is the half that was missing. A tuple naming the
   * creature is refused, and refused at `validateAction` rather than only by
   * the enumeration, so the two agree about what this kind means.
   */
  it('refuses a creature the enumeration never offered', () => {
    const state = opening(SUNDERING_LIGHT);
    const oid = playerOf(state, 0).hand[0] ?? '';
    const atCreature: Action = {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [permanentNamed(state, 'Runeclaw Bear')],
    };
    expect(validateAction(state, atCreature)).toBe('illegal target for effect 0');
    expect(() => reduce(state, atCreature)).toThrow(IllegalActionError);

    const atArtifact: Action = {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [permanentNamed(state, 'Bronze Monument')],
    };
    expect(validateAction(state, atArtifact)).toBeNull();
  });

  it('destroys the enchantment it was aimed at and leaves the rest of the board alone', () => {
    const state = opening(SUNDERING_LIGHT);
    const oid = playerOf(state, 0).hand[0] ?? '';
    const cast = reduce(state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [permanentNamed(state, 'Ward Banner')],
    });
    const after = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]).state;

    const names = after.battlefield.map((permanent) => after.objects[permanent]?.card.name);
    expect(names).not.toContain('Ward Banner');
    expect(names).toContain('Bronze Monument');
    expect(names).toContain('Runeclaw Bear');
  });
});
