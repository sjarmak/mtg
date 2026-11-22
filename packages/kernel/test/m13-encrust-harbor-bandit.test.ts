/** Hostile reducer proofs for M13 Encrust and Harbor Bandit. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  canBlock,
  checkStateBasedActions,
  controllerOf,
  legalActions,
  moveObject,
  objectFilter,
  pendingDecision,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  targetChoicesFor,
  toughnessOf,
} from '@mtg/kernel';
import { artifact, creature, ISLAND, lands, MOUNTAIN } from './cards';
import { controlledBy, retype } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const ENCRUST = parseCard({
  kind: 'enchantment',
  id: 'm13-encrust',
  name: 'Encrust',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 49 },
  manaCost: { generic: 1, U: 2 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'artifactOrCreature',
    modifications: [{ kind: 'doesNotUntap' }, { kind: 'cantActivateAbilities' }],
  },
});

const HARBOR_BANDIT = parseCard({
  kind: 'creature',
  id: 'm13-harbor-bandit',
  name: 'Harbor Bandit',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 95 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Human', 'Rogue'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
      enabledWhile: { kind: 'controlsSubtype', subtype: 'Island', atLeast: 1 },
    },
    {
      kind: 'activated',
      cost: { mana: { generic: 1, U: 1 }, tapSelf: false },
      effects: [{ kind: 'cantBeBlockedThisTurn', target: { kind: 'selfCreature' } }],
    },
  ],
});

const RELIC = artifact('Clockwork Relic', { generic: 2 }, [
  {
    kind: 'activated',
    cost: { mana: { generic: 1 }, tapSelf: false },
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
]);
const ARTIFACT_CREATURE = creature('Steel Bear', 2, 2, { artifact: true });
const BEAR = creature('Runeclaw Bear', 2, 2);
const BLOCKER = creature('Harbor Blocker', 2, 2);

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function castAura(start: GameState, target: ObjectId): ReduceResult {
  const oid = start.players[0].hand.find((candidate) => start.objects[candidate]?.card.id === ENCRUST.id);
  if (oid === undefined) throw new Error('no Encrust in hand');
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'permanent', oid: target }],
  });
  const resolved = reduceAll(cast.state, PASSES);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 300; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('game ended before requested turn');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error('turn walk did not terminate');
}

function settleStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20; guard += 1) {
    if (current.state.stack.length === 0 && guard > 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('stack stalled outside priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('stack did not settle');
}

describe('Encrust host union and live restrictions', () => {
  it('offers a plain artifact, artifact creature, and creature while rejecting a land', () => {
    const start = scenario({
      battlefield: [
        { card: RELIC, controller: 0 },
        { card: ARTIFACT_CREATURE, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[ENCRUST], []],
    }).state;
    const offered = targetChoicesFor(start, ENCRUST, 0)[0] ?? [];
    const names = offered.flatMap((target) =>
      target?.kind === 'permanent' ? [start.objects[target.oid]?.card.name] : [],
    );
    expect(names).toEqual(expect.arrayContaining(['Clockwork Relic', 'Steel Bear', 'Runeclaw Bear']));
    expect(names).not.toContain('Mountain');
  });

  it('holds a tapped artifact down and suppresses its printed activation only while attached', () => {
    const start = scenario({
      battlefield: [
        { card: RELIC, controller: 0, tapped: true },
        ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[ENCRUST], []],
    });
    const relic = oidOf(start.state, 'Clockwork Relic');
    const attached = castAura(start.state, relic);
    expect(
      legalActions(attached.state).some(
        (action) => action.type === 'activateAbility' && action.oid === relic,
      ),
    ).toBe(false);
    expect(passUntilTurn(attached, 3).state.objects[relic]?.tapped).toBe(true);

    const aura = oidOf(attached.state, 'Encrust');
    const gone = moveObject(beginTrace(attached.state), aura, 'graveyard');
    expect(
      legalActions(gone.state).some((action) => action.type === 'activateAbility' && action.oid === relic),
    ).toBe(true);
  });

  it('stays on an artifact creature while either type remains and falls off when neither does', () => {
    const start = scenario({
      battlefield: [
        { card: ARTIFACT_CREATURE, controller: 0 },
        ...lands(ISLAND, 4).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[ENCRUST], []],
    });
    const host = oidOf(start.state, 'Steel Bear');
    const attached = castAura(start.state, host);
    const aura = oidOf(attached.state, 'Encrust');

    const artifactOnly = {
      ...attached.state,
      continuous: [
        ...attached.state.continuous,
        retype(objectFilter({ oids: [host] }), { removeTypes: ['creature'] }),
      ],
    };
    expect(checkStateBasedActions({ state: artifactOnly, events: [] }).state.objects[aura]?.zone).toBe(
      'battlefield',
    );

    const neither = {
      ...artifactOnly,
      continuous: [
        ...artifactOnly.continuous,
        retype(objectFilter({ oids: [host] }), { removeTypes: ['artifact'] }),
      ],
    };
    const checked = checkStateBasedActions({ state: neither, events: [] });
    expect(checked.state.objects[aura]?.zone).toBe('graveyard');
    expect(checked.state.objects[aura]?.attachedTo).toBeUndefined();
  });
});

describe('Harbor Bandit live condition and self activation', () => {
  it('gains and loses the Island bonus from current control, including a source control change', () => {
    const start = scenario({
      battlefield: [
        { card: HARBOR_BANDIT, controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
    }).state;
    const bandit = oidOf(start, 'Harbor Bandit');
    const island = oidOf(start, 'Island');
    expect([powerOf(start, bandit), toughnessOf(start, bandit)]).toEqual([3, 3]);

    const islandLost = {
      ...start,
      continuous: [...start.continuous, controlledBy(objectFilter({ oids: [island] }), 1)],
    };
    expect([powerOf(islandLost, bandit), toughnessOf(islandLost, bandit)]).toEqual([2, 2]);

    const sourceChanged = {
      ...islandLost,
      continuous: [...islandLost.continuous, controlledBy(objectFilter({ oids: [bandit] }), 1)],
    };
    expect(controllerOf(sourceChanged, bandit)).toBe(1);
    expect([powerOf(sourceChanged, bandit), toughnessOf(sourceChanged, bandit)]).toEqual([3, 3]);
  });

  it('offers a targetless self activation, blocks every blocker for this turn, and expires next turn', () => {
    const start = scenario({
      battlefield: [
        { card: HARBOR_BANDIT, controller: 0 },
        { card: BLOCKER, controller: 1 },
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    const bandit = oidOf(start.state, 'Harbor Bandit');
    const blocker = oidOf(start.state, 'Harbor Blocker');
    expect(canBlock(start.state, blocker, bandit)).toBe(true);
    const activation = legalActions(start.state).find(
      (action) => action.type === 'activateAbility' && action.oid === bandit,
    );
    expect(activation).toMatchObject({ targets: [null] });
    if (activation === undefined) return;

    const resolved = settleStack(apply(start, activation));
    expect(canBlock(resolved.state, blocker, bandit)).toBe(false);
    expect(resolved.state.turnCombatRules).toContainEqual({
      rule: 'cantBeBlockedThisTurn',
      sourceOid: bandit,
      subject: bandit,
    });

    const nextTurn = passUntilTurn(resolved, 3);
    expect(canBlock(nextTurn.state, blocker, bandit)).toBe(true);
    expect(nextTurn.state.turnCombatRules).toEqual([]);
  });
});
