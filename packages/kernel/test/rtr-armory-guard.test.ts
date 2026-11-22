/** Armory Guard reads its current controller's Gate live through CR 611.2c. */
import { parseCard } from '@mtg/dsl';
import { beginTrace, hasKeyword, moveObject, onlyObject, scenario } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { controlledBy, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

const GUARD = parseCard({
  kind: 'creature',
  id: 'rtr-2-armory-guard-kernel',
  name: 'Armory Guard',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 2 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  subtypes: ['Giant', 'Soldier'],
  power: 2,
  toughness: 5,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'grantKeyword', keyword: 'vigilance' },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Gate', atLeast: 1 },
      printedSubjectReference: 'thisCreature',
    },
  ],
});
const GATE = parseCard({
  kind: 'land',
  id: 'rtr-2-armory-gate',
  name: 'Armory Gate',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 995 },
  colors: [],
  supertypes: [],
  subtypes: ['Gate'],
  abilities: [],
});

function board(gateController: 0 | 1) {
  return scenario({
    battlefield: [
      { card: GUARD, controller: 0 },
      { card: GATE, controller: gateController },
    ],
  });
}

describe("Armory Guard's live Gate condition", () => {
  it('grants vigilance only for a Gate controlled by the source controller', () => {
    const own = board(0);
    const opposed = board(1);

    expect(hasKeyword(own.state, oidOf(own.state, GUARD.name), 'vigilance')).toBe(true);
    expect(hasKeyword(opposed.state, oidOf(opposed.state, GUARD.name), 'vigilance')).toBe(false);
  });

  it('follows Gate departure, live source control, and source departure', () => {
    const start = board(0);
    const guard = oidOf(start.state, GUARD.name);
    const gate = oidOf(start.state, GATE.name);

    const withoutGate = moveObject(beginTrace(start.state), gate, 'graveyard').state;
    expect(hasKeyword(withoutGate, guard, 'vigilance')).toBe(false);

    const stolen = withContinuous(start.state, [controlledBy(onlyObject(guard), 1)]);
    expect(hasKeyword(stolen, guard, 'vigilance')).toBe(false);

    const departed = moveObject(beginTrace(stolen), guard, 'graveyard').state;
    expect(departed.continuous.some((effect) => effect.sourceOid === guard)).toBe(false);
  });
});
