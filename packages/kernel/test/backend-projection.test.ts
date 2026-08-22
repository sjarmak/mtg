/**
 * `mtg-899w`: the contract's disambiguation reaches a kernel `castSpell` only
 * if the projector hands it the chosen target, not just the spell.
 *
 * `packages/engine/test/labels.test.ts` builds `PendingDecision` and
 * `TableView` by hand to test `labelDecision` in isolation. This file goes the
 * other way: a real `GameState`, built by `scenario()` the way every other
 * kernel test builds one, run through the real `castSpell` enumeration and the
 * real `backend-projection.ts` functions this bead edited — `projectDecision`
 * and `projectState` — so what reaches `labelDecision` is what the backend
 * would actually hand a surface, not a stand-in for it.
 *
 * The board is `mtg-cee`'s own: one Emberflow Raider a side, and a hand
 * holding one Lightning Lash, whose `anyTarget` effect enumerates a cast at
 * each creature and each player. Before this bead's fix, `objectsIn` reported
 * only the spell's own object for every one of those casts, so all four
 * options carried the identical single-element `targets` list `[lash]` and
 * `labelDecision` had nothing to separate them with. After the fix, the two
 * creature-aimed casts carry `[lash, raider]` with different `raider` oids,
 * which is exactly the fact `labelDecision`'s `ASPECTS` reads controller off
 * of.
 *
 * The two player-aimed casts are `mtg-8yk1`, a second bug the same board
 * caught: a player target has no `ObjectId`, so `objectsIn` still reports only
 * `[lash]` for both of them and `MoveOption.targets` still can't separate
 * them — `labelDecision` never gets a chance. `describeAction`
 * (`../src/backend-projection.ts`) closes that one instead, by naming the
 * targeted player straight in `MoveOption.text`, so the two options never
 * collide at `labelDecision`'s first step and `sharedWith` comes back empty
 * without the qualifier machinery ever running.
 */
import { describe, expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { labelDecision } from '@mtg/engine';
import { exampleCard } from '@mtg/dsl';
import type { Action } from '@mtg/kernel';
import { pendingDecision, reduceAll, scenario } from '@mtg/kernel';
import { projectDecision, projectState } from '../src/backend-projection';
import { MOUNTAIN } from './cards';

const TABLE: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'SLC' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
  ],
  seed: 'backend-projection/mtg-cee',
  maximumTurns: 40,
};

describe('backend-projection points a castSpell at what it targets', () => {
  it('separates two Lightning Lash casts aimed at the two players’ Emberflow Raiders', () => {
    const lash = exampleCard('slc-lightning-lash');
    const opened = scenario({
      battlefield: [
        { card: exampleCard('slc-emberflow-raider'), controller: 0 },
        { card: exampleCard('slc-emberflow-raider'), controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[lash], []],
    });

    // Float the mana Lightning Lash costs before asking what is legal:
    // `canPay` reads the pool rather than what the board could produce, the
    // same setup `opponent-target.test.ts` uses for the same reason.
    const mountains = opened.state.battlefield.filter(
      (oid) => opened.state.objects[oid]?.card.name === 'Mountain',
    );
    const floated = reduceAll(
      opened.state,
      mountains.map((oid): Action => ({ type: 'activateManaAbility', player: 0, oid, color: 'R' })),
    );

    const decision = pendingDecision(floated.state);
    if (decision === null) throw new Error('expected a pending decision');
    expect(decision.kind).toBe('priority');

    const raiderOf = (controller: 0 | 1): string => {
      const found = floated.state.battlefield.find(
        (oid) =>
          floated.state.objects[oid]?.card.name === 'Emberflow Raider' &&
          floated.state.objects[oid]?.controller === controller,
      );
      if (found === undefined) throw new Error(`no Emberflow Raider under player ${String(controller)}`);
      return found;
    };
    const northRaider = raiderOf(0);
    const southRaider = raiderOf(1);

    const castAt = (raider: string): number =>
      decision.options.findIndex(
        (action) =>
          action.type === 'castSpell' &&
          action.targets[0] !== null &&
          action.targets[0]?.kind === 'permanent' &&
          action.targets[0].oid === raider,
      );
    const atNorth = castAt(northRaider);
    const atSouth = castAt(southRaider);
    expect(atNorth).toBeGreaterThanOrEqual(0);
    expect(atSouth).toBeGreaterThanOrEqual(0);

    // No `ObjectView` exists for a player target, so `targetedObjects` still
    // has nothing to append for either of these two — asserted here as a fact
    // about the fixture, not the claim under test. `mtg-8yk1` is that they
    // stay separable anyway, through `describeAction`'s text rather than
    // `MoveOption.targets`.
    const castAtPlayer = decision.options.filter(
      (action) => action.type === 'castSpell' && action.targets[0]?.kind === 'player',
    );
    expect(castAtPlayer).toHaveLength(2);

    const castAtSeat = (player: 0 | 1): number =>
      decision.options.findIndex(
        (action) =>
          action.type === 'castSpell' &&
          action.targets[0] !== null &&
          action.targets[0]?.kind === 'player' &&
          action.targets[0].player === player,
      );
    const atPlayer0 = castAtSeat(0);
    const atPlayer1 = castAtSeat(1);
    expect(atPlayer0).toBeGreaterThanOrEqual(0);
    expect(atPlayer1).toBeGreaterThanOrEqual(0);

    const pendingProjection = projectDecision(floated.state, decision);
    const view = projectState(floated.state, TABLE, [0, 1]);
    const labels = labelDecision(pendingProjection, view);

    const northLabel = labels[atNorth];
    const southLabel = labels[atSouth];
    if (northLabel === undefined || southLabel === undefined) throw new Error('expected both labels');

    expect(northLabel.text).not.toBe(southLabel.text);
    expect(northLabel.sharedWith).toEqual([]);
    expect(southLabel.sharedWith).toEqual([]);

    const player0Label = labels[atPlayer0];
    const player1Label = labels[atPlayer1];
    if (player0Label === undefined || player1Label === undefined) {
      throw new Error('expected both player-target labels');
    }

    // `describeAction` names the player, so the two options never collide at
    // `labelDecision`'s first step (`sharedText`) — `sharedWith` comes back
    // empty without its qualifier ever running, which is a stronger claim than
    // the permanent-target pair above gets: those two only separate *after*
    // `qualifyGroup` appends a controller name, these two never enter it.
    expect(player0Label.text).not.toBe(player1Label.text);
    expect(player0Label.sharedWith).toEqual([]);
    expect(player1Label.sharedWith).toEqual([]);
  });
});
