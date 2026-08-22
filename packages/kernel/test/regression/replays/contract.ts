/**
 * The one defect in what the kernel hands `@mtg/engine`'s neutral contract.
 *
 * `81ac4f6` (`mtg-899w`): `objectsIn` returned `[action.oid]` for a `castSpell`
 * and an `activateAbility` and nothing at all for `chooseTriggerTargets`, so
 * `MoveOption.targets` named the spell rather than the creature it was aimed
 * at. Two casts of the same removal at two different creatures reached the
 * contract carrying identical targets, and that field is the one thing
 * `labelDecision` compares, so every kernel cast landed in its residue instead
 * of its repair.
 *
 * `backend-projection.test.ts` is the fuller treatment, including the second
 * bug the same board caught (a player target has no `ObjectView`, so
 * `describeAction` names the seat instead). What is here is the property that
 * separates the fixed projector from the broken one, taken end to end through a
 * real enumeration rather than through hand-built contract values.
 */
import { expect } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { labelDecision } from '@mtg/engine';
import { exampleCard } from '@mtg/dsl';
import type { Action, GameState, ObjectId } from '@mtg/kernel';
import { pendingDecision, reduceAll, scenario } from '@mtg/kernel';
import { projectDecision, projectState } from '../../../src/backend-projection';
import { MOUNTAIN } from '../../cards';
import { replay } from '../bank';

const TABLE: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'SLC' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
  ],
  seed: 'regression/mtg-899w',
  maximumTurns: 40,
};

function raiderOf(state: GameState, controller: 0 | 1): ObjectId {
  const found = state.battlefield.find(
    (oid) =>
      state.objects[oid]?.card.name === 'Emberflow Raider' && state.objects[oid]?.controller === controller,
  );
  if (found === undefined) throw new Error(`no Emberflow Raider under player ${String(controller)}`);
  return found;
}

export const CONTRACT_REPLAYS = [
  replay(
    '81ac4f6',
    'a projected move points at what it targets, so two casts of one removal spell reach the contract distinguishable',
    () => {
      // `mtg-cee`'s own board: one Emberflow Raider a side and one Lightning
      // Lash in hand, whose `anyTarget` effect enumerates a cast at each
      // creature and each player.
      const opened = scenario({
        battlefield: [
          { card: exampleCard('slc-emberflow-raider'), controller: 0 },
          { card: exampleCard('slc-emberflow-raider'), controller: 1 },
          { card: MOUNTAIN, controller: 0 },
          { card: MOUNTAIN, controller: 0 },
        ],
        hands: [[exampleCard('slc-lightning-lash')], []],
      });
      // Float the mana first: `canPay` reads the pool rather than what the
      // board could produce.
      const floated = reduceAll(
        opened.state,
        opened.state.battlefield
          .filter((oid) => opened.state.objects[oid]?.card.name === 'Mountain')
          .map((oid): Action => ({ type: 'activateManaAbility', player: 0, oid, color: 'R' })),
      );

      const decision = pendingDecision(floated.state);
      if (decision === null) throw new Error('expected a pending decision');
      const north = raiderOf(floated.state, 0);
      const south = raiderOf(floated.state, 1);
      const castAt = (raider: ObjectId): number =>
        decision.options.findIndex(
          (action) =>
            action.type === 'castSpell' &&
            action.targets[0]?.kind === 'permanent' &&
            action.targets[0].oid === raider,
        );
      const atNorth = castAt(north);
      const atSouth = castAt(south);
      expect(atNorth).toBeGreaterThanOrEqual(0);
      expect(atSouth).toBeGreaterThanOrEqual(0);

      const projected = projectDecision(floated.state, decision);
      const northMove = projected.options[atNorth];
      const southMove = projected.options[atSouth];
      if (northMove === undefined || southMove === undefined) throw new Error('expected both moves');

      // The property: each move points at the creature it is aimed at, so the
      // two lists are not the same list. The pre-fix projector reported only
      // the spell's own object for both, which is the identity that swallowed
      // the distinction.
      expect(northMove.targets.map((target) => target.oid)).toContain(north);
      expect(southMove.targets.map((target) => target.oid)).toContain(south);
      expect(northMove.targets).not.toEqual(southMove.targets);

      // And the consumer separates them, which is what the field is for.
      // `labelDecision` is the only thing that reads `MoveOption.targets`, so a
      // projector change that satisfied the lines above without reaching the
      // label would be a field nobody could use.
      const labels = labelDecision(projected, projectState(floated.state, TABLE, [0, 1]));
      const northLabel = labels[atNorth];
      const southLabel = labels[atSouth];
      if (northLabel === undefined || southLabel === undefined) throw new Error('expected both labels');
      expect(northLabel.text).not.toBe(southLabel.text);
      expect(northLabel.sharedWith).toEqual([]);
      expect(southLabel.sharedWith).toEqual([]);
    },
  ),
];
