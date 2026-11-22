/** Layer-6 granted mana abilities for RTR Chromatic Lantern. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  legalActions,
  moveObject,
  onlyObject,
  playerOf,
  reduce,
  scenario,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { controlledBy, withContinuous } from './continuous-helpers';
import { MOUNTAIN, SWAMP } from './cards';
import { oidOf } from './helpers';

const LANTERN = parseCard({
  kind: 'artifact',
  id: 'rtr-226-chromatic-lantern-kernel',
  name: 'Chromatic Lantern',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 226 },
  manaCost: { generic: 3 },
  subtypes: [],
  abilities: [
    {
      kind: 'static',
      scope: 'landsYouControl',
      subtype: null,
      modification: { kind: 'grantAnyColorManaAbility' },
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['W', 'U', 'B', 'R', 'G'], amount: 1 }],
    },
  ],
});

const COLORLESS_LAND = parseCard({
  kind: 'land',
  id: 'rtr-chromatic-lantern-colorless-land',
  name: 'Colorless Test Land',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  subtypes: [],
  producesMana: ['C'],
  abilities: [],
});

function setup() {
  return scenario({
    battlefield: [
      { card: LANTERN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: SWAMP, controller: 1 },
    ],
  }).state;
}

function granted(state: ReturnType<typeof setup>, oid: ObjectId): boolean {
  return characteristicsOf(state, oid).abilities.some(
    (ability) =>
      ability.kind === 'activated' &&
      ability.cost.tapSelf === true &&
      ability.effects[0]?.kind === 'addMana' &&
      ability.effects[0].produces.join('') === 'WUBRG',
  );
}

describe('RTR #226 Chromatic Lantern', () => {
  it('grants exactly one any-color tap ability to its controller lands and can pay it', () => {
    const state = setup();
    const mountain = oidOf(state, 'Mountain');
    const swamp = oidOf(state, 'Swamp');
    expect(granted(state, mountain)).toBe(true);
    expect(granted(state, swamp)).toBe(false);

    const options = legalActions(state).filter(
      (action) => action.type === 'activateManaAbility' && action.oid === mountain,
    );
    expect(options.map((action) => (action.type === 'activateManaAbility' ? action.color : null))).toEqual([
      'W',
      'U',
      'B',
      'R',
      'G',
    ]);
    const blue = options.find((action) => action.type === 'activateManaAbility' && action.color === 'U');
    if (blue === undefined) throw new Error('Lantern did not expose a blue mana action');
    const paid = reduce(state, blue);
    expect(playerOf(paid.state, 0).pool.U).toBe(1);
    expect(paid.state.objects[mountain]?.tapped).toBe(true);
  });

  it('retargets from live source control and ends when the source leaves', () => {
    const state = setup();
    const lantern = oidOf(state, LANTERN.name);
    const mountain = oidOf(state, 'Mountain');
    const swamp = oidOf(state, 'Swamp');
    const changed = withContinuous(state, [controlledBy(onlyObject(lantern), 1, { ts: 100 })]);
    expect(granted(changed, mountain)).toBe(false);
    expect(granted(changed, swamp)).toBe(true);

    const gone = moveObject(beginTrace(state), lantern, 'graveyard').state;
    expect(granted(gone, mountain)).toBe(false);
  });

  it('keeps an intrinsic colorless action that the WUBRG grant does not subsume', () => {
    const state = scenario({
      battlefield: [
        { card: LANTERN, controller: 0 },
        { card: COLORLESS_LAND, controller: 0 },
      ],
    }).state;
    const land = oidOf(state, COLORLESS_LAND.name);
    expect(
      legalActions(state).flatMap((action) =>
        action.type === 'activateManaAbility' && action.oid === land ? [action.color] : [],
      ),
    ).toEqual(['C', 'W', 'U', 'B', 'R', 'G']);
  });
});
