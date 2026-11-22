/** Master of the Pearl Trident through live layer-6 landwalk grants. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  canBlock,
  controllerOf,
  keywordAbilitiesOf,
  moveObject,
  onlyObject,
  powerOf,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST, ISLAND } from './cards';
import { oidOf } from './helpers';
import { controlledBy, withContinuous } from './continuous-helpers';

const MASTER = parseCard({
  kind: 'creature',
  id: 'm13-master-of-the-pearl-trident',
  name: 'Master of the Pearl Trident',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 59 },
  manaCost: { U: 2 },
  colors: ['U'],
  subtypes: ['Merfolk'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Merfolk',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Merfolk',
      modification: {
        kind: 'grantKeywordAbilities',
        grants: [{ kind: 'landwalk', landType: 'Island' }],
      },
    },
  ],
});

const ALLY = creature('Pearl Ally', 2, 2, { subtypes: ['Merfolk'] });
const STRANGER = creature('Pearl Stranger', 2, 2, { subtypes: ['Human'] });
const RIVAL = creature('Pearl Rival', 2, 2, { subtypes: ['Merfolk'] });
const BLOCKER = creature('Pearl Blocker', 2, 2);

function board(defendingLand = ISLAND) {
  return scenario({
    battlefield: [
      { card: MASTER, controller: 0 },
      { card: ALLY, controller: 0 },
      { card: STRANGER, controller: 0 },
      { card: RIVAL, controller: 1 },
      { card: BLOCKER, controller: 1 },
      { card: defendingLand, controller: 1 },
    ],
  }).state;
}

describe('Master of the Pearl Trident in the kernel', () => {
  it("grants +1/+1 and exact Islandwalk only to its controller's other Merfolk", () => {
    const state = board();
    const master = oidOf(state, MASTER.name);
    const ally = oidOf(state, ALLY.name);
    const stranger = oidOf(state, STRANGER.name);
    const rival = oidOf(state, RIVAL.name);

    expect([powerOf(state, ally), toughnessOf(state, ally)]).toEqual([3, 3]);
    expect(keywordAbilitiesOf(state, ally)).toContainEqual({ kind: 'landwalk', landType: 'Island' });
    for (const oid of [master, stranger, rival]) {
      expect([powerOf(state, oid), toughnessOf(state, oid)]).toEqual([2, 2]);
      expect(keywordAbilitiesOf(state, oid)).not.toContainEqual({
        kind: 'landwalk',
        landType: 'Island',
      });
    }
  });

  it('reads the source controller live for both grants', () => {
    const state = board();
    const master = oidOf(state, MASTER.name);
    const ally = oidOf(state, ALLY.name);
    const rival = oidOf(state, RIVAL.name);
    const changed = withContinuous(state, [controlledBy(onlyObject(master), 1, { ts: 100 })]);

    expect(controllerOf(changed, master)).toBe(1);
    expect([powerOf(changed, ally), toughnessOf(changed, ally)]).toEqual([2, 2]);
    expect(keywordAbilitiesOf(changed, ally)).toEqual([]);
    expect([powerOf(changed, rival), toughnessOf(changed, rival)]).toEqual([3, 3]);
    expect(keywordAbilitiesOf(changed, rival)).toContainEqual({ kind: 'landwalk', landType: 'Island' });
  });

  it('uses the granted basic land type in block legality', () => {
    const withIsland = board(ISLAND);
    expect(canBlock(withIsland, oidOf(withIsland, BLOCKER.name), oidOf(withIsland, ALLY.name))).toBe(false);

    const withForest = board(FOREST);
    expect(canBlock(withForest, oidOf(withForest, BLOCKER.name), oidOf(withForest, ALLY.name))).toBe(true);
  });

  it('removes both live grants when the source incarnation leaves', () => {
    const state = board();
    const master = oidOf(state, MASTER.name);
    const ally = oidOf(state, ALLY.name);
    const gone = moveObject(beginTrace(state), master, 'graveyard').state;

    expect([powerOf(gone, ally), toughnessOf(gone, ally)]).toEqual([2, 2]);
    expect(keywordAbilitiesOf(gone, ally)).toEqual([]);
  });
});
