/**
 * CR 613: the layer system.
 *
 * Every case here has an answer the comprehensive rules fix independently of
 * this implementation, which is the only kind of test worth writing for a
 * subsystem whose whole difficulty is ordering.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '@mtg/kernel';
import {
  beginTrace,
  characteristicsOf,
  checkStateBasedActions,
  controlledBy,
  controllerOf,
  creaturesControlledBy,
  creaturesOnBattlefield,
  effectsApplyingTo,
  eventsOfType,
  getObject,
  hasCardType,
  hasKeyword,
  isCreatureObject,
  LAYER_ORDER,
  objectFilter,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { artifact, creature, FOREST } from './cards';
import { oidOf } from './helpers';
import {
  abilities,
  battlefieldCount,
  controlledBy as controlChange,
  copies,
  definePt,
  onlyObject,
  pump,
  recolor,
  retype,
  rewriteSubtype,
  setPt,
  switchPt,
  withContinuous,
  withCounters,
  withSubtype,
} from './continuous-helpers';

const bear = creature('Layer Bear', 2, 2, { subtypes: ['Bear'] });
const hawk = creature('Layer Hawk', 1, 1, { keywords: ['flying'], subtypes: ['Bird'] });
const dragon = creature('Layer Dragon', 5, 5, { keywords: ['flying', 'trample'], subtypes: ['Dragon'] });
const idol = artifact('Layer Idol');

function board(): { state: GameState; bearOid: ObjectId } {
  const start = scenario({
    battlefield: [
      { card: bear, controller: 0 },
      { card: hawk, controller: 0 },
      { card: idol, controller: 0 },
      { card: dragon, controller: 1 },
      { card: FOREST, controller: 0 },
    ],
  });
  return { state: start.state, bearOid: oidOf(start.state, 'Layer Bear') };
}

describe('CR 613 layer order', () => {
  it('is the fixed 1-7e sequence and is never reordered', () => {
    expect([...LAYER_ORDER]).toEqual(['1', '2', '3', '4', '5', '6', '7a', '7b', '7c', '7d', '7e']);
  });

  it('runs base P/T, then a pump, then counters, then the switch', () => {
    // 2/2 printed; 7b sets 4/1; 7c adds +2/+0 -> 6/1; 7d adds a +1/+1 counter
    // -> 7/2; 7e switches -> 2/7.
    const { state, bearOid } = board();
    const withEffects = withContinuous(withCounters(state, bearOid, 'plusOnePlusOne', 1), [
      setPt(onlyObject(bearOid), 4, 1, { ts: 1 }),
      pump(onlyObject(bearOid), 2, 0, { ts: 2 }),
      switchPt(onlyObject(bearOid), { ts: 3 }),
    ]);
    expect(powerOf(withEffects, bearOid)).toBe(2);
    expect(toughnessOf(withEffects, bearOid)).toBe(7);

    // The printed card is untouched: characteristics are derived, never stored.
    const card = getObject(withEffects, bearOid).card;
    expect(card.kind === 'creature' ? [card.power, card.toughness] : []).toEqual([2, 2]);
  });

  it('applies a later set-P/T over an earlier one, and reverses when the timestamps do', () => {
    const { state, bearOid } = board();
    const early = withContinuous(state, [
      setPt(onlyObject(bearOid), 5, 5, { ts: 1 }),
      setPt(onlyObject(bearOid), 1, 1, { ts: 2 }),
    ]);
    expect([powerOf(early, bearOid), toughnessOf(early, bearOid)]).toEqual([1, 1]);

    const late = withContinuous(state, [
      setPt(onlyObject(bearOid), 1, 1, { ts: 1 }),
      setPt(onlyObject(bearOid), 5, 5, { ts: 2 }),
    ]);
    expect([powerOf(late, bearOid), toughnessOf(late, bearOid)]).toEqual([5, 5]);
  });

  it('adds a pump on top of a set, whatever the timestamps say (7b before 7c)', () => {
    // The pump has the *earlier* timestamp, but layer 7c is applied after 7b
    // regardless: 2/2 -> set 3/3 -> +1/+1 = 4/4, not "pump then overwrite".
    const { state, bearOid } = board();
    const withEffects = withContinuous(state, [
      pump(onlyObject(bearOid), 1, 1, { ts: 1 }),
      setPt(onlyObject(bearOid), 3, 3, { ts: 2 }),
    ]);
    expect([powerOf(withEffects, bearOid), toughnessOf(withEffects, bearOid)]).toEqual([4, 4]);
  });

  it('grants an ability in layer 6 to a permanent layer 4 only just made a creature', () => {
    // The grant has the earlier timestamp; the type change has the later one.
    // Layer 4 still runs first, so the animated artifact gets flying.
    const { state } = board();
    const idolOid = oidOf(state, 'Layer Idol');
    const withEffects = withContinuous(state, [
      abilities(objectFilter({ cardTypes: ['creature'] }), { add: ['flying'] }, { ts: 1 }),
      retype(onlyObject(idolOid), { addTypes: ['creature'] }, { ts: 2 }),
      setPt(onlyObject(idolOid), 3, 3, { ts: 3 }),
    ]);
    expect(isCreatureObject(withEffects, idolOid)).toBe(true);
    expect(hasCardType(withEffects, idolOid, 'artifact')).toBe(true);
    expect(hasKeyword(withEffects, idolOid, 'flying')).toBe(true);
    expect(powerOf(withEffects, idolOid)).toBe(3);
    expect(creaturesOnBattlefield(withEffects).map((object) => object.oid)).toContain(idolOid);
  });

  it('feeds the state-based actions: an animated land with 0 toughness dies', () => {
    const { state } = board();
    const forestOid = oidOf(state, 'Forest');
    const withEffects = withContinuous(state, [retype(onlyObject(forestOid), { addTypes: ['creature'] })]);
    const settled = checkStateBasedActions(beginTrace(withEffects));
    expect(getObject(settled.state, forestOid).zone).toBe('graveyard');
    expect(eventsOfType(settled.events, 'permanentDestroyed')[0]?.reason).toBe('zeroToughness');
  });

  it('applies removal and grants inside layer 6 in timestamp order, both ways round', () => {
    const { state } = board();
    const hawkOid = oidOf(state, 'Layer Hawk');
    const all = objectFilter({ cardTypes: ['creature'] });

    const grantThenStrip = withContinuous(state, [
      abilities(all, { add: ['vigilance'] }, { ts: 1 }),
      abilities(all, { removeAll: true }, { ts: 2 }),
    ]);
    expect(characteristicsOf(grantThenStrip, hawkOid).keywords).toEqual([]);

    const stripThenGrant = withContinuous(state, [
      abilities(all, { removeAll: true }, { ts: 1 }),
      abilities(all, { add: ['vigilance'] }, { ts: 2 }),
    ]);
    expect(characteristicsOf(stripThenGrant, hawkOid).keywords).toEqual(['vigilance']);
  });

  it('copies printed values in layer 1 without copying control', () => {
    const { state, bearOid } = board();
    const dragonOid = oidOf(state, 'Layer Dragon');
    const withEffects = withContinuous(state, [copies(onlyObject(bearOid), dragonOid)]);
    const copied = characteristicsOf(withEffects, bearOid);
    expect([copied.power, copied.toughness]).toEqual([5, 5]);
    expect(copied.name).toBe('Layer Dragon');
    expect(copied.keywords).toEqual(['flying', 'trample']);
    expect(copied.controller).toBe(0);
    expect(controllerOf(withEffects, dragonOid)).toBe(1);
  });

  it('changes control in layer 2, and every control-sensitive read follows', () => {
    const { state, bearOid } = board();
    const withEffects = withContinuous(state, [controlChange(onlyObject(bearOid), 1)]);
    expect(controllerOf(withEffects, bearOid)).toBe(1);
    expect(controlledBy(withEffects, 1)).toContain(bearOid);
    expect(creaturesControlledBy(withEffects, 1).map((object) => object.oid)).toContain(bearOid);
    expect(creaturesControlledBy(withEffects, 0).map((object) => object.oid)).not.toContain(bearOid);
  });

  it('rewrites a subtype in layer 3 before layer 6 reads it', () => {
    const { state, bearOid } = board();
    const withEffects = withContinuous(state, [
      abilities(withSubtype('Zombie'), { add: ['menace'] }, { ts: 1 }),
      rewriteSubtype(onlyObject(bearOid), 'Bear', 'Zombie', { ts: 2 }),
    ]);
    expect(characteristicsOf(withEffects, bearOid).subtypes).toEqual(['Zombie']);
    expect(hasKeyword(withEffects, bearOid, 'menace')).toBe(true);
  });

  it('sets color in layer 5, and a color filter in layer 6 sees the new color', () => {
    const { state, bearOid } = board();
    const withEffects = withContinuous(state, [
      abilities(objectFilter({ colors: ['U'] }), { add: ['flying'] }, { ts: 1 }),
      recolor(onlyObject(bearOid), ['U'], [], { ts: 2 }),
    ]);
    expect(characteristicsOf(withEffects, bearOid).colors).toEqual(['U']);
    expect(hasKeyword(withEffects, bearOid, 'flying')).toBe(true);
  });

  it('reports which effects applied to an object, in application order', () => {
    const { state, bearOid } = board();
    const withEffects = withContinuous(state, [
      pump(onlyObject(bearOid), 1, 1, { id: 'pump', ts: 5 }),
      setPt(onlyObject(bearOid), 3, 3, { id: 'set', ts: 6 }),
      pump(withSubtype('Dragon'), 9, 9, { id: 'elsewhere', ts: 7 }),
    ]);
    expect(effectsApplyingTo(withEffects, bearOid).map((effect) => effect.id)).toEqual(['set', 'pump']);
  });
});

describe('CR 613.4d counters', () => {
  it('adds +1/+1 and -1/-1 counters in layer 7d, after modifications', () => {
    const { state, bearOid } = board();
    const plus = withCounters(state, bearOid, 'plusOnePlusOne', 3);
    expect([powerOf(plus, bearOid), toughnessOf(plus, bearOid)]).toEqual([5, 5]);
    const minus = withCounters(state, bearOid, 'minusOneMinusOne', 1);
    expect([powerOf(minus, bearOid), toughnessOf(minus, bearOid)]).toEqual([1, 1]);
  });

  it('is switched by layer 7e, because 7d runs first', () => {
    const { state, bearOid } = board();
    const withEffects = withContinuous(withCounters(state, bearOid, 'plusOnePlusOne', 2), [
      setPt(onlyObject(bearOid), 1, 4, { ts: 1 }),
      switchPt(onlyObject(bearOid), { ts: 2 }),
    ]);
    // 1/4 set, +2/+2 counters = 3/6, switched = 6/3.
    expect([powerOf(withEffects, bearOid), toughnessOf(withEffects, bearOid)]).toEqual([6, 3]);
  });

  it('annihilates opposing counters as a state-based action (CR 704.5q)', () => {
    const { state, bearOid } = board();
    const both = withCounters(
      withCounters(state, bearOid, 'plusOnePlusOne', 3),
      bearOid,
      'minusOneMinusOne',
      2,
    );
    const settled = checkStateBasedActions(beginTrace(both));
    expect(getObject(settled.state, bearOid).counters).toEqual({ plusOnePlusOne: 1, minusOneMinusOne: 0 });
    expect(powerOf(settled.state, bearOid)).toBe(3);
    expect(eventsOfType(settled.events, 'countersChanged')).toHaveLength(1);
  });

  it('kills a creature whose counters take its toughness to zero', () => {
    const { state, bearOid } = board();
    const doomed = withCounters(state, bearOid, 'minusOneMinusOne', 2);
    const settled = checkStateBasedActions(beginTrace(doomed));
    expect(getObject(settled.state, bearOid).zone).toBe('graveyard');
  });
});

describe('CR 613.4a characteristic-defining P/T', () => {
  it('counts the board as it stands after the earlier layers', () => {
    // The bear's P/T equals the number of creatures on the battlefield. Three
    // creatures are printed; animating the idol in layer 4 makes it four, and
    // layer 7a reads the post-layer-4 board.
    const { state, bearOid } = board();
    const idolOid = oidOf(state, 'Layer Idol');
    const printed = withContinuous(state, [
      definePt(onlyObject(bearOid), battlefieldCount(objectFilter({ cardTypes: ['creature'] }))),
    ]);
    expect(powerOf(printed, bearOid)).toBe(3);

    const animated = withContinuous(state, [
      definePt(
        onlyObject(bearOid),
        battlefieldCount(objectFilter({ cardTypes: ['creature'] })),
        {},
        { ts: 1 },
      ),
      retype(onlyObject(idolOid), { addTypes: ['creature'] }, { ts: 2 }),
    ]);
    expect(powerOf(animated, bearOid)).toBe(4);
  });

  it('is overridden by a later set-P/T, because 7b runs after 7a', () => {
    const { state, bearOid } = board();
    const withEffects = withContinuous(state, [
      definePt(
        onlyObject(bearOid),
        battlefieldCount(objectFilter({ cardTypes: ['creature'] })),
        {},
        { ts: 2 },
      ),
      setPt(onlyObject(bearOid), 1, 1, { ts: 1 }),
    ]);
    expect([powerOf(withEffects, bearOid), toughnessOf(withEffects, bearOid)]).toEqual([1, 1]);
  });
});
