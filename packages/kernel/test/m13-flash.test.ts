/** Intrinsic Flash and Yeva's live green-creature timing permission. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  moveObject,
  reduce,
  scenario,
  stateFingerprint,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, onlyObject, recolor, retype, withContinuous } from './continuous-helpers';
import { creature, FOREST, instant, ISLAND, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const DRAW = { kind: 'drawCards' as const, count: 1, target: { kind: 'noTarget' as const } };
const RESPONSE = instant('Flash Probe Instant', [DRAW], { G: 1 });
const GREEN_CREATURE = creature('Green Flash Candidate', 2, 2, { cost: { G: 1 }, artifact: true });
const BLUE_CREATURE = creature('Blue Flash Candidate', 2, 2, { cost: { U: 1 } });
const MULTICOLOR_CREATURE = creature('Multicolor Flash Candidate', 2, 2, { cost: { G: 1, U: 1 } });
const COLORLESS_CREATURE = creature('Colorless Flash Candidate', 2, 2, { cost: { generic: 1 } });
const EXPENSIVE_GREEN_CREATURE = creature('Expensive Green Flash Candidate', 8, 8, {
  cost: { generic: 15, G: 1 },
});
const GREEN_SORCERY = parseCard({
  ...sorcery('Green Flash Noncreature', [DRAW], { G: 1 }),
  colors: ['G'],
});
const OPPONENT_CREATURE = creature('Opponent Green Candidate', 2, 2, {
  cost: { G: 1 },
});
const FAERIE_INVADERS = parseCard({
  kind: 'creature',
  id: 'm13-faerie-invaders-kernel',
  name: 'Faerie Invaders',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 51 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  subtypes: ['Faerie', 'Rogue'],
  power: 3,
  toughness: 3,
  keywords: ['flying'],
  keywordAbilities: [{ kind: 'flash' }],
});
const YEVA = parseCard({
  kind: 'creature',
  id: 'm13-yeva-natures-herald-kernel',
  name: "Yeva, Nature's Herald",
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 197 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'],
  supertypes: ['legendary'],
  subtypes: ['Elf', 'Shaman'],
  power: 4,
  toughness: 4,
  keywordAbilities: [{ kind: 'flash' }],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsAsThoughFlash',
      spellFilter: { cardTypes: ['creature'], colors: ['G'] },
    },
  ],
});
const BLANK_SOURCE = parseCard({
  kind: 'enchantment',
  id: 'flash-blank-source',
  name: 'Flash Blank Source',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { G: 1 },
  colors: ['G'],
});
const EQUIPMENT = parseCard({
  kind: 'artifact',
  id: 'flash-equip-regression',
  name: 'Flash Equip Regression',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 3 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonus', power: 1, toughness: 0 }] },
      effects: [],
    },
  ],
});
const EQUIP_HOST = creature('Flash Equip Host', 2, 2, { cost: { G: 1 } });

function responseWindow(source: Card = YEVA): ReduceResult {
  return apply(windowStart(source), { type: 'passPriority', player: 1 });
}

function windowStart(source: Card = YEVA): ReduceResult {
  return scenario({
    active: 1,
    battlefield: [
      { card: source, controller: 0 },
      { card: EQUIPMENT, controller: 0 },
      { card: EQUIP_HOST, controller: 0 },
      ...Array.from({ length: 8 }, () => ({ card: FOREST, controller: 0 as const })),
      { card: ISLAND, controller: 0 },
      { card: FOREST, controller: 1 },
    ],
    hands: [
      [
        FAERIE_INVADERS,
        GREEN_CREATURE,
        BLUE_CREATURE,
        MULTICOLOR_CREATURE,
        COLORLESS_CREATURE,
        EXPENSIVE_GREEN_CREATURE,
        GREEN_SORCERY,
      ],
      [OPPONENT_CREATURE, RESPONSE],
    ],
  });
}

function casts(state: GameState, player: 0 | 1 = 0): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.player === player,
  );
}

function castNames(state: GameState, player: 0 | 1 = 0): readonly string[] {
  return casts(state, player)
    .map((action) => state.objects[action.oid]?.card.name)
    .filter((name): name is string => name !== undefined)
    .sort();
}

function castAction(state: GameState, player: 0 | 1, name: string): Extract<Action, { type: 'castSpell' }> {
  const oid = handOidOf(state, player, name);
  const card = state.objects[oid]?.card;
  return {
    type: 'castSpell',
    player,
    oid,
    targets: card?.effects.length === 0 ? [] : [null],
  };
}

describe('M13 Flash in the kernel', () => {
  it('casts intrinsic Flash on an opponent turn with a nonempty stack', () => {
    const current = responseWindow();
    const response = castAction(current.state, 0, FAERIE_INVADERS.name);
    expect(validateAction(current.state, response)).toBeNull();
    expect(castNames(current.state)).toContain(FAERIE_INVADERS.name);

    const start = windowStart();
    const stacked = apply(start, castAction(start.state, 1, RESPONSE.name));
    const withStack = apply(stacked, { type: 'passPriority', player: 1 });
    const stackedResponse = castAction(withStack.state, 0, FAERIE_INVADERS.name);
    expect(withStack.state.stack).toHaveLength(1);
    expect(validateAction(withStack.state, stackedResponse)).toBeNull();
    expect(castNames(withStack.state)).toContain(FAERIE_INVADERS.name);
  });

  it('offers Yeva permission only to its controller and only for green creature cards', () => {
    const current = responseWindow();
    expect(castNames(current.state)).toEqual(
      [FAERIE_INVADERS.name, GREEN_CREATURE.name, MULTICOLOR_CREATURE.name].sort(),
    );
    for (const name of [
      FAERIE_INVADERS.name,
      GREEN_CREATURE.name,
      BLUE_CREATURE.name,
      MULTICOLOR_CREATURE.name,
      COLORLESS_CREATURE.name,
      EXPENSIVE_GREEN_CREATURE.name,
      GREEN_SORCERY.name,
    ]) {
      const enumerated = castNames(current.state).includes(name);
      expect(validateAction(current.state, castAction(current.state, 0, name)) === null, name).toBe(
        enumerated,
      );
    }

    const opponentPriority = apply(current, { type: 'passPriority', player: 0 });
    expect(castNames(opponentPriority.state, 1)).toEqual([RESPONSE.name]);
    expect(
      validateAction(opponentPriority.state, castAction(opponentPriority.state, 1, OPPONENT_CREATURE.name)),
    ).toContain('wrong timing');
  });

  it('rechecks the live source, ability loss, and unrestricted Leyline regression', () => {
    const current = responseWindow();
    const yeva = oidOf(current.state, YEVA.name);
    const greenCast = castAction(current.state, 0, GREEN_CREATURE.name);

    const layeredHandCards = withContinuous(current.state, [
      recolor(onlyObject(greenCast.oid), ['U']),
      retype(onlyObject(greenCast.oid), { removeTypes: ['creature'] }),
      recolor(onlyObject(handOidOf(current.state, 0, BLUE_CREATURE.name)), ['G']),
    ]);
    expect(castNames(layeredHandCards)).toEqual(castNames(current.state));

    const blocked: GameState = {
      ...current.state,
      turnPlayerRules: [
        ...current.state.turnPlayerRules,
        { rule: 'cantCastSpells', sourceOid: yeva, player: 0 },
      ],
    };
    expect(castNames(blocked)).toEqual([]);
    expect(validateAction(blocked, greenCast)).toContain("can't cast spells this turn");
    expect(validateAction(blocked, castAction(blocked, 0, FAERIE_INVADERS.name))).toContain(
      "can't cast spells this turn",
    );

    const changed = withContinuous(current.state, [controlledBy(onlyObject(yeva), 1)]);
    expect(castNames(changed)).toEqual([FAERIE_INVADERS.name]);
    const changedPriority = apply({ ...current, state: changed }, { type: 'passPriority', player: 0 });
    expect(castNames(changedPriority.state, 1)).toEqual([OPPONENT_CREATURE.name, RESPONSE.name].sort());

    const stripped = withContinuous(current.state, [abilities(onlyObject(yeva), { removeAll: true })]);
    expect(validateAction(stripped, greenCast)).toContain('wrong timing');
    expect(castNames(stripped)).toEqual([FAERIE_INVADERS.name]);

    const gone = moveObject(beginTrace(current.state), yeva, 'graveyard').state;
    expect(validateAction(gone, greenCast)).toContain('wrong timing');
    expect(castNames(gone)).toEqual([FAERIE_INVADERS.name]);

    const leyline = parseCard({
      kind: 'enchantment',
      id: 'flash-unrestricted-regression',
      name: 'Unrestricted Flash Permission',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { U: 1 },
      colors: ['U'],
      abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'castSpellsAsThoughFlash' }],
    });
    expect(castNames(responseWindow(leyline).state)).toEqual(
      [
        FAERIE_INVADERS.name,
        GREEN_CREATURE.name,
        BLUE_CREATURE.name,
        MULTICOLOR_CREATURE.name,
        COLORLESS_CREATURE.name,
        GREEN_SORCERY.name,
      ].sort(),
    );
  });

  it('grants nothing from hand or the stack and never overrides origin, cost, or replay legality', () => {
    const withoutSource = responseWindow(BLANK_SOURCE);
    expect(castNames(withoutSource.state)).toEqual([FAERIE_INVADERS.name]);

    const start = windowStart(BLANK_SOURCE);
    const passed = apply(start, { type: 'passPriority', player: 1 });
    const yevaInHand: GameState = {
      ...passed.state,
      objects: {
        ...passed.state.objects,
        [handOidOf(passed.state, 0, FAERIE_INVADERS.name)]: {
          ...passed.state.objects[handOidOf(passed.state, 0, FAERIE_INVADERS.name)]!,
          card: YEVA,
        },
      },
    };
    expect(castNames(yevaInHand)).not.toContain(GREEN_CREATURE.name);
    const yevaCast = castAction(yevaInHand, 0, YEVA.name);
    const yevaOnStack = reduce(yevaInHand, yevaCast);
    expect(yevaOnStack.state.stack).toHaveLength(1);
    expect(castNames(yevaOnStack.state)).not.toContain(GREEN_CREATURE.name);

    const current = responseWindow();
    const green = castAction(current.state, 0, GREEN_CREATURE.name);
    expect(validateAction(current.state, { ...green, castingCost: 'withoutMana' })).toContain(
      'not awaiting a cast without paying',
    );
    for (const zone of ['graveyard', 'exile'] as const) {
      const moved = moveObject(beginTrace(current.state), green.oid, zone).state;
      expect(validateAction(moved, green)).toContain('not in your hand');
    }

    const equipment = oidOf(current.state, EQUIPMENT.name);
    const equipHost = oidOf(current.state, EQUIP_HOST.name);
    const equipAction: Extract<Action, { type: 'activateAbility' }> = {
      type: 'activateAbility',
      player: 0,
      oid: equipment,
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: equipHost }],
      sacrifices: [],
    };
    expect(validateAction(current.state, equipAction)).toBe('equip is activated only as a sorcery');
    expect(legalActions(current.state)).not.toContainEqual(equipAction);

    const first = reduce(current.state, green);
    const replay = reduce(structuredClone(current.state), green);
    expect(replay.events).toEqual(first.events);
    expect(stateFingerprint(replay.state)).toBe(stateFingerprint(first.state));
  });
});
