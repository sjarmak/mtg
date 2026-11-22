/** CR 702.96: Overload changes the price and replaces targeting structurally. */
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  copySpellOnStack,
  eventsOfType,
  hasCardType,
  hasKeywordAbility,
  legalActions,
  moveObject,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { artifact, costReducer, creature, instant, ISLAND, lands, MOUNTAIN } from './cards';
import { apply, damageOn, handOidOf, oidOf } from './helpers';
import { onlyObject, retype, withContinuous } from './continuous-helpers';

const DOWNSIZE = parseCard({
  kind: 'instant',
  id: 'rtr-38-downsize-kernel',
  name: 'Downsize',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 38 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -4,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
  overload: {
    cost: { generic: 2, U: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -4,
        toughness: 0,
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const STREET_SPASM = parseCard({
  kind: 'instant',
  id: 'rtr-106-street-spasm-kernel',
  name: 'Street Spasm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 106 },
  colors: ['R'],
  manaCost: { R: 1, hasX: true },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: {
        kind: 'targetCreatureYouDontControl',
        restriction: { kind: 'withoutKeyword', keyword: 'flying' },
      },
    },
  ],
  overload: {
    cost: { R: 2, hasX: true },
    xSymbols: 2,
    effects: [
      {
        kind: 'dealDamage',
        amount: { kind: 'chosenX' },
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

// A kernel-only source-quality probe. Card validation correctly rejects lifelink
// on an instant, but the damage primitive must still batch all instances from a
// source carrying it; otherwise one overloaded effect becomes several events.
const LIFELINK_STREET_SPASM: Card = {
  ...STREET_SPASM,
  id: 'rtr-106-street-spasm-lifelink-kernel',
  name: 'Street Spasm With Lifelink',
  set: { code: 'TST', collectorNumber: 3 },
  keywords: ['lifelink'],
};

const COUNTERFLUX = parseCard({
  kind: 'instant',
  id: 'rtr-153-counterflux-kernel',
  name: 'Counterflux',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 153 },
  colors: ['U', 'R'],
  manaCost: { U: 2, R: 1 },
  cannotBeCountered: true,
  effects: [{ kind: 'counterSpell' }],
  overload: {
    cost: { generic: 1, U: 2, R: 1 },
    effects: [{ kind: 'counterSpell', spellSelection: 'spellsYouDontControl' }],
  },
} as unknown as CardInput);

const CYCLONIC_RIFT = parseCard({
  kind: 'instant',
  id: 'rtr-35-cyclonic-rift-kernel',
  name: 'Cyclonic Rift',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 35 },
  colors: ['U'],
  manaCost: { generic: 1, U: 1 },
  effects: [{ kind: 'returnToHand', target: { kind: 'targetNonlandPermanentYouDontControl' } }],
  overload: {
    cost: { generic: 6, U: 1 },
    effects: [
      {
        kind: 'returnToHand',
        scope: 'permanentsYouDontControl',
        scopeFilter: { excludeCardTypes: ['land'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const BLUSTERSQUALL = parseCard({
  kind: 'instant',
  id: 'rtr-30-blustersquall-kernel',
  name: 'Blustersquall',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 30 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreatureYouDontControl' } }],
  overload: {
    cost: { generic: 3, U: 1 },
    effects: [
      {
        kind: 'tapPermanent',
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const VANDALBLAST = parseCard({
  kind: 'sorcery',
  id: 'rtr-111-vandalblast-kernel',
  name: 'Vandalblast',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 111 },
  colors: ['R'],
  manaCost: { R: 1 },
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactYouDontControl' } }],
  overload: {
    cost: { generic: 4, R: 1 },
    effects: [
      {
        kind: 'destroyPermanent',
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['artifact'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const MIZZIUM_SKIN = parseCard({
  kind: 'instant',
  id: 'rtr-45-mizzium-skin-kernel',
  name: 'Mizzium Skin',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 45 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 0,
      toughness: 1,
      target: { kind: 'targetCreatureYouControl' },
    },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'hexproof', target: { kind: 'thatCreature' } },
  ],
  overload: {
    cost: { generic: 1, U: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 0,
        toughness: 1,
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'grantKeywordUntilEndOfTurn',
        keyword: 'hexproof',
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const CHEMISTERS_TRICK = parseCard({
  kind: 'instant',
  id: 'rtr-149-chemisters-trick-kernel',
  name: "Chemister's Trick",
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 149 },
  colors: ['U', 'R'],
  manaCost: { U: 1, R: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -2,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
    { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
  ],
  overload: {
    cost: { generic: 3, U: 1, R: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -2,
        toughness: 0,
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'attacksThisTurnIfAble',
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const TELEPORTAL = parseCard({
  kind: 'sorcery',
  id: 'rtr-202-teleportal-kernel',
  name: 'Teleportal',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 202 },
  colors: ['U', 'R'],
  manaCost: { U: 1, R: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 1,
      toughness: 0,
      target: { kind: 'targetCreatureYouControl' },
    },
    { kind: 'cantBeBlockedThisTurn', target: { kind: 'thatCreature' } },
  ],
  overload: {
    cost: { generic: 3, U: 1, R: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 0,
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'cantBeBlockedThisTurn',
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const OMNISCIENCE = parseCard({
  kind: 'enchantment',
  id: 'overload-omniscience',
  name: 'Overload Omniscience',
  rarity: 'mythic',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 10 },
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsFromHandWithoutPayingManaCost',
    },
  ],
} as CardInput);

const RIVAL = creature('Overload Rival', 8, 8);
const HEXPROOF_RIVAL = creature('Overload Hexproof Rival', 8, 8, {
  keywordAbilities: [{ kind: 'hexproof' }, { kind: 'protection', quality: { kind: 'color', color: 'U' } }],
});
const PROTECTED_RED_RIVAL = creature('Overload Protection From Red Rival', 8, 8, {
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
});
const OWN_SPELL = instant(
  'Own Stack Spell',
  [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  {},
);
const RIVAL_SPELL = instant(
  'Rival Stack Spell',
  [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  {},
);
const UNCOUNTERABLE = parseCard({
  kind: 'instant',
  id: 'overload-uncounterable',
  name: 'Rival Uncounterable Spell',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  colors: [],
  manaCost: {},
  cannotBeCountered: true,
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
} as CardInput);
const STACK_ABILITY = artifact('Stack Ability', {}, [
  {
    kind: 'activated',
    cost: { mana: {}, tapSelf: true },
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
]);
const FLASH_RIVAL = creature('Flash Rift Rival', 2, 2, {
  keywordAbilities: [{ kind: 'flash' }],
  cost: {},
});
const OWN_ONE = creature('Teleportal One', 2, 2);
const OWN_TWO = creature('Teleportal Two', 2, 2);
const OWN_LATE = creature('Teleportal Late', 2, 2);
const OWN_AFTER = creature('Teleportal After', 2, 2);
const OWN_ARTIFACT = artifact('Owned Vandalblast Artifact');
const RIVAL_ARTIFACT = artifact('Rival Vandalblast Artifact');
const RIVAL_ARTIFACT_LAND = artifact('Rival Artifact Land');
const PROTECTED_ARTIFACT = creature('Protected Artifact', 2, 2, {
  artifact: true,
  keywordAbilities: [{ kind: 'hexproof' }, { kind: 'protection', quality: { kind: 'color', color: 'R' } }],
});

function casts(
  state: GameState,
  name: string,
  player: 0 | 1 = 0,
): readonly Extract<Action, { type: 'castSpell' }>[] {
  const oid = handOidOf(state, player, name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.oid === oid,
  );
}

function resolveTop(current: ReduceResult): ReduceResult {
  return apply(apply(current, { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

function resolveCurrentTop(current: ReduceResult): ReduceResult {
  const first = current.state.turn.priority;
  if (first === null) throw new Error('no player has priority');
  const passed = apply(current, { type: 'passPriority', player: first });
  const second = passed.state.turn.priority;
  if (second === null) throw new Error('priority was not passed to the other player');
  return apply(passed, { type: 'passPriority', player: second });
}

describe('Overload cast declaration', () => {
  it('offers targeted ordinary and untargeted overload profiles independently', () => {
    const open = scenario({
      battlefield: [
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
        { card: RIVAL, controller: 1 },
      ],
      hands: [[DOWNSIZE], []],
    });
    const options = casts(open.state, DOWNSIZE.name);
    expect(options.filter((action) => action.castingCost === 'mana')).toHaveLength(1);
    expect(options.filter((action) => action.castingCost === 'overload')).toEqual([
      expect.objectContaining({ targets: [null] }),
    ]);
  });

  it('needs no target and remains castable through opposing hexproof and protection', () => {
    const open = scenario({
      battlefield: [
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
        { card: HEXPROOF_RIVAL, controller: 1 },
      ],
      hands: [[DOWNSIZE], []],
    });
    expect(casts(open.state, DOWNSIZE.name).filter((action) => action.castingCost === 'mana')).toEqual([]);
    const overloaded = casts(open.state, DOWNSIZE.name).find((action) => action.castingCost === 'overload');
    if (overloaded === undefined) throw new Error('untargeted overload cast was not offered');
    const resolved = resolveTop(apply(open, overloaded));
    expect(powerOf(resolved.state, oidOf(resolved.state, HEXPROOF_RIVAL.name))).toBe(4);
  });

  it('applies reducers to the selected overload cost and retains it on the stack', () => {
    const reducer = costReducer('Overload Reducer', { amount: 1, cardType: 'instant' });
    const open = scenario({
      battlefield: [
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
        { card: reducer, controller: 0 },
        { card: RIVAL, controller: 1 },
      ],
      hands: [[DOWNSIZE], []],
    });
    const action = casts(open.state, DOWNSIZE.name).find((candidate) => candidate.castingCost === 'overload');
    if (action === undefined) throw new Error('reduced overload cast was not offered');
    const cast = reduce(open.state, action);
    expect(eventsOfType(cast.events, 'manaPaid').at(-1)?.cost.generic).toBe(1);
    expect(cast.state.stack.at(-1)?.castingCost).toBe('overload');
  });

  it('excludes overload from casting without paying mana', () => {
    const open = scenario({
      battlefield: [
        { card: OMNISCIENCE, controller: 0 },
        { card: RIVAL, controller: 1 },
      ],
      hands: [[DOWNSIZE], []],
    });
    const free = casts(open.state, DOWNSIZE.name).filter((action) => action.castingCost === 'withoutMana');
    expect(free).toEqual([expect.objectContaining({ targets: [expect.anything()] })]);
    const hostile = {
      ...free[0],
      castingCost: 'overload',
      targets: [null],
    } as unknown as Action;
    expect(validateAction(open.state, hostile)).not.toBeNull();
  });
});

describe('Overload X and copies', () => {
  it('pays both X symbols but resolves one chosen X amount', () => {
    const open = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 6).map((card) => ({ card, controller: 0 as const })),
        { card: RIVAL, controller: 1 },
      ],
      hands: [[STREET_SPASM], []],
    });
    const action = casts(open.state, STREET_SPASM.name).find(
      (candidate) => candidate.castingCost === 'overload' && candidate.x === 2,
    );
    if (action === undefined) throw new Error('Street Spasm X=2 overload cast was not offered');
    const cast = reduce(open.state, action);
    expect(eventsOfType(cast.events, 'manaPaid').at(-1)?.cost).toMatchObject({ generic: 4, R: 2 });
    const resolved = resolveTop(cast);
    expect(damageOn(resolved.state, oidOf(resolved.state, RIVAL.name))).toBe(2);
  });

  it('copies overloaded mode and X without charging its cost again', () => {
    const open = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 6).map((card) => ({ card, controller: 0 as const })),
        { card: RIVAL, controller: 1 },
      ],
      hands: [[STREET_SPASM], []],
    });
    const action = casts(open.state, STREET_SPASM.name).find(
      (candidate) => candidate.castingCost === 'overload' && candidate.x === 2,
    );
    if (action === undefined) throw new Error('Street Spasm X=2 overload cast was not offered');
    const cast = reduce(open.state, action);
    const original = cast.state.stack.at(-1)?.oid;
    if (original === undefined) throw new Error('Street Spasm did not reach the stack');
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    expect(copied.state.stack.map((entry) => [entry.castingCost, entry.x])).toEqual([
      ['overload', 2],
      ['overload', 2],
    ]);
    expect(eventsOfType(copied.events, 'manaPaid')).toEqual([]);
    let current: ReduceResult = { state: copied.state, events: [...cast.events, ...copied.events] };
    current = resolveTop(current);
    current = resolveTop(current);
    expect(damageOn(current.state, oidOf(current.state, RIVAL.name))).toBe(4);
  });

  it('retains the copied spell source qualities used by protection', () => {
    const open = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 6).map((card) => ({ card, controller: 0 as const })),
        { card: PROTECTED_RED_RIVAL, controller: 1 },
      ],
      hands: [[STREET_SPASM], []],
    });
    const action = casts(open.state, STREET_SPASM.name).find(
      (candidate) => candidate.castingCost === 'overload' && candidate.x === 2,
    );
    if (action === undefined) throw new Error('Street Spasm X=2 overload cast was not offered');
    const cast = reduce(open.state, action);
    const original = cast.state.stack.at(-1)?.oid;
    if (original === undefined) throw new Error('Street Spasm did not reach the stack');
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    let current: ReduceResult = { state: copied.state, events: [...cast.events, ...copied.events] };
    current = resolveTop(current);
    current = resolveTop(current);
    expect(damageOn(current.state, oidOf(current.state, PROTECTED_RED_RIVAL.name))).toBe(0);
  });

  it('deals overloaded damage simultaneously as one lifelink event', () => {
    const otherRival = creature('Other Overload Rival', 8, 8);
    const open = scenario({
      life: [20, 20],
      battlefield: [
        ...lands(MOUNTAIN, 4).map((card) => ({ card, controller: 0 as const })),
        { card: RIVAL, controller: 1 },
        { card: otherRival, controller: 1 },
      ],
      hands: [[LIFELINK_STREET_SPASM], []],
    });
    const action = casts(open.state, LIFELINK_STREET_SPASM.name).find(
      (candidate) => candidate.castingCost === 'overload' && candidate.x === 1,
    );
    if (action === undefined) throw new Error('Street Spasm X=1 overload cast was not offered');
    const cast = apply(open, action);
    const original = cast.state.stack.at(-1)?.oid;
    if (original === undefined) throw new Error('Street Spasm did not reach the stack');
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    const resolved = resolveTop({ state: copied.state, events: [...cast.events, ...copied.events] });
    const lifelink = eventsOfType(resolved.events, 'lifeChanged').filter(
      (event) => event.reason === 'lifelink',
    );
    expect(lifelink).toEqual([expect.objectContaining({ delta: 2, life: 22 })]);
  });
});

describe('Counterflux spell selection', () => {
  it('targets only opposing spells and overload sweeps neither abilities nor your spells', () => {
    let current = scenario({
      battlefield: [
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
        { card: MOUNTAIN, controller: 0 },
        { card: STACK_ABILITY, controller: 1 },
      ],
      hands: [
        [OWN_SPELL, COUNTERFLUX],
        [RIVAL_SPELL, UNCOUNTERABLE],
      ],
    });
    const own = casts(current.state, OWN_SPELL.name)[0];
    if (own === undefined) throw new Error('own stack spell was not offered');
    current = apply(current, own);
    current = apply(current, { type: 'passPriority', player: 0 });
    const activation = legalActions(current.state).find(
      (action) => action.type === 'activateAbility' && action.player === 1,
    );
    if (activation === undefined) throw new Error('opposing stack ability was not offered');
    current = apply(current, activation);
    const rival = casts(current.state, RIVAL_SPELL.name, 1)[0];
    if (rival === undefined) throw new Error('rival stack spell was not offered');
    current = apply(current, rival);
    const uncounterable = casts(current.state, UNCOUNTERABLE.name, 1)[0];
    if (uncounterable === undefined) throw new Error('uncounterable spell was not offered');
    current = apply(current, uncounterable);
    current = apply(current, { type: 'passPriority', player: 1 });

    const counterflux = casts(current.state, COUNTERFLUX.name);
    const ordinaryTargets = counterflux
      .filter((action) => action.castingCost === 'mana')
      .map((action) => action.targets[0])
      .filter(
        (target): target is Extract<NonNullable<typeof target>, { kind: 'spell' }> =>
          target?.kind === 'spell',
      )
      .map((target) => current.state.objects[target.oid]?.card.name);
    expect(ordinaryTargets.sort()).toEqual([RIVAL_SPELL.name, UNCOUNTERABLE.name].sort());
    const ordinary = counterflux.find((action) => action.castingCost === 'mana');
    if (ordinary === undefined) throw new Error('ordinary Counterflux was not offered');
    const ownOid = current.state.stack.find(
      (entry) => entry.controller === 0 && current.state.objects[entry.oid]?.card.id === OWN_SPELL.id,
    )?.oid;
    if (ownOid === undefined) throw new Error('own spell was not retained on the stack');
    expect(
      validateAction(current.state, {
        ...ordinary,
        targets: [{ kind: 'spell', oid: ownOid }],
      }),
    ).toContain('illegal target');

    const overloaded = counterflux.find((action) => action.castingCost === 'overload');
    if (overloaded === undefined) throw new Error('Counterflux overload was not offered');
    current = apply(current, overloaded);
    current = resolveTop(current);
    const stack = current.state.stack;
    expect(stack.some((entry) => entry.ability !== null)).toBe(true);
    expect(stack.some((entry) => entry.controller === 0)).toBe(true);
    expect(stack.some((entry) => current.state.objects[entry.oid]?.card.id === UNCOUNTERABLE.id)).toBe(true);
    expect(stack.some((entry) => current.state.objects[entry.oid]?.card.id === RIVAL_SPELL.id)).toBe(false);
  });

  it('retains Counterflux colors on an overloaded copy', () => {
    let current = scenario({
      active: 1,
      step: 'precombatMain',
      battlefield: [
        ...lands(ISLAND, 3).map((card) => ({ card, controller: 0 as const })),
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[COUNTERFLUX], [RIVAL_SPELL]],
    });
    const rival = casts(current.state, RIVAL_SPELL.name, 1)[0];
    if (rival === undefined) throw new Error('rival stack spell was not offered');
    current = apply(current, rival);
    current = apply(current, { type: 'passPriority', player: 1 });
    const overloaded = casts(current.state, COUNTERFLUX.name).find(
      (action) => action.castingCost === 'overload',
    );
    if (overloaded === undefined) throw new Error('Counterflux overload was not offered');
    current = apply(current, overloaded);
    const original = current.state.stack.at(-1)?.oid;
    if (original === undefined) throw new Error('Counterflux did not reach the stack');
    const copied = copySpellOnStack(beginTrace(current.state), original);
    current = {
      state: {
        ...copied.state,
        turnPlayerRules: [
          ...copied.state.turnPlayerRules,
          {
            rule: 'spellsCantBeCounteredBySpellColors',
            sourceOid: original,
            player: 1,
            colors: ['U', 'R'],
          },
        ],
      },
      events: [...current.events, ...copied.events],
    };
    current = resolveCurrentTop(current);
    current = resolveCurrentTop(current);
    expect(
      current.state.stack.some((entry) => current.state.objects[entry.oid]?.card.id === RIVAL_SPELL.id),
    ).toBe(true);
  });
});

describe('Overload target spaces', () => {
  it("targets exactly artifacts you don't control, including artifact lands", () => {
    let open = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 5).map((card) => ({ card, controller: 0 as const })),
        { card: OWN_ARTIFACT, controller: 0 },
        { card: RIVAL_ARTIFACT, controller: 1 },
        { card: RIVAL_ARTIFACT_LAND, controller: 1 },
        { card: PROTECTED_ARTIFACT, controller: 1 },
      ],
      hands: [[VANDALBLAST], []],
    });
    const artifactLand = oidOf(open.state, RIVAL_ARTIFACT_LAND.name);
    open = {
      ...open,
      state: withContinuous(open.state, [retype(onlyObject(artifactLand), { addTypes: ['land'] })]),
    };
    expect(hasCardType(open.state, artifactLand, 'artifact')).toBe(true);
    expect(hasCardType(open.state, artifactLand, 'land')).toBe(true);

    const ordinaryNames = casts(open.state, VANDALBLAST.name)
      .filter((action) => action.castingCost === 'mana')
      .map((action) => action.targets[0])
      .filter(
        (target): target is Extract<NonNullable<typeof target>, { kind: 'permanent' }> =>
          target?.kind === 'permanent',
      )
      .map((target) => open.state.objects[target.oid]?.card.name);
    expect(ordinaryNames.sort()).toEqual([RIVAL_ARTIFACT.name, RIVAL_ARTIFACT_LAND.name].sort());

    const overloaded = casts(open.state, VANDALBLAST.name).find(
      (action) => action.castingCost === 'overload',
    );
    if (overloaded === undefined) throw new Error('Vandalblast overload was not offered');
    const ownedArtifact = oidOf(open.state, OWN_ARTIFACT.name);
    const destroyedArtifacts = [RIVAL_ARTIFACT, RIVAL_ARTIFACT_LAND, PROTECTED_ARTIFACT].map((card) =>
      oidOf(open.state, card.name),
    );
    const resolved = resolveTop(apply(open, overloaded));
    expect(resolved.state.battlefield).toContain(ownedArtifact);
    for (const destroyed of destroyedArtifacts) {
      expect(resolved.state.battlefield).not.toContain(destroyed);
    }
  });

  it('keeps Blustersquall targeted ordinarily and untargeted through protection', () => {
    const open = scenario({
      battlefield: [
        ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const })),
        { card: OWN_ONE, controller: 0 },
        { card: HEXPROOF_RIVAL, controller: 1 },
      ],
      hands: [[BLUSTERSQUALL], []],
    });
    expect(casts(open.state, BLUSTERSQUALL.name).filter((action) => action.castingCost === 'mana')).toEqual(
      [],
    );
    const overloaded = casts(open.state, BLUSTERSQUALL.name).find(
      (action) => action.castingCost === 'overload',
    );
    if (overloaded === undefined) throw new Error('Blustersquall overload was not offered');
    const resolved = resolveTop(apply(open, overloaded));
    expect(resolved.state.objects[oidOf(resolved.state, HEXPROOF_RIVAL.name)]?.tapped).toBe(true);
    expect(resolved.state.objects[oidOf(resolved.state, OWN_ONE.name)]?.tapped).toBe(false);
  });
});

describe('Overload cohorts', () => {
  it('fizzles both same-subject ordinary instructions when their target departs', () => {
    let current = scenario({
      battlefield: [
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
        { card: OWN_ONE, controller: 0 },
        { card: OWN_TWO, controller: 0 },
      ],
      hands: [[MIZZIUM_SKIN], []],
    });
    const target = oidOf(current.state, OWN_ONE.name);
    const cast = casts(current.state, MIZZIUM_SKIN.name).find(
      (action) =>
        action.castingCost === 'mana' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === target,
    );
    if (cast === undefined) throw new Error('targeted Mizzium Skin was not offered');
    current = apply(current, cast);
    const departed = moveObject(beginTrace(current.state), target, 'graveyard');
    current = { state: departed.state, events: [...current.events, ...departed.events] };
    current = resolveTop(current);
    const survivor = oidOf(current.state, OWN_TWO.name);
    expect(toughnessOf(current.state, survivor)).toBe(2);
    expect(hasKeywordAbility(current.state, survivor, 'hexproof')).toBe(false);
  });

  it('applies both Mizzium Skin instructions to the same pre-resolution cohort', () => {
    let current = scenario({
      battlefield: [
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
        { card: OWN_ONE, controller: 0 },
      ],
      hands: [[MIZZIUM_SKIN, OWN_LATE], []],
    });
    const overloaded = casts(current.state, MIZZIUM_SKIN.name).find(
      (action) => action.castingCost === 'overload',
    );
    if (overloaded === undefined) throw new Error('Mizzium Skin overload was not offered');
    current = apply(current, overloaded);
    const departedOid = oidOf(current.state, OWN_ONE.name);
    const departed = moveObject(beginTrace(current.state), departedOid, 'graveyard');
    const arrivingOid = handOidOf(departed.state, 0, OWN_LATE.name);
    const arrived = moveObject(beginTrace(departed.state), arrivingOid, 'battlefield', { controller: 0 });
    current = {
      state: arrived.state,
      events: [...current.events, ...departed.events, ...arrived.events],
    };
    current = resolveTop(current);
    expect(toughnessOf(current.state, arrivingOid)).toBe(3);
    expect(hasKeywordAbility(current.state, arrivingOid, 'hexproof')).toBe(true);
    expect(current.state.battlefield).not.toContain(departedOid);
  });

  it("applies both Chemister's Trick instructions to opposing pre-resolution arrivals", () => {
    let current = scenario({
      battlefield: [
        ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const })),
        { card: MOUNTAIN, controller: 0 },
        { card: RIVAL, controller: 1 },
      ],
      hands: [[CHEMISTERS_TRICK], [FLASH_RIVAL]],
    });
    const overloaded = casts(current.state, CHEMISTERS_TRICK.name).find(
      (action) => action.castingCost === 'overload',
    );
    if (overloaded === undefined) throw new Error("Chemister's Trick overload was not offered");
    current = apply(current, overloaded);
    const departedOid = oidOf(current.state, RIVAL.name);
    const departed = moveObject(beginTrace(current.state), departedOid, 'hand');
    const arrivingOid = handOidOf(departed.state, 1, FLASH_RIVAL.name);
    const arrived = moveObject(beginTrace(departed.state), arrivingOid, 'battlefield', { controller: 1 });
    current = {
      state: arrived.state,
      events: [...current.events, ...departed.events, ...arrived.events],
    };
    current = resolveTop(current);
    expect(powerOf(current.state, arrivingOid)).toBe(0);
    expect(current.state.turnCombatRules).toContainEqual(
      expect.objectContaining({ rule: 'attacksThisTurnIfAble', subject: arrivingOid }),
    );
    expect(current.state.turnCombatRules).not.toContainEqual(
      expect.objectContaining({ rule: 'attacksThisTurnIfAble', subject: departedOid }),
    );
  });

  it('reads the current opposing board when Cyclonic Rift resolves', () => {
    let current = scenario({
      battlefield: [
        ...lands(ISLAND, 7).map((card) => ({ card, controller: 0 as const })),
        { card: RIVAL, controller: 1 },
      ],
      hands: [[CYCLONIC_RIFT], [FLASH_RIVAL]],
    });
    const rift = casts(current.state, CYCLONIC_RIFT.name).find((action) => action.castingCost === 'overload');
    if (rift === undefined) throw new Error('Cyclonic Rift overload was not offered');
    current = apply(current, rift);
    current = apply(current, { type: 'passPriority', player: 0 });
    const flash = casts(current.state, FLASH_RIVAL.name, 1)[0];
    if (flash === undefined) throw new Error('flash response was not offered');
    current = apply(current, flash);
    current = apply(current, { type: 'passPriority', player: 1 });
    current = apply(current, { type: 'passPriority', player: 0 });
    expect(oidOf(current.state, FLASH_RIVAL.name)).toBeDefined();
    current = resolveTop(current);
    expect(current.state.battlefield.some((oid) => current.state.objects[oid]?.card.id === RIVAL.id)).toBe(
      false,
    );
    expect(
      current.state.battlefield.some((oid) => current.state.objects[oid]?.card.id === FLASH_RIVAL.id),
    ).toBe(false);
  });

  it('freezes both Teleportal instructions to its resolution-time cohort', () => {
    let current = scenario({
      battlefield: [
        ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const })),
        { card: MOUNTAIN, controller: 0 },
        { card: OWN_ONE, controller: 0 },
        { card: OWN_TWO, controller: 0 },
      ],
      hands: [[TELEPORTAL, OWN_LATE, OWN_AFTER], []],
    });
    const portal = casts(current.state, TELEPORTAL.name).find((action) => action.castingCost === 'overload');
    if (portal === undefined) throw new Error('Teleportal overload was not offered');
    current = apply(current, portal);
    const departed = oidOf(current.state, OWN_ONE.name);
    current = { ...current, state: moveObject(beginTrace(current.state), departed, 'graveyard').state };
    const late = handOidOf(current.state, 0, OWN_LATE.name);
    current = {
      ...current,
      state: moveObject(beginTrace(current.state), late, 'battlefield', { controller: 0 }).state,
    };
    current = resolveTop(current);
    const after = handOidOf(current.state, 0, OWN_AFTER.name);
    current = {
      ...current,
      state: moveObject(beginTrace(current.state), after, 'battlefield', { controller: 0 }).state,
    };
    const subjects = current.state.turnCombatRules
      .filter((rule) => rule.rule === 'cantBeBlockedThisTurn')
      .map((rule) => rule.subject);
    expect(subjects.sort()).toEqual([oidOf(current.state, OWN_TWO.name), late].sort());
    expect(subjects).not.toContain(departed);
    expect(subjects).not.toContain(after);
    expect(powerOf(current.state, late)).toBe(3);
    expect(powerOf(current.state, after)).toBe(2);
  });
});
