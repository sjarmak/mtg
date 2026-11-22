/** Live enumeration and CR 608.2b recheck for Ground Seal's prohibition. */
import { parseCard, type Effect } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  onlyObject,
  pendingDecision,
  reduce,
  resolveTop,
  scenario,
  targetChoicesFor,
  targetChoicesForActivation,
  targetChoicesForEffects,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, copies, withContinuous } from './continuous-helpers';
import { artifact, creature, lands, sorcery, FOREST, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const GROUND_SEAL = parseCard({
  kind: 'enchantment',
  id: 'm13-176-ground-seal-kernel',
  name: 'Ground Seal',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 176 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
    { kind: 'staticGameRule', rule: 'cardsInGraveyardsCantBeTargets' },
  ],
});

const BLANK = parseCard({
  kind: 'enchantment',
  id: 'ground-seal-blank',
  name: 'Ground Seal Blank',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 176 },
  manaCost: { generic: 1 },
  colors: [],
});

const BURIED_MINE = creature('Ground Seal Buried Mine', 2, 2);
const BURIED_THEIRS = creature('Ground Seal Buried Theirs', 3, 3);

const RETURN_TARGET: Effect = {
  kind: 'returnToHand',
  target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
};

const TARGETED_SPELL = sorcery('Ground Seal Targeted Spell', [RETURN_TARGET], { B: 1 });

const TARGETED_ACTIVATOR = artifact('Ground Seal Targeted Activator', { generic: 1 }, [
  {
    kind: 'activated',
    cost: { mana: {}, tapSelf: true },
    effects: [RETURN_TARGET],
  },
]);

const TARGETED_TRIGGER = creature('Ground Seal Targeted Trigger', 1, 1, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [RETURN_TARGET],
    },
  ],
});

const UNTARGETED_RECALL = sorcery(
  'Ground Seal Untargeted Recall',
  [
    {
      kind: 'chooseFromGraveyard',
      whose: 'each',
      filter: { cardTypes: ['creature'] },
      destination: 'hand',
    },
  ],
  { B: 1 },
);

const TARGET_PLAYER_GRAVEYARD: Effect = {
  kind: 'exileGraveyard',
  target: { kind: 'targetPlayer' },
};

function graveyardTargets(slots: readonly (readonly (Target | null)[])[]): readonly ObjectId[] {
  return slots.flatMap((slot) => slot.flatMap((target) => (target?.kind === 'card' ? [target.oid] : [])));
}

function board(withSeal: boolean): ReduceResult {
  return scenario({
    battlefield: [
      ...(withSeal ? [{ card: GROUND_SEAL, controller: 0 as const }] : []),
      { card: TARGETED_ACTIVATOR, controller: 0 },
    ],
    graveyards: [[BURIED_MINE], [BURIED_THEIRS]],
  });
}

function targetedAbility(): Extract<(typeof TARGETED_ACTIVATOR.abilities)[number], { kind: 'activated' }> {
  const ability = TARGETED_ACTIVATOR.abilities[0];
  if (ability?.kind !== 'activated') throw new Error('Ground Seal probe lost its activation');
  return ability;
}

function targetedTrigger(): Extract<(typeof TARGETED_TRIGGER.abilities)[number], { kind: 'triggered' }> {
  const ability = TARGETED_TRIGGER.abilities[0];
  if (ability?.kind !== 'triggered') throw new Error('Ground Seal probe lost its trigger');
  return ability;
}

function castActions(state: GameState, oid: ObjectId): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.oid === oid,
  );
}

function resolveStack(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 12 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Ground Seal probe lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

describe('Ground Seal initial target enumeration', () => {
  it('blocks spell, activation, and trigger target spaces in both graveyards', () => {
    const open = board(false);
    const sealed = board(true);
    const openSource = oidOf(open.state, TARGETED_ACTIVATOR.name);
    const sealedSource = oidOf(sealed.state, TARGETED_ACTIVATOR.name);
    const expectedOpen = [...open.state.players[0].graveyard, ...open.state.players[1].graveyard];

    expect(graveyardTargets(targetChoicesFor(open.state, TARGETED_SPELL, 0))).toEqual(expectedOpen);
    expect(
      graveyardTargets(targetChoicesForActivation(open.state, targetedAbility(), 0, openSource)),
    ).toEqual(expectedOpen);
    expect(graveyardTargets(targetChoicesForEffects(open.state, targetedTrigger().effects, 0))).toEqual(
      expectedOpen,
    );

    expect(targetChoicesFor(sealed.state, TARGETED_SPELL, 0)).toEqual([[]]);
    expect(targetChoicesForActivation(sealed.state, targetedAbility(), 0, sealedSource)).toEqual([[]]);
    expect(targetChoicesForEffects(sealed.state, targetedTrigger().effects, 0)).toEqual([[]]);
  });

  it('removes targeted casts and activations from legal actions', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_SEAL, controller: 0 },
        { card: TARGETED_ACTIVATOR, controller: 0 },
        ...lands(SWAMP, 1).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[TARGETED_SPELL], []],
      graveyards: [[BURIED_MINE], [BURIED_THEIRS]],
    });
    const spell = handOidOf(start.state, 0, TARGETED_SPELL.name);
    const source = oidOf(start.state, TARGETED_ACTIVATOR.name);

    expect(castActions(start.state, spell)).toEqual([]);
    expect(
      legalActions(start.state).filter(
        (action) => action.type === 'activateAbility' && action.oid === source,
      ),
    ).toEqual([]);
  });
});

describe('Ground Seal live prohibition', () => {
  it('fizzles a preselected graveyard target when Ground Seal appears in response', () => {
    const start = scenario({
      battlefield: lands(SWAMP, 1).map((card) => ({ card, controller: 0 as const })),
      hands: [[TARGETED_SPELL], [GROUND_SEAL]],
      graveyards: [[BURIED_MINE], []],
    });
    const spell = handOidOf(start.state, 0, TARGETED_SPELL.name);
    const buried = start.state.players[0].graveyard[0];
    const seal = handOidOf(start.state, 1, GROUND_SEAL.name);
    if (buried === undefined) throw new Error('Ground Seal probe lost its graveyard card');
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: spell,
      targets: [{ kind: 'card', oid: buried }],
    });
    const appeared = moveObject(beginTrace(cast.state), seal, 'battlefield', { controller: 1 });
    const done = resolveTop(beginTrace(appeared.state));

    expect(done.state.objects[buried]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'spellFizzled')).toHaveLength(1);
  });

  it('restores legality on source departure and layer-6 ability loss, including a copied source', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_SEAL, controller: 0 },
        { card: BLANK, controller: 1 },
      ],
      graveyards: [[BURIED_MINE], [BURIED_THEIRS]],
    });
    const seal = oidOf(start.state, GROUND_SEAL.name);
    const blank = oidOf(start.state, BLANK.name);

    expect(graveyardTargets(targetChoicesForEffects(start.state, [RETURN_TARGET], 0))).toEqual([]);

    const gone = moveObject(beginTrace(start.state), seal, 'graveyard');
    expect(graveyardTargets(targetChoicesForEffects(gone.state, [RETURN_TARGET], 0))).toHaveLength(2);

    const copied = withContinuous(start.state, [
      copies(onlyObject(blank), seal),
      abilities(onlyObject(seal), { removeAll: true }),
    ]);
    expect(graveyardTargets(targetChoicesForEffects(copied, [RETURN_TARGET], 0))).toEqual([]);

    const stripped = withContinuous(copied, [abilities(onlyObject(blank), { removeAll: true })]);
    expect(graveyardTargets(targetChoicesForEffects(stripped, [RETURN_TARGET], 0))).toHaveLength(2);
  });

  it('leaves non-targeted graveyard choices and player-targeted graveyard effects legal', () => {
    const start = scenario({
      battlefield: [
        { card: GROUND_SEAL, controller: 0 },
        ...lands(SWAMP, 1).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[UNTARGETED_RECALL], []],
      graveyards: [[BURIED_MINE], [BURIED_THEIRS]],
    });
    const spell = handOidOf(start.state, 0, UNTARGETED_RECALL.name);
    const cast = castActions(start.state, spell)[0];
    if (cast === undefined) throw new Error('Ground Seal suppressed an untargeted graveyard spell');
    const asked = resolveStack(apply(start, cast));

    expect(pendingDecision(asked.state)?.kind).toBe('graveyardChoice');
    expect(targetChoicesForEffects(start.state, [TARGET_PLAYER_GRAVEYARD], 0)).toEqual([
      [
        { kind: 'player', player: 0 },
        { kind: 'player', player: 1 },
      ],
    ]);
  });

  it('still draws a card from Ground Seal entering the battlefield', () => {
    const draw = creature('Ground Seal Drawn Card', 1, 1);
    const start = scenario({
      battlefield: lands(FOREST, 2).map((card) => ({ card, controller: 0 as const })),
      hands: [[GROUND_SEAL], []],
      libraries: [[draw], []],
    });
    const seal = handOidOf(start.state, 0, GROUND_SEAL.name);
    const cast = castActions(start.state, seal)[0];
    if (cast === undefined) throw new Error('Ground Seal was not castable');
    const done = resolveStack(resolveStack(apply(start, cast)));

    expect(done.state.players[0].hand.map((oid) => done.state.objects[oid]?.card.name)).toEqual([draw.name]);
    expect(
      done.state.battlefield.some((oid) => done.state.objects[oid]?.card.name === GROUND_SEAL.name),
    ).toBe(true);
  });
});
