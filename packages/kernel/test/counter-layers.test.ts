/**
 * What a counter does, and in which CR 613 layer it does it.
 *
 * The kernel used to know what a +1/+1 counter meant because layer 7d
 * subtracted one field of `Counters` from another. It now reads
 * `@mtg/dsl`'s `COUNTER_DECLARATIONS`, so the two stock kinds and The Hidden
 * Kingdom's first part reach the layers by the same route. The first block
 * below is the no-regression pin: every number in it was true before the table
 * existed and has to stay true after it.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '@mtg/kernel';
import {
  beginTrace,
  characteristicsOf,
  checkStateBasedActions,
  counterKeywords,
  counterStatDelta,
  effectsApplyingTo,
  getObject,
  hasKeyword,
  NO_COUNTERS,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature } from './cards';
import { abilities, onlyObject, pump, switchPt, withContinuous, withCounters } from './continuous-helpers';

const bear = creature('Counter Bear', 2, 2, { subtypes: ['Bear'] });

function board(): { state: GameState; bearOid: ObjectId } {
  const start = scenario({ battlefield: [{ card: bear, controller: 0 }] });
  const bearOid = start.state.battlefield[0] ?? '';
  return { state: start.state, bearOid };
}

describe('the two stock counter kinds, unchanged', () => {
  it('still moves P/T by one each way in layer 7d', () => {
    const { state, bearOid } = board();
    expect(powerOf(withCounters(state, bearOid, 'plusOnePlusOne', 3), bearOid)).toBe(5);
    expect(toughnessOf(withCounters(state, bearOid, 'plusOnePlusOne', 3), bearOid)).toBe(5);
    expect(powerOf(withCounters(state, bearOid, 'minusOneMinusOne', 1), bearOid)).toBe(1);
    expect(toughnessOf(withCounters(state, bearOid, 'minusOneMinusOne', 1), bearOid)).toBe(1);
  });

  it('still applies after layer 7c and before the 7e switch', () => {
    const { state, bearOid } = board();
    // 2/2, pumped +3/+0 in 7c to 5/2, one +1/+1 counter in 7d to 6/3, then
    // switched in 7e to 3/6. A counter that applied after the switch would
    // read 4/5.
    const withEffects = withContinuous(withCounters(state, bearOid, 'plusOnePlusOne', 1), [
      pump(onlyObject(bearOid), 3, 0, { ts: 1 }),
      switchPt(onlyObject(bearOid), { ts: 2 }),
    ]);
    expect(powerOf(withEffects, bearOid)).toBe(3);
    expect(toughnessOf(withEffects, bearOid)).toBe(6);
  });

  it('still annihilates against its opposite under CR 704.5q', () => {
    const { state, bearOid } = board();
    const both = withCounters(
      withCounters(state, bearOid, 'plusOnePlusOne', 3),
      bearOid,
      'minusOneMinusOne',
      2,
    );
    const settled = checkStateBasedActions(beginTrace(both));
    expect(getObject(settled.state, bearOid).counters.plusOnePlusOne).toBe(1);
    expect(getObject(settled.state, bearOid).counters.minusOneMinusOne).toBe(0);
  });

  it('leaves a part counter out of that annihilation', () => {
    const { state, bearOid } = board();
    const mixed = withCounters(withCounters(state, bearOid, 'horn', 1), bearOid, 'minusOneMinusOne', 1);
    const settled = checkStateBasedActions(beginTrace(mixed));
    const counters = getObject(settled.state, bearOid).counters;
    expect(counters.horn).toBe(1);
    expect(counters.minusOneMinusOne).toBe(1);
  });

  /**
   * The case above never enters the annihilation itself: with no `plusOnePlusOne`
   * the pair count is zero and the function returns the record it was given, so
   * the part counter survives without anything carrying it across. This board has
   * a real pair to annihilate, which is the only way to reach the rebuilt record.
   * A part is a permanent investment in this set, and a creature that happens to
   * take a -1/-1 counter while holding one must not lose the part to it.
   */
  it('carries a part counter through an annihilation that actually runs', () => {
    const { state, bearOid } = board();
    const mixed = withCounters(
      withCounters(withCounters(state, bearOid, 'horn', 1), bearOid, 'plusOnePlusOne', 2),
      bearOid,
      'minusOneMinusOne',
      1,
    );
    const settled = checkStateBasedActions(beginTrace(mixed));
    const counters = getObject(settled.state, bearOid).counters;
    expect(counters.plusOnePlusOne).toBe(1);
    expect(counters.minusOneMinusOne).toBe(0);
    expect(counters.horn).toBe(1);
  });

  it('grants no keyword, because neither declaration names one', () => {
    expect(counterKeywords({ ...NO_COUNTERS, plusOnePlusOne: 4 })).toEqual([]);
    expect(counterStatDelta({ ...NO_COUNTERS, plusOnePlusOne: 4 })).toEqual({ power: 4, toughness: 4 });
  });
});

describe('a declared part counter', () => {
  it('lands its stat half in layer 7d', () => {
    const { state, bearOid } = board();
    const horned = withCounters(state, bearOid, 'horn', 1);
    expect(powerOf(horned, bearOid)).toBe(3);
    expect(toughnessOf(horned, bearOid)).toBe(3);
  });

  it('lands its keyword half in layer 6', () => {
    const { state, bearOid } = board();
    const horned = withCounters(state, bearOid, 'horn', 1);
    expect(hasKeyword(state, bearOid, 'firstStrike')).toBe(false);
    expect(hasKeyword(horned, bearOid, 'firstStrike')).toBe(true);
    expect(characteristicsOf(horned, bearOid).keywords).toContain('firstStrike');
  });

  /**
   * The ordering claim from `counters.ts`'s docblock. A layer-6 effect that
   * removes all abilities is applied after the counter's grant, so it takes the
   * grant away; a counter applied last would survive it and the printed card
   * would be wrong.
   */
  it('loses its keyword to a layer-6 effect that removes all abilities', () => {
    const { state, bearOid } = board();
    const horned = withCounters(state, bearOid, 'horn', 1);
    const silenced = withContinuous(horned, [abilities(onlyObject(bearOid), { removeAll: true }, { ts: 5 })]);
    expect(hasKeyword(silenced, bearOid, 'firstStrike')).toBe(false);
    // The stat half is layer 7d and survives: "loses all abilities" is not
    // "loses its counters".
    expect(powerOf(silenced, bearOid)).toBe(3);
  });

  it('grants its keyword once however many counters are on the permanent', () => {
    const { state, bearOid } = board();
    const twice = withCounters(state, bearOid, 'horn', 2);
    expect(characteristicsOf(twice, bearOid).keywords.filter((k) => k === 'firstStrike')).toHaveLength(1);
    expect(powerOf(twice, bearOid)).toBe(4);
  });

  it('reports the same answer from the short circuit and from the full walk', () => {
    const { state, bearOid } = board();
    const horned = withCounters(state, bearOid, 'horn', 1);
    // A state with no continuous effects takes the short-circuit path; adding
    // one that reaches nothing forces the real layer walk. The two must agree.
    const walked = withContinuous(horned, [pump(onlyObject('no-such-object'), 1, 1, { ts: 9 })]);
    expect(effectsApplyingTo(walked, bearOid)).toEqual([]);
    expect(hasKeyword(walked, bearOid, 'firstStrike')).toBe(hasKeyword(horned, bearOid, 'firstStrike'));
    expect(powerOf(walked, bearOid)).toBe(powerOf(horned, bearOid));
    expect(toughnessOf(walked, bearOid)).toBe(toughnessOf(horned, bearOid));
  });

  it('applies only on the battlefield', () => {
    const { state, bearOid } = board();
    const horned = withCounters(state, bearOid, 'horn', 1);
    const object = getObject(horned, bearOid);
    const exiled: GameState = {
      ...horned,
      battlefield: [],
      objects: { ...horned.objects, [bearOid]: { ...object, zone: 'exile' } },
    };
    expect(hasKeyword(exiled, bearOid, 'firstStrike')).toBe(false);
    expect(powerOf(exiled, bearOid)).toBe(2);
  });
});
