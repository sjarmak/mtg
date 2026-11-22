/** Persistent emblems grant live, separately activatable mana abilities. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { legalActions, playerOf, reduce, reduceAll, scenario, validateAction } from '@mtg/kernel';
import { creature, sorcery, SWAMP } from './cards';
import { handOidOf, oidOf } from './helpers';

type Emblem = GameState['emblems'][number];

const DARK_REALMS: Emblem = {
  id: 'em-test',
  controller: 0,
  spec: {
    name: 'Liliana of the Dark Realms Emblem',
    grantsManaAbility: {
      filter: { cardTypes: ['land'], subtypes: ['Swamp'] },
      produces: ['B'],
      amount: 4,
    },
  },
};

function land(name: string, producesMana: readonly string[], subtypes: readonly string[] = []): Card {
  return parseCard({
    kind: 'land',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: name.length },
    producesMana,
    subtypes,
  });
}

function withEmblems(state: GameState, emblems: readonly Emblem[]): GameState {
  return { ...state, emblems };
}

function manaActions(
  state: GameState,
  oid: string,
): readonly Extract<Action, { type: 'activateManaAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateManaAbility' }> =>
      action.type === 'activateManaAbility' && action.oid === oid,
  );
}

describe('emblem-granted mana abilities', () => {
  it('creates and records an emblem through ordinary spell resolution', () => {
    const legacy = sorcery(
      'Dark Legacy',
      [
        {
          kind: 'createEmblem',
          emblem: DARK_REALMS.spec,
        },
      ],
      {},
    );
    const opened = scenario({ hands: [[legacy], []] }).state;
    const spell = handOidOf(opened, 0, 'Dark Legacy');
    const cast = reduce(opened, { type: 'castSpell', player: 0, oid: spell, targets: [null] });
    const resolved = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    expect(resolved.state.emblems).toEqual([
      expect.objectContaining({ controller: 0, spec: DARK_REALMS.spec }),
    ]);
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: 'emblemCreated',
        player: 0,
        name: 'Liliana of the Dark Realms Emblem',
      }),
    );
  });

  it('adds a distinct four-mana activation beside a Swamp intrinsic ability', () => {
    const start = scenario({ battlefield: [{ card: SWAMP, controller: 0 }] }).state;
    const swamp = oidOf(start, 'Swamp');
    const state = withEmblems(start, [DARK_REALMS]);

    expect(manaActions(state, swamp)).toEqual([
      { type: 'activateManaAbility', player: 0, oid: swamp, color: 'B' },
      { type: 'activateManaAbility', player: 0, oid: swamp, color: 'B', abilityIndex: 0, amount: 4 },
    ]);

    const activated = reduce(state, {
      type: 'activateManaAbility',
      player: 0,
      oid: swamp,
      color: 'B',
      abilityIndex: 0,
      amount: 4,
    });
    expect(playerOf(activated.state, 0).pool.B).toBe(4);
    expect(activated.state.objects[swamp]?.tapped).toBe(true);
  });

  it('rejects a forged quantity on an otherwise valid mana activation', () => {
    const start = scenario({ battlefield: [{ card: SWAMP, controller: 0 }] }).state;
    const swamp = oidOf(start, 'Swamp');
    const state = withEmblems(start, [DARK_REALMS]);

    expect(
      validateAction(state, {
        type: 'activateManaAbility',
        player: 0,
        oid: swamp,
        color: 'B',
        abilityIndex: 0,
        amount: 99,
      }),
    ).toBe('source does not produce 99 mana');
  });

  it('grants the ability by current subtype to a nonbasic land, but not to another land', () => {
    const mire = land('Twilight Mire', ['B'], ['Swamp']);
    const wastes = land('Twilight Wastes', ['C']);
    const start = scenario({
      battlefield: [
        { card: mire, controller: 0 },
        { card: wastes, controller: 0 },
      ],
    }).state;
    const state = withEmblems(start, [DARK_REALMS]);

    const mireOid = oidOf(state, 'Twilight Mire');
    const wastesOid = oidOf(state, 'Twilight Wastes');
    expect(manaActions(state, mireOid).some((action) => action.abilityIndex !== undefined)).toBe(true);
    expect(manaActions(state, wastesOid).some((action) => action.abilityIndex !== undefined)).toBe(false);
  });

  it('keeps multiple emblems as separate abilities rather than multiplying one activation', () => {
    const start = scenario({ battlefield: [{ card: SWAMP, controller: 0 }] }).state;
    const swamp = oidOf(start, 'Swamp');
    const state = withEmblems(start, [DARK_REALMS, { ...DARK_REALMS, id: 'em-second' }]);
    const granted = manaActions(state, swamp).filter((action) => action.abilityIndex !== undefined);
    expect(granted.map((action) => action.abilityIndex)).toEqual([0, 1]);

    const activated = reduce(state, granted[1] as Extract<Action, { type: 'activateManaAbility' }>);
    expect(playerOf(activated.state, 0).pool.B).toBe(4);
  });

  it('follows control changes instead of the permanent owner', () => {
    const start = scenario({ battlefield: [{ card: SWAMP, controller: 1 }] }).state;
    const swamp = oidOf(start, 'Swamp');
    const controlled: GameState = {
      ...start,
      objects: {
        ...start.objects,
        [swamp]: { ...start.objects[swamp]!, controller: 0 as const },
      },
    };
    const state = withEmblems(controlled, [DARK_REALMS]);
    expect(manaActions(state, swamp).some((action) => action.abilityIndex !== undefined)).toBe(true);
  });

  it('lets the payment planner spend the granted four mana in one tap', () => {
    const spell = sorcery('Dark Purchase', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }], {
      generic: 4,
    });
    const start = scenario({
      battlefield: [{ card: SWAMP, controller: 0 }],
      hands: [[spell], []],
    }).state;
    const state = withEmblems(start, [DARK_REALMS]);
    const oid = handOidOf(state, 0, 'Dark Purchase');
    const cast = reduce(state, { type: 'castSpell', player: 0, oid, targets: [null] });
    expect(playerOf(cast.state, 0).pool.B).toBe(0);
    expect(cast.events).toContainEqual(expect.objectContaining({ type: 'manaPaid' }));
    expect(cast.state.objects[oidOf(cast.state, 'Swamp')]?.tapped).toBe(true);
  });

  it('does not grant the ability to a nonland Swamp', () => {
    const creatureCard = creature('Bog Beast', 2, 2, { subtypes: ['Swamp'] });
    const start = scenario({ battlefield: [{ card: creatureCard, controller: 0 }] }).state;
    const oid = oidOf(start, 'Bog Beast');
    expect(manaActions(withEmblems(start, [DARK_REALMS]), oid)).toEqual([]);
  });
});
