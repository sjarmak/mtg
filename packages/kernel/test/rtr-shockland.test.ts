/** Native pre-entry life choice shared by the five RTR shocklands. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  moveObjectsToBattlefieldSimultaneously,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  simpleAgent,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { handOidOf } from './helpers';

const BLOOD_CRYPT = parseCard({
  kind: 'land',
  id: 'rtr-blood-crypt',
  name: 'Blood Crypt',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 238 },
  subtypes: ['Swamp', 'Mountain'],
  producesMana: ['B', 'R'],
  printedEntryReference: 'thisLand',
  entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
});

function stoppedEntry(
  options: {
    readonly controller?: 0 | 1;
    readonly life?: readonly [number, number];
    readonly forcedTapped?: boolean;
  } = {},
): {
  readonly state: GameState;
  readonly oid: ObjectId;
  readonly events: ReturnType<typeof beginTrace>['events'];
} {
  const controller = options.controller ?? 0;
  const start = scenario({
    life: options.life ?? [20, 20],
    hands: controller === 0 ? [[BLOOD_CRYPT], []] : [[], [BLOOD_CRYPT]],
  }).state;
  const oid = handOidOf(start, controller, BLOOD_CRYPT.name);
  const stopped = moveObject(beginTrace(start), oid, 'battlefield', {
    controller,
    tapped: options.forcedTapped ?? false,
  });
  return { state: stopped.state, oid, events: stopped.events };
}

function answer(state: GameState, pay: boolean) {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'chooseEntryPayLife' }> =>
      candidate.type === 'chooseEntryPayLife' && candidate.pay === pay,
  );
  if (action === undefined) throw new Error(`shockland did not offer pay=${String(pay)}`);
  return reduce(state, action);
}

describe('shockland entry choice', () => {
  it('asks the entering controller before the land reaches the battlefield', () => {
    const stopped = stoppedEntry({ controller: 1 });

    expect(stopped.state.objects[stopped.oid]?.zone).toBe('hand');
    expect(stopped.state.battlefield).not.toContain(stopped.oid);
    expect(stopped.state.turn.priority).toBeNull();
    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryPayLife',
      player: 1,
      oid: stopped.oid,
      life: 2,
      options: [
        { type: 'chooseEntryPayLife', pay: true },
        { type: 'chooseEntryPayLife', pay: false },
      ],
      complete: true,
    });
  });

  it('enters untapped after payment and records life loss before entry', () => {
    const stopped = stoppedEntry();
    const paid = answer(stopped.state, true);

    expect(playerOf(paid.state, 0).life).toBe(18);
    expect(paid.state.objects[stopped.oid]).toMatchObject({ zone: 'battlefield', tapped: false });
    expect(eventsOfType(paid.events, 'lifeChanged')).toEqual([
      { type: 'lifeChanged', player: 0, life: 18, delta: -2, reason: 'lifeLoss' },
    ]);
    expect(paid.events.map((event) => event.type).indexOf('lifeChanged')).toBeLessThan(
      paid.events.map((event) => event.type).indexOf('zoneChanged'),
    );
  });

  it('enters tapped without payment and records the intrinsic replacement', () => {
    const stopped = stoppedEntry();
    const declined = answer(stopped.state, false);

    expect(playerOf(declined.state, 0).life).toBe(20);
    expect(declined.state.objects[stopped.oid]).toMatchObject({ zone: 'battlefield', tapped: true });
    expect(eventsOfType(declined.events, 'replacementApplied').map((event) => event.id)).toContain(
      `intrinsic:${stopped.oid}:entry`,
    );
  });

  it('offers only decline when the controller cannot pay', () => {
    const stopped = stoppedEntry({ life: [1, 20] });

    expect(pendingDecision(stopped.state)?.options).toEqual([
      { type: 'chooseEntryPayLife', player: 0, oid: stopped.oid, life: 2, pay: false },
    ]);
  });

  it('allows paying the last life and does not undo an external tapped entry', () => {
    const exact = stoppedEntry({ life: [2, 20] });
    expect(
      simpleAgent('shockland').decide({
        state: observeState(exact.state, 0, 'test/rtr-shockland.test.ts:124'),
        player: 0,
        decision: pendingDecision(exact.state)!,
      }),
    ).toMatchObject({ type: 'chooseEntryPayLife', pay: false });
    const paidExact = answer(exact.state, true);
    expect(playerOf(paidExact.state, 0).life).toBe(0);
    expect(paidExact.state.objects[exact.oid]?.zone).toBe('battlefield');

    const forced = stoppedEntry({ forcedTapped: true });
    expect(
      simpleAgent('shockland').decide({
        state: observeState(forced.state, 0, 'test/rtr-shockland.test.ts:136'),
        player: 0,
        decision: pendingDecision(forced.state)!,
      }),
    ).toMatchObject({ type: 'chooseEntryPayLife', pay: false });
    const paidForced = answer(forced.state, true);
    expect(playerOf(paidForced.state, 0).life).toBe(18);
    expect(paidForced.state.objects[forced.oid]?.tapped).toBe(true);
  });

  it('uses the land-play path and preserves the printed subtype and mana choices', () => {
    const start = scenario({ hands: [[BLOOD_CRYPT], []] }).state;
    const oid = handOidOf(start, 0, BLOOD_CRYPT.name);
    const stopped = reduce(start, { type: 'playLand', player: 0, oid });

    expect(stopped.state.turn.landsPlayed).toBe(1);
    expect(stopped.state.objects[oid]?.zone).toBe('hand');
    expect(pendingDecision(stopped.state)).toMatchObject({ kind: 'entryPayLife', oid });

    const paid = answer(stopped.state, true);
    expect(paid.state.objects[oid]?.card.subtypes).toEqual(['Swamp', 'Mountain']);
    expect(
      legalActions(paid.state).flatMap((action) =>
        action.type === 'activateManaAbility' && action.oid === oid ? [action.color] : [],
      ),
    ).toEqual(['B', 'R']);
  });

  it('applies on a non-hand entry and rejects a forged payment amount', () => {
    const start = scenario({ graveyards: [[BLOOD_CRYPT], []] }).state;
    const oid = start.players[0].graveyard[0];
    if (oid === undefined) throw new Error('missing graveyard shockland');
    const stopped = moveObject(beginTrace(start), oid, 'battlefield');

    expect(stopped.state.objects[oid]?.zone).toBe('graveyard');
    expect(
      validateAction(stopped.state, {
        type: 'chooseEntryPayLife',
        player: 0,
        oid,
        life: 3,
        pay: true,
      }),
    ).toContain('life payment');
    expect(answer(stopped.state, false).state.objects[oid]).toMatchObject({
      zone: 'battlefield',
      tapped: true,
    });
  });

  it('collects simultaneous choices in APNAP order before committing either entry', () => {
    const start = scenario({
      active: 0,
      life: [2, 2],
      graveyards: [[BLOOD_CRYPT], [BLOOD_CRYPT]],
    }).state;
    const activeLand = start.players[0].graveyard[0];
    const nonactiveLand = start.players[1].graveyard[0];
    if (activeLand === undefined || nonactiveLand === undefined) {
      throw new Error('missing simultaneous shocklands');
    }
    const firstStop = moveObjectsToBattlefieldSimultaneously(beginTrace(start), [
      { oid: nonactiveLand },
      { oid: activeLand },
    ]);

    expect(pendingDecision(firstStop.state)).toMatchObject({
      kind: 'entryPayLife',
      player: 0,
      oid: activeLand,
    });
    const secondStop = answer(firstStop.state, true);
    expect(playerOf(secondStop.state, 0).life).toBe(0);
    expect(secondStop.state.result).toBeNull();
    expect(secondStop.state.battlefield).toEqual([]);
    expect(pendingDecision(secondStop.state)).toMatchObject({
      kind: 'entryPayLife',
      player: 1,
      oid: nonactiveLand,
    });

    const entered = answer(secondStop.state, false);
    expect(entered.state.battlefield).toEqual([activeLand, nonactiveLand]);
    expect(entered.state.objects[activeLand]).toMatchObject({ tapped: false, zone: 'battlefield' });
    expect(entered.state.objects[nonactiveLand]).toMatchObject({ tapped: true, zone: 'battlefield' });
  });
});
