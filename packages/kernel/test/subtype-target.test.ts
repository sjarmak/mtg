/**
 * A subtype on the target slot, in the kernel: "untap target Forest" and
 * "target Merfolk creature", against boards that hold the wrong ones too.
 *
 * `mtg-nhyv.56`. The DSL half of this is one optional field; the kernel half is
 * one line in `targetObjectFilter`, and that is the whole argument for
 * `TargetFilter` being a subset of `ObjectFilter` rather than a filter type of
 * its own. `ObjectFilter.subtypes` already existed, `matchesFilter` already read
 * it with `anyOf`, and `printedCharacteristics` already folds a basic land's
 * `basicLandType` in beside its printed subtypes (CR 205.3i) — so a spell that
 * says Forest and an anthem that says Merfolk are answered by one function and
 * cannot come to different conclusions about one body.
 *
 * Both moments are asserted, for `filtered-target.test.ts`'s reason:
 * `targetChoicesForEffects` enumerates the slot as the spell goes on the stack
 * (CR 601.2c) and `isTargetStillLegal` rechecks it as the spell resolves (CR
 * 608.2b), those are separate functions in separate files, and a dimension
 * wired into one and forgotten in the other is a kernel that offers a move and
 * then throws on it.
 *
 * The land case is the one that is about something other than the filter
 * machinery. A Forest carries no printed `subtypes` at all in this DSL — it
 * carries `basicLandType: 'Forest'` — so a kernel that read the printed list
 * literally would offer nothing, and the Mountain on every board is what says
 * the filter is doing the work rather than the board being one land deep.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { IllegalActionError, reduce, scenario, targetChoicesFor, validateAction } from '@mtg/kernel';
import { FOREST, ISLAND, MOUNTAIN, SWAMP, creature, instant } from './cards';
import { oidOf } from './helpers';

/** Arbor Elf's line as a spell, so one cast exercises the slot. (M11) */
const ROOTWAY_SIGNAL = instant(
  'Rootway Signal',
  [{ kind: 'untapPermanent', target: { kind: 'targetPermanent', filter: { subtypes: ['Forest'] } } }],
  { generic: 1 },
);

/** Merfolk Sovereign's slot, on a primitive this vocabulary can already run. */
const TIDE_SIGNAL = instant(
  'Tide Signal',
  [{ kind: 'tapPermanent', target: { kind: 'targetCreature', filter: { subtypes: ['Merfolk'] } } }],
  { U: 1 },
);

const SCOUT = creature('Reedwater Scout', 1, 1, { subtypes: ['Merfolk'] });
const HERALD = creature('Reedwater Herald', 2, 2, { subtypes: ['Merfolk', 'Noble'] });
const OGRE = creature('Cragside Ogre', 3, 3, { subtypes: ['Ogre'] });

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: string } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

/** The one slot this spell has, as the kernel offers it. */
function onlySlot(state: GameState, spell: Card): readonly unknown[] {
  const slots = targetChoicesFor(state, spell, 0);
  expect(slots).toHaveLength(1);
  return slots[0] ?? [];
}

function castAt(state: GameState, name: string): Action {
  return {
    type: 'castSpell',
    player: 0,
    oid: state.players[0].hand[0] ?? '',
    targets: [permanentNamed(state, name)],
  };
}

describe('a land type on the widest object space', () => {
  function board(): GameState {
    return scenario({
      battlefield: [
        { card: FOREST, controller: 0, tapped: true },
        { card: MOUNTAIN, controller: 0 },
        { card: SWAMP, controller: 1, tapped: true },
        { card: OGRE, controller: 1 },
      ],
      hands: [[ROOTWAY_SIGNAL], []],
    }).state;
  }

  it('offers the Forest and not the other lands beside it', () => {
    const state = board();
    expect(onlySlot(state, ROOTWAY_SIGNAL)).toEqual([permanentNamed(state, 'Forest')]);
  });

  it('refuses the Swamp the enumeration left out, at validation and at reduce', () => {
    const state = board();
    expect(validateAction(state, castAt(state, 'Swamp'))).toBe('illegal target for effect 0');
    expect(() => reduce(state, castAt(state, 'Swamp'))).toThrow(IllegalActionError);
    expect(validateAction(state, castAt(state, 'Forest'))).toBeNull();
  });

  it('untaps the Forest it named', () => {
    const state = board();
    let current = reduce(state, castAt(state, 'Forest')).state;
    for (let guard = 0; guard < 4 && current.stack.length > 0; guard += 1) {
      const priority = current.turn.priority;
      if (priority === null) break;
      current = reduce(current, { type: 'passPriority', player: priority }).state;
    }
    expect(current.objects[oidOf(current, 'Forest')]?.tapped).toBe(false);
    expect(current.objects[oidOf(current, 'Swamp')]?.tapped).toBe(true);
  });
});

describe('a creature type on a slot whose noun the kind already fixed', () => {
  function board(): GameState {
    return scenario({
      battlefield: [
        { card: SCOUT, controller: 1 },
        { card: HERALD, controller: 1 },
        { card: OGRE, controller: 1 },
        { card: FOREST, controller: 1 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[TIDE_SIGNAL], []],
    }).state;
  }

  it('offers every creature carrying the type, one of them carrying two', () => {
    const state = board();
    expect(onlySlot(state, TIDE_SIGNAL)).toEqual([
      permanentNamed(state, 'Reedwater Scout'),
      permanentNamed(state, 'Reedwater Herald'),
    ]);
  });

  it('refuses the creature that carries a different type', () => {
    const state = board();
    expect(validateAction(state, castAt(state, 'Cragside Ogre'))).toBe('illegal target for effect 0');
    expect(validateAction(state, castAt(state, 'Reedwater Herald'))).toBeNull();
  });
});
