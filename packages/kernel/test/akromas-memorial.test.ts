/** Akroma's Memorial through the ordinary layer-6 keyword machinery. */
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  canBeTargetedBy,
  canBlock,
  controllerOf,
  hasKeyword,
  isProtectedFrom,
  keywordAbilitiesOf,
  moveObject,
  onlyObject,
  scenario,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { oidOf } from './helpers';
import { controlledBy, withContinuous } from './continuous-helpers';

const MEMORIAL = parseCard({
  kind: 'artifact',
  id: 'm13-akromas-memorial',
  name: "Akroma's Memorial",
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 200 },
  manaCost: { generic: 7 },
  supertypes: ['legendary'],
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: {
        kind: 'grantKeywordAbilities',
        grants: [
          { kind: 'keyword', keyword: 'flying' },
          { kind: 'keyword', keyword: 'firstStrike' },
          { kind: 'keyword', keyword: 'vigilance' },
          { kind: 'keyword', keyword: 'trample' },
          { kind: 'keyword', keyword: 'haste' },
          { kind: 'protection', quality: { kind: 'color', color: 'B' } },
          { kind: 'protection', quality: { kind: 'color', color: 'R' } },
        ],
      },
    },
  ],
});

const ALLY = creature('Memorial Ally', 2, 2);
const OPPONENT = creature('Memorial Opponent', 2, 2);
const BLACK_SOURCE = creature('Black Source', 2, 2, { cost: { B: 2 } });
const RED_SOURCE = creature('Red Source', 2, 2, { cost: { R: 2 } });
const KEYWORDS = ['flying', 'firstStrike', 'vigilance', 'trample', 'haste'] as const;

function memorialState() {
  return scenario({
    battlefield: [
      { card: MEMORIAL, controller: 0 },
      { card: ALLY, controller: 0 },
      { card: OPPONENT, controller: 1 },
      { card: BLACK_SOURCE, controller: 1 },
      { card: RED_SOURCE, controller: 1 },
    ],
  }).state;
}

function expectAllKeywordGrants(
  state: ReturnType<typeof memorialState>,
  oid: string,
  granted: boolean,
): void {
  for (const keyword of KEYWORDS) expect(hasKeyword(state, oid, keyword), keyword).toBe(granted);
}

describe("Akroma's Memorial in the kernel", () => {
  it("grants five keywords and two protections only to its controller's creatures", () => {
    const state = memorialState();
    const ally = oidOf(state, ALLY.name);
    const opponent = oidOf(state, OPPONENT.name);
    const black = oidOf(state, BLACK_SOURCE.name);
    const red = oidOf(state, RED_SOURCE.name);

    expectAllKeywordGrants(state, ally, true);
    expectAllKeywordGrants(state, opponent, false);
    expect(keywordAbilitiesOf(state, ally)).toEqual(
      expect.arrayContaining([
        { kind: 'protection', quality: { kind: 'color', color: 'B' } },
        { kind: 'protection', quality: { kind: 'color', color: 'R' } },
      ]),
    );
    expect(keywordAbilitiesOf(state, opponent)).toEqual([]);
    expect(isProtectedFrom(state, ally, black)).toBe(true);
    expect(isProtectedFrom(state, ally, red)).toBe(true);
    expect(canBeTargetedBy(state, ally, black, 1)).toBe(false);
    expect(canBeTargetedBy(state, ally, red, 1)).toBe(false);
    expect(canBlock(state, black, ally)).toBe(false);

    const damaged = applyDamage(beginTrace(state), [
      {
        sourceOid: black,
        controller: 1,
        recipient: { kind: 'permanent', oid: ally },
        amount: 2,
        deathtouch: false,
        lifelink: false,
        preventable: true,
        combat: false,
      },
    ]);
    expect(damaged.state.objects[ally]?.damage).toBe(0);
    expect(state.continuous).toHaveLength(1);
    expect(state.continuous[0]).toEqual(expect.objectContaining({ kind: 'abilityChange', layer: '6' }));
  });

  it('retargets the whole bundle when control of the source changes', () => {
    const state = memorialState();
    const memorial = oidOf(state, MEMORIAL.name);
    const ally = oidOf(state, ALLY.name);
    const opponent = oidOf(state, OPPONENT.name);
    const changed = withContinuous(state, [controlledBy(onlyObject(memorial), 1, { ts: 100 })]);

    expect(controllerOf(changed, memorial)).toBe(1);
    expectAllKeywordGrants(changed, ally, false);
    expectAllKeywordGrants(changed, opponent, true);
  });

  it('removes every grant when the source leaves the battlefield', () => {
    const state = memorialState();
    const memorial = oidOf(state, MEMORIAL.name);
    const ally = oidOf(state, ALLY.name);
    const gone = moveObject(beginTrace(state), memorial, 'graveyard').state;

    expectAllKeywordGrants(gone, ally, false);
    expect(keywordAbilitiesOf(gone, ally)).toEqual([]);
  });
});
