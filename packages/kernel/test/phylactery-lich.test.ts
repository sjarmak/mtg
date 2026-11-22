/** Phylactery Lich through entry choice, copied values, and CR 603.8 state triggers. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  characteristicsOf,
  counterCount,
  destroyPermanent,
  eventsOfType,
  moveObject,
  pendingDecision,
  reduce,
  resolveTop,
  scenario,
  setCounterCount,
  settle,
  stateFingerprint,
  updateObject,
} from '@mtg/kernel';
import { artifact, creature, ISLAND, SWAMP } from './cards';
import { controlledBy, onlyObject, withContinuous } from './continuous-helpers';
import { handOidOf, oidOf, oidsOf } from './helpers';

const PHYLACTERY_LICH = parseCard({
  kind: 'creature',
  id: 'm11-phylactery-lich',
  name: 'Phylactery Lich',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 110 },
  manaCost: { B: 3 },
  colors: ['B'],
  subtypes: ['Zombie'],
  power: 5,
  toughness: 5,
  keywordAbilities: [{ kind: 'indestructible' }],
  entryReplacement: {
    kind: 'putCounterOnControlledPermanent',
    permanentType: 'artifact',
    counter: 'phylactery',
    count: 1,
  },
  abilities: [
    {
      kind: 'stateTriggered',
      condition: { kind: 'controllerControlsNoPermanentWithCounter', counter: 'phylactery' },
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    },
  ],
});

const CLONE = parseCard({
  kind: 'creature',
  id: 'm11-clone-probe',
  name: 'Clone Probe',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 49 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

const RELIC = artifact('Phylactery Relic');
const RIVAL_RELIC = artifact('Rival Relic');
const ARTIFACT_CREATURE = creature('Steel Bear', 2, 2, { artifact: true });
const ORDINARY_CREATURE = creature('Ordinary Bear', 2, 2);

function lands(card: typeof SWAMP | typeof ISLAND, count: number, controller: 0 | 1) {
  return Array.from({ length: count }, () => ({ card, controller }));
}

function castToEntryStop(state: GameState, player: 0 | 1, name: string): ReduceResult {
  const oid = handOidOf(state, player, name);
  const action = pendingDecision(state)?.options.find(
    (candidate) => candidate.type === 'castSpell' && candidate.oid === oid,
  );
  if (action === undefined) throw new Error(`${name} was not castable`);
  let current = reduce(state, action);
  for (let index = 0; index < 2; index += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`${name} did not resolve through priority`);
    current = reduce(current.state, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function chooseEntryCounter(state: GameState, permanent: ObjectId): ReduceResult {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'entryCounter') throw new Error('entry counter choice was not pending');
  const action = decision.options.find(
    (candidate) => candidate.type === 'chooseEntryCounterPermanent' && candidate.permanent === permanent,
  );
  if (action === undefined) throw new Error('chosen permanent was not offered');
  return reduce(state, action);
}

function protectedBoard(extraHands: readonly (typeof PHYLACTERY_LICH | typeof CLONE)[] = []): {
  readonly state: GameState;
  readonly lich: ObjectId;
  readonly relic: ObjectId;
} {
  const start = scenario({
    battlefield: [{ card: RELIC, controller: 0 }, ...lands(SWAMP, 6, 0), ...lands(ISLAND, 4, 0)],
    hands: [[PHYLACTERY_LICH, ...extraHands], []],
  }).state;
  const relic = oidOf(start, RELIC.name);
  const entered = chooseEntryCounter(castToEntryStop(start, 0, PHYLACTERY_LICH.name).state, relic).state;
  return { state: entered, lich: oidOf(entered, PHYLACTERY_LICH.name), relic };
}

function removePhylacteryCounter(state: GameState, oid: ObjectId): GameState {
  return updateObject(state, oid, (object) => ({
    ...object,
    counters: setCounterCount(object.counters, 'phylactery', 0),
  }));
}

describe('Phylactery Lich entry replacement (mtg-nhyv.130)', () => {
  it('offers only artifacts controlled by the entering permanent controller', () => {
    const start = scenario({
      battlefield: [
        { card: RELIC, controller: 0 },
        { card: ARTIFACT_CREATURE, controller: 0 },
        { card: ORDINARY_CREATURE, controller: 0 },
        { card: RIVAL_RELIC, controller: 1 },
        ...lands(SWAMP, 3, 0),
      ],
      hands: [[PHYLACTERY_LICH], []],
    }).state;
    const stopped = castToEntryStop(start, 0, PHYLACTERY_LICH.name);
    const relic = oidOf(stopped.state, RELIC.name);
    const steelBear = oidOf(stopped.state, ARTIFACT_CREATURE.name);

    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryCounter',
      player: 0,
      permanents: [relic, steelBear],
      complete: true,
    });
    const entered = chooseEntryCounter(stopped.state, steelBear);
    expect(counterCount(entered.state.objects[steelBear]!.counters, 'phylactery')).toBe(1);
    expect(entered.state.objects[oidOf(entered.state, PHYLACTERY_LICH.name)]?.zone).toBe('battlefield');
  });

  it('enters without a legal artifact and immediately fires exactly one sacrifice trigger', () => {
    const start = scenario({
      battlefield: [...lands(SWAMP, 3, 0)],
      hands: [[PHYLACTERY_LICH], []],
    }).state;
    const entered = castToEntryStop(start, 0, PHYLACTERY_LICH.name);
    const lich = oidOf(entered.state, PHYLACTERY_LICH.name);

    expect(pendingDecision(entered.state)?.kind).toBe('priority');
    expect(entered.state.stack.filter((entry) => entry.ability?.sourceOid === lich)).toHaveLength(1);
    const resolved = settle(resolveTop(beginTrace(entered.state)));
    expect(resolved.state.objects[lich]?.zone).toBe('graveyard');
    expect(eventsOfType(resolved.events, 'permanentSacrificed')).toEqual([
      expect.objectContaining({ oid: lich, player: 0 }),
    ]);
  });

  it('survives destruction but fires when its only phylactery counter is removed', () => {
    const { state, lich, relic } = protectedBoard();
    expect(destroyPermanent(beginTrace(state), lich, 'destroyEffect').state.objects[lich]?.zone).toBe(
      'battlefield',
    );

    const triggered = settle(beginTrace(removePhylacteryCounter(state, relic)));
    expect(triggered.state.stack.filter((entry) => entry.ability?.sourceOid === lich)).toHaveLength(1);
    const checkedAgain = settle(beginTrace(triggered.state));
    expect(checkedAgain.state.stack.filter((entry) => entry.ability?.sourceOid === lich)).toHaveLength(1);
  });

  it('fires when the counter-bearing artifact leaves the battlefield', () => {
    const { state, lich, relic } = protectedBoard();
    const gone = settle(moveObject(beginTrace(state), relic, 'graveyard'));

    expect(gone.state.objects[relic]?.zone).toBe('graveyard');
    expect(gone.state.stack.filter((entry) => entry.ability?.sourceOid === lich)).toHaveLength(1);
  });

  it('reads current control rather than ownership for the counter bearer and the Lich', () => {
    const { state, lich, relic } = protectedBoard();
    const relicStolen = withContinuous(state, [controlledBy(onlyObject(relic), 1)]);
    const fired = settle(beginTrace(relicStolen));
    expect(fired.state.stack.some((entry) => entry.ability?.sourceOid === lich)).toBe(true);

    const lichStolen = withContinuous(state, [controlledBy(onlyObject(lich), 1)]);
    const opponentTrigger = settle(beginTrace(lichStolen));
    expect(opponentTrigger.state.stack.find((entry) => entry.ability?.sourceOid === lich)?.controller).toBe(
      1,
    );
  });

  it('copies both entry and state-triggered characteristics through Clone', () => {
    const { state, lich, relic } = protectedBoard([CLONE]);
    const copyStop = castToEntryStop(state, 0, CLONE.name);
    const copyAction = pendingDecision(copyStop.state)?.options.find(
      (candidate) => candidate.type === 'chooseEntryCopy' && candidate.copyOf === lich,
    );
    if (copyAction === undefined) throw new Error('Clone did not offer Phylactery Lich');
    const counterStop = reduce(copyStop.state, copyAction);
    expect(pendingDecision(counterStop.state)).toMatchObject({ kind: 'entryCounter' });

    const copied = chooseEntryCounter(counterStop.state, relic).state;
    expect(counterCount(copied.objects[relic]!.counters, 'phylactery')).toBe(2);
    expect(
      copied.battlefield.filter((oid) => characteristicsOf(copied, oid).name === PHYLACTERY_LICH.name),
    ).toHaveLength(2);
    const oneCounter = updateObject(copied, relic, (object) => ({
      ...object,
      counters: setCounterCount(object.counters, 'phylactery', 1),
    }));
    expect(settle(beginTrace(oneCounter)).state.stack).toHaveLength(0);
  });

  it('does not let an old-incarnation trigger sacrifice a protected return', () => {
    const { state, lich, relic } = protectedBoard();
    const fired = settle(beginTrace(removePhylacteryCounter(state, relic)));
    const oldIncarnation = fired.state.objects[lich]?.incarnation;
    const exiled = moveObject(fired, lich, 'exile');
    const returnStop = moveObject(exiled, lich, 'battlefield');
    const returned = chooseEntryCounter(returnStop.state, relic).state;
    expect(returned.objects[lich]?.incarnation).not.toBe(oldIncarnation);

    const resolvedOld = settle(resolveTop(beginTrace(returned)));
    expect(resolvedOld.state.objects[lich]?.zone).toBe('battlefield');
    expect(counterCount(resolvedOld.state.objects[relic]!.counters, 'phylactery')).toBe(1);
  });

  it('fires once per Lich for a simultaneous loss and replays deterministically', () => {
    const { state: first, relic } = protectedBoard([PHYLACTERY_LICH]);
    const secondStop = castToEntryStop(first, 0, PHYLACTERY_LICH.name);
    const two = chooseEntryCounter(secondStop.state, relic).state;
    const unprotected = removePhylacteryCounter(two, relic);

    const settled = settle(beginTrace(unprotected));
    const replayed = settle(beginTrace(structuredClone(unprotected)));
    const triggers = settled.state.stack.filter((entry) => entry.ability !== null);
    expect(triggers).toHaveLength(2);
    expect(new Set(triggers.map((entry) => entry.ability?.sourceOid))).toEqual(
      new Set(oidsOf(settled.state, PHYLACTERY_LICH.name)),
    );
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(settled.state));
  });
});
