/**
 * Independent CR 613 audit cases, written by a verification agent who did not
 * write the layer system. Each answer is fixed by the comprehensive rules.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '@mtg/kernel';
import {
  characteristicsOf,
  controllerOf,
  hasCardType,
  hasKeyword,
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
  retype,
  setPt,
  switchPt,
  withContinuous,
  withCounters,
} from './continuous-helpers';

const bear = creature('Audit Bear', 2, 2, { subtypes: ['Bear'] });
const hawk = creature('Audit Hawk', 1, 1, { keywords: ['flying'], subtypes: ['Bird'] });
const drake = creature('Audit Drake', 5, 3, { subtypes: ['Drake'] });
const idol = artifact('Audit Idol');

function board(): {
  state: GameState;
  bearOid: ObjectId;
  hawkOid: ObjectId;
  drakeOid: ObjectId;
  forestOid: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: bear, controller: 0 },
      { card: hawk, controller: 0 },
      { card: idol, controller: 0 },
      { card: drake, controller: 1 },
      { card: FOREST, controller: 0 },
    ],
  });
  return {
    state: start.state,
    bearOid: oidOf(start.state, 'Audit Bear'),
    hawkOid: oidOf(start.state, 'Audit Hawk'),
    drakeOid: oidOf(start.state, 'Audit Drake'),
    forestOid: oidOf(start.state, 'Forest'),
  };
}

describe('audit: sublayer order inside layer 7', () => {
  it('7b set, 7c modify, 7d counters, 7e switch, asymmetric so order is visible', () => {
    // printed 2/2 -> 7b sets 1/5 -> 7c +2/+0 = 3/5 -> 7d +1/+1 = 4/6 -> 7e = 6/4
    const { state, bearOid } = board();
    const s = withContinuous(withCounters(state, bearOid, 'plusOnePlusOne', 1), [
      switchPt(onlyObject(bearOid), { ts: 3 }),
      pump(onlyObject(bearOid), 2, 0, { ts: 2 }),
      setPt(onlyObject(bearOid), 1, 5, { ts: 1 }),
    ]);
    expect([powerOf(s, bearOid), toughnessOf(s, bearOid)]).toEqual([6, 4]);
  });

  it('two switches in 7e cancel', () => {
    const { state, bearOid } = board();
    const s = withContinuous(state, [
      setPt(onlyObject(bearOid), 1, 5, { ts: 1 }),
      switchPt(onlyObject(bearOid), { ts: 2 }),
      switchPt(onlyObject(bearOid), { ts: 3 }),
    ]);
    expect([powerOf(s, bearOid), toughnessOf(s, bearOid)]).toEqual([1, 5]);
  });

  it('7a CDA is overwritten by a later-sublayer 7b set regardless of timestamp', () => {
    const { state, bearOid } = board();
    // 3 creatures on the battlefield -> CDA would say 3/3; 7b then sets 1/1.
    const s = withContinuous(state, [
      setPt(onlyObject(bearOid), 1, 1, { ts: 1 }),
      definePt(
        onlyObject(bearOid),
        battlefieldCount(objectFilter({ cardTypes: ['creature'] })),
        {},
        { ts: 9 },
      ),
    ]);
    expect([powerOf(s, bearOid), toughnessOf(s, bearOid)]).toEqual([1, 1]);
  });

  it('7a CDA counts creatures as they exist after layer 4 made a land one', () => {
    const { state, bearOid, forestOid } = board();
    const s = withContinuous(state, [
      retype(onlyObject(forestOid), { addTypes: ['creature'] }, { ts: 1 }),
      definePt(
        onlyObject(bearOid),
        battlefieldCount(objectFilter({ cardTypes: ['creature'] })),
        {},
        { ts: 2 },
      ),
    ]);
    // bear, hawk, drake, animated forest = 4
    expect(powerOf(s, bearOid)).toBe(4);
  });
});

describe('audit: timestamps inside one sublayer', () => {
  it('the later 7b set wins, whichever way the array is written', () => {
    const { state, bearOid } = board();
    const forward = withContinuous(state, [
      setPt(onlyObject(bearOid), 5, 5, { ts: 1, id: 'a' }),
      setPt(onlyObject(bearOid), 1, 1, { ts: 2, id: 'b' }),
    ]);
    const reversed = withContinuous(state, [
      setPt(onlyObject(bearOid), 1, 1, { ts: 2, id: 'b' }),
      setPt(onlyObject(bearOid), 5, 5, { ts: 1, id: 'a' }),
    ]);
    expect(powerOf(forward, bearOid)).toBe(1);
    expect(powerOf(reversed, bearOid)).toBe(1);
  });

  it('grant-then-remove-all is timestamp order, both directions', () => {
    const { state, bearOid } = board();
    const granted = withContinuous(state, [
      abilities(onlyObject(bearOid), { add: ['flying'] }, { ts: 1 }),
      abilities(onlyObject(bearOid), { removeAll: true }, { ts: 2 }),
    ]);
    expect(hasKeyword(granted, bearOid, 'flying')).toBe(false);

    const stripped = withContinuous(state, [
      abilities(onlyObject(bearOid), { removeAll: true }, { ts: 1 }),
      abilities(onlyObject(bearOid), { add: ['flying'] }, { ts: 2 }),
    ]);
    expect(hasKeyword(stripped, bearOid, 'flying')).toBe(true);
  });
});

describe('audit: CR 613.8 dependency', () => {
  it('animating lands applies before the effect that types creatures, despite timestamps', () => {
    const { state, forestOid } = board();
    const s = withContinuous(state, [
      // ts 1: "all creatures are Zombies in addition to their other types"
      retype(objectFilter({ cardTypes: ['creature'] }), { addSubtypes: ['Zombie'] }, { ts: 1 }),
      // ts 2: "all lands are creatures"
      retype(objectFilter({ cardTypes: ['land'] }), { addTypes: ['creature'] }, { ts: 2 }),
    ]);
    expect(hasCardType(s, forestOid, 'creature')).toBe(true);
    expect(characteristicsOf(s, forestOid).subtypes).toContain('Zombie');
  });

  it('a genuine dependency loop falls back to timestamp order (613.8c)', () => {
    const { state, bearOid, hawkOid } = board();
    const s = withContinuous(state, [
      // A: everything that is a Bear becomes only a Bird
      retype(
        objectFilter({ subtypes: ['Bear'] }),
        { removeAllSubtypes: true, addSubtypes: ['Bird'] },
        { ts: 1 },
      ),
      // B: everything that is a Bird becomes only a Bear
      retype(
        objectFilter({ subtypes: ['Bird'] }),
        { removeAllSubtypes: true, addSubtypes: ['Bear'] },
        { ts: 2 },
      ),
    ]);
    // Loop -> ignore dependencies -> A then B. Bear -> Bird -> Bear; Hawk stays
    // a Bird through A and becomes a Bear under B.
    expect(characteristicsOf(s, bearOid).subtypes).toEqual(['Bear']);
    expect(characteristicsOf(s, hawkOid).subtypes).toEqual(['Bear']);
  });
});

describe('audit: layer 2 control before later layers', () => {
  it('a control change moves the permanent out of a "creatures you control" pump', () => {
    const { state, bearOid } = board();
    const s = withContinuous(state, [
      controlChange(onlyObject(bearOid), 1, { ts: 1 }),
      pump(objectFilter({ cardTypes: ['creature'], controller: 0 }), 3, 3, { ts: 2 }),
    ]);
    expect(controllerOf(s, bearOid)).toBe(1);
    expect(powerOf(s, bearOid)).toBe(2);
  });
});

describe('audit: layer 1 copy', () => {
  it('a copy takes printed values and still gets counters in 7d', () => {
    const { state, bearOid, drakeOid } = board();
    const s = withContinuous(withCounters(state, bearOid, 'plusOnePlusOne', 1), [
      copies(onlyObject(bearOid), drakeOid, { ts: 1 }),
    ]);
    expect([powerOf(s, bearOid), toughnessOf(s, bearOid)]).toEqual([6, 4]);
  });

  it('a copy does not change who controls the permanent', () => {
    const { state, bearOid, drakeOid } = board();
    const s = withContinuous(state, [copies(onlyObject(bearOid), drakeOid, { ts: 1 })]);
    expect(controllerOf(s, bearOid)).toBe(0);
  });
});

describe('audit: -1/-1 counters and the short-circuit path agree', () => {
  it('minus counters subtract with no continuous effects at all', () => {
    const { state, bearOid } = board();
    const s = withCounters(state, bearOid, 'minusOneMinusOne', 1);
    expect([powerOf(s, bearOid), toughnessOf(s, bearOid)]).toEqual([1, 1]);
    expect([characteristicsOf(s, bearOid).power, characteristicsOf(s, bearOid).toughness]).toEqual([1, 1]);
  });
});
