/** Linked entry-player choice and retained damage context for M13 Stuffy Doll. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { DamageInstance, GameState, ObjectId, PlayerId, Trace } from '@mtg/kernel';
import { ActionSchema } from '@mtg/ui';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  stateFingerprint,
} from '@mtg/kernel';
import {
  controlledBy,
  damageToPermanent,
  onlyObject,
  replacement,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { handOidOf } from './helpers';
import { lands, MOUNTAIN } from './cards';

const STUFFY_DOLL = parseCard({
  kind: 'creature',
  id: 'm13-218-stuffy-doll-kernel',
  name: 'Stuffy Doll',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 218 },
  manaCost: { generic: 5 },
  colors: [],
  artifact: true,
  subtypes: ['Construct'],
  power: 0,
  toughness: 1,
  keywords: [],
  keywordAbilities: [{ kind: 'indestructible' }],
  entryReplacement: { kind: 'choosePlayer' },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'triggeringDamageAmount' },
          target: { kind: 'chosenPlayer' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'selfPermanent' } }],
    },
  ],
});

function choosePlayer(state: GameState, chosen: PlayerId): GameState {
  const action = legalActions(state).find(
    (candidate) => candidate.type === 'chooseEntryPlayer' && candidate.chosen === chosen,
  );
  if (action === undefined) throw new Error(`entry did not offer player ${String(chosen)}`);
  return reduce(state, action).state;
}

function entered(chosen: PlayerId = 1): { readonly state: GameState; readonly doll: ObjectId } {
  const start = scenario({ hands: [[STUFFY_DOLL], []] }).state;
  const doll = handOidOf(start, 0, STUFFY_DOLL.name);
  const waiting = moveObject(beginTrace(start), doll, 'battlefield').state;
  return { state: choosePlayer(waiting, chosen), doll };
}

function damage(doll: ObjectId, amount: number): DamageInstance {
  return {
    sourceOid: 'stuffy-test-source',
    controller: 0,
    recipient: { kind: 'permanent', oid: doll },
    amount,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat: false,
  };
}

function fired(trace: Trace): Trace {
  return putTriggersOnStack(trace, collectTriggers(trace, 0));
}

describe('Stuffy Doll entry choice', () => {
  it('requires the entering controller to choose either player before entry', () => {
    const start = scenario({ hands: [[STUFFY_DOLL], []] }).state;
    const doll = handOidOf(start, 0, STUFFY_DOLL.name);
    const waiting = moveObject(beginTrace(start), doll, 'battlefield').state;

    expect(waiting.objects[doll]?.zone).toBe('hand');
    expect(pendingDecision(waiting)).toMatchObject({
      kind: 'entryPlayer',
      player: 0,
      oid: doll,
      options: [
        { type: 'chooseEntryPlayer', chosen: 0 },
        { type: 'chooseEntryPlayer', chosen: 1 },
      ],
      complete: true,
    });
    expect(choosePlayer(waiting, 1).objects[doll]?.chosenPlayer).toBe(1);
  });

  it('clears the link on departure and requires a fresh choice on reentry', () => {
    const first = entered(1);
    const exiled = moveObject(beginTrace(first.state), first.doll, 'exile');
    expect(exiled.state.objects[first.doll]?.chosenPlayer).toBeUndefined();
    const returning = moveObject(exiled, first.doll, 'battlefield').state;
    expect(pendingDecision(returning)).toMatchObject({ kind: 'entryPlayer', oid: first.doll });
    expect(choosePlayer(returning, 0).objects[first.doll]?.chosenPlayer).toBe(0);
  });

  it('survives normal cast resolution and a serialized replay choice deterministically', () => {
    const start = scenario({
      battlefield: lands(MOUNTAIN, 5).map((card) => ({ card, controller: 0 as const })),
      hands: [[STUFFY_DOLL], []],
    }).state;
    const doll = handOidOf(start, 0, STUFFY_DOLL.name);
    const cast = legalActions(start).find((action) => action.type === 'castSpell' && action.oid === doll);
    if (cast === undefined) throw new Error('five Mountains did not make Stuffy Doll castable');

    const casted = reduce(start, cast);
    const firstPass = pendingDecision(casted.state);
    if (firstPass?.kind !== 'priority') throw new Error('caster did not receive post-cast priority');
    const passedOnce = reduce(casted.state, { type: 'passPriority', player: firstPass.player });
    const secondPass = pendingDecision(passedOnce.state);
    if (secondPass?.kind !== 'priority') throw new Error('opponent did not receive priority');
    const waiting = reduce(passedOnce.state, { type: 'passPriority', player: secondPass.player });

    const choice = pendingDecision(waiting.state);
    expect(choice).toMatchObject({
      kind: 'entryPlayer',
      player: 0,
      options: [{ chosen: 0 }, { chosen: 1 }],
    });
    expect(waiting.state.objects[doll]?.zone).not.toBe('battlefield');
    if (choice?.kind !== 'entryPlayer') throw new Error('cast did not pause for its entry player');
    const original = choice.options.find(
      (action) => action.type === 'chooseEntryPlayer' && action.chosen === 1,
    );
    if (original === undefined) throw new Error('opponent was not offered as the entry player');
    const replayed = ActionSchema.parse(JSON.parse(JSON.stringify(original)));
    const fromOriginal = reduce(waiting.state, original);
    const fromReplay = reduce(waiting.state, replayed);

    expect(stateFingerprint(fromReplay.state)).toBe(stateFingerprint(fromOriginal.state));
    expect(fromReplay.state.objects[doll]).toMatchObject({ zone: 'battlefield', chosenPlayer: 1 });

    const damaged = applyDamage(beginTrace(fromReplay.state), [damage(doll, 3)]);
    const stacked = putTriggersOnStack(damaged, collectTriggers(damaged, 0));
    expect(stacked.state.stack.at(-1)?.triggerContext).toEqual({
      kind: 'selfIsDealtDamage',
      triggeringDamageAmount: 3,
      chosenPlayer: 1,
    });
  });
});

describe('Stuffy Doll damage trigger', () => {
  it('deals the final nonzero amount to the chosen player after the source leaves', () => {
    const run = entered(1);
    const damaged = applyDamage(beginTrace(run.state), [damage(run.doll, 3)]);
    const triggers = collectTriggers(damaged, 0);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      condition: 'selfIsDealtDamage',
      triggeringDamageAmount: 3,
      chosenPlayer: 1,
    });
    const stacked = putTriggersOnStack(damaged, triggers);
    const departed = moveObject(stacked, run.doll, 'graveyard');
    const resolved = resolveTop(departed);

    expect(resolved.state.players[1].life).toBe(17);
    expect(eventsOfType(resolved.events, 'damageDealt').at(-1)).toMatchObject({
      amount: 3,
      target: { kind: 'player', player: 1 },
    });
  });

  it('creates one exact trigger per damage event and ignores zero', () => {
    const run = entered(1);
    const damaged = applyDamage(beginTrace(run.state), [damage(run.doll, 2), damage(run.doll, 4)]);
    expect(collectTriggers(damaged, 0).map((trigger) => trigger.triggeringDamageAmount)).toEqual([2, 4]);
    expect(collectTriggers(applyDamage(beginTrace(run.state), [damage(run.doll, 0)]), 0)).toEqual([]);
  });

  it('retains only the final post-replacement amount and full prevention fires nothing', () => {
    const run = entered(1);
    const partial = withReplacements(run.state, [
      replacement(damageToPermanent(run.doll), { kind: 'preventDamage', amount: 1 }),
    ]);
    const dealt = applyDamage(beginTrace(partial), [damage(run.doll, 3)]);
    expect(collectTriggers(dealt, 0)[0]?.triggeringDamageAmount).toBe(2);

    const prevented = withReplacements(run.state, [
      replacement(damageToPermanent(run.doll), { kind: 'preventDamage', amount: 'all' }),
    ]);
    expect(collectTriggers(applyDamage(beginTrace(prevented), [damage(run.doll, 3)]), 0)).toEqual([]);
  });

  it('keeps the chosen player through control changes while the new controller owns the trigger', () => {
    const run = entered(1);
    const stolen = withContinuous(run.state, [controlledBy(onlyObject(run.doll), 1, { ts: 1 })]);
    const damaged = applyDamage(beginTrace(stolen), [damage(run.doll, 1)]);
    expect(collectTriggers(damaged, 0)[0]).toMatchObject({ controller: 1, chosenPlayer: 1 });
  });

  it('its tap ability damages itself and the linked trigger retaliates', () => {
    const run = entered(1);
    const ready = {
      ...run.state,
      objects: {
        ...run.state.objects,
        [run.doll]: { ...run.state.objects[run.doll]!, summoningSick: false },
      },
    };
    const activation = legalActions(ready).find(
      (action) => action.type === 'activateAbility' && action.oid === run.doll,
    );
    if (activation === undefined) throw new Error('Stuffy Doll activation was not legal');
    const activated = reduce(ready, activation);
    const selfDamaged = resolveTop(activated);
    expect(selfDamaged.state.objects[run.doll]?.tapped).toBe(true);
    const resolved = resolveTop(fired(selfDamaged));
    expect(resolved.state.players[1].life).toBe(19);
  });
});
