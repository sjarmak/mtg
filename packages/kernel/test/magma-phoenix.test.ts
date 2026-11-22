/** Native simultaneous damage and graveyard activation for M11 Magma Phoenix. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  scenario,
  validateAction,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, lands, MOUNTAIN, sorcery } from './cards';
import { apply, oidOf } from './helpers';

const MAGMA_PHOENIX = parseCard({
  kind: 'creature',
  id: 'm11-150',
  name: 'Magma Phoenix',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 150 },
  colors: ['R'],
  manaCost: { generic: 3, R: 2 },
  subtypes: ['Phoenix'],
  keywords: ['flying'],
  power: 3,
  toughness: 3,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [
        {
          kind: 'dealDamage',
          amount: 3,
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          players: 'eachPlayer',
          target: { kind: 'noTarget' },
        },
      ],
    },
    {
      kind: 'activated',
      activationZone: 'graveyard',
      cost: { mana: { generic: 3, R: 2 } },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
});

const DOOM = sorcery('Exact Doom', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }]);
const SURVIVOR = creature('Four Toughness', 4, 4);
const DOOMED = creature('Two Toughness', 2, 2);
const PROTECTED = creature('Red Ward', 4, 4, {
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
});

function pass(current: ReduceResult): ReduceResult {
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'priority') throw new Error('test lost priority');
  return apply(current, { type: 'passPriority', player: decision.player });
}

describe('Magma Phoenix', () => {
  it('keeps its dies trigger after departure and damages creatures and players through one damage path', () => {
    let current = scenario({
      battlefield: [
        { card: MAGMA_PHOENIX, controller: 0 },
        { card: SURVIVOR, controller: 0 },
        { card: DOOMED, controller: 1 },
        { card: PROTECTED, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[DOOM], []],
    });
    const phoenix = oidOf(current.state, MAGMA_PHOENIX.name);
    const survivor = oidOf(current.state, SURVIVOR.name);
    const doomed = oidOf(current.state, DOOMED.name);
    const protectedCreature = oidOf(current.state, PROTECTED.name);
    const land = oidOf(current.state, MOUNTAIN.name);
    const cast = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === phoenix),
    );
    if (cast === undefined) throw new Error('the destroy spell could not target Magma Phoenix');

    current = apply(current, cast);
    current = pass(pass(current));
    expect(current.state.objects[phoenix]?.zone).toBe('graveyard');
    expect(current.state.stack).toHaveLength(1);
    expect(
      current.events.filter((event) => event.type === 'abilityTriggered' && event.condition === 'selfDies'),
    ).toHaveLength(1);

    const exiled = moveObject(beginTrace(current.state), phoenix, 'exile');
    current = { state: exiled.state, events: [...current.events, ...exiled.events] };
    current = pass(pass(current));

    expect(current.state.stack).toHaveLength(0);
    expect(current.state.players.map((player) => player.life)).toEqual([17, 17]);
    expect(current.state.objects[phoenix]?.zone).toBe('exile');
    expect(current.state.objects[survivor]).toMatchObject({ zone: 'battlefield', damage: 3 });
    expect(current.state.objects[doomed]?.zone).toBe('graveyard');
    expect(current.state.objects[protectedCreature]).toMatchObject({ zone: 'battlefield', damage: 0 });
    expect(current.state.objects[land]).toMatchObject({ zone: 'battlefield', damage: 0 });

    const dealt = eventsOfType(current.events, 'damageDealt').filter((event) => event.sourceOid === phoenix);
    expect(
      dealt.map((event) =>
        event.target.kind === 'player' ? `player:${String(event.target.player)}` : event.target.oid,
      ),
    ).toEqual(expect.arrayContaining([survivor, doomed, 'player:0', 'player:1']));
    expect(dealt.some((event) => event.target.kind === 'permanent' && event.target.oid === land)).toBe(false);
    expect(
      eventsOfType(current.events, 'damagePrevented').some(
        (event) =>
          event.sourceOid === phoenix &&
          event.target.kind === 'permanent' &&
          event.target.oid === protectedCreature,
      ),
    ).toBe(true);
  });

  it('offers only the owned graveyard copy, pays five mana, and returns that exact card', () => {
    let current = scenario({
      battlefield: lands(MOUNTAIN, 5).map((card) => ({ card, controller: 0 as const })),
      graveyards: [[MAGMA_PHOENIX], [MAGMA_PHOENIX]],
    });
    const own = current.state.players[0].graveyard[0];
    const opposing = current.state.players[1].graveyard[0];
    if (own === undefined || opposing === undefined) throw new Error('fixture lost a graveyard copy');
    const activations = legalActions(current.state).filter(
      (action): action is Extract<Action, { type: 'activateAbility' }> => action.type === 'activateAbility',
    );
    const activation = activations.find((action) => action.oid === own);
    if (activation === undefined) throw new Error('owned Magma Phoenix was not offered');
    expect(activations.some((action) => action.oid === opposing)).toBe(false);
    expect(validateAction(current.state, { ...activation, oid: opposing })).toBe(
      'source is not in your graveyard',
    );

    current = apply(current, activation);
    expect(current.state.objects[own]?.zone).toBe('graveyard');
    expect(current.state.battlefield.filter((oid) => current.state.objects[oid]?.tapped)).toHaveLength(5);
    current = pass(pass(current));
    expect(current.state.objects[own]?.zone).toBe('hand');
    expect(current.state.objects[opposing]?.zone).toBe('graveyard');
  });
});
