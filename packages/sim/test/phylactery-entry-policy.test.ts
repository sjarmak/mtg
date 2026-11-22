/**
 * Reported from a played game: the bot cast Phylactery Lich with no artifact on
 * its battlefield, the Lich's CR 603.8 state trigger sacrificed it immediately,
 * and the bot then played the artifact it had been holding.
 *
 * The Lich's entry replacement puts its phylactery counter on an artifact the
 * controller already has; with no artifact to receive it `entryChoiceFor`
 * returns null, no counter is placed anywhere, and `collectStateTriggers` fires
 * the linked "you control no permanent with a phylactery counter" trigger
 * before the bot regains priority. Nothing in the cast policy read either
 * clause, so a 5/5 indestructible body scored its full printed value for a
 * permanent that could not survive its own arrival.
 */
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  addCounters,
  legalActions,
  NO_COUNTERS,
  scenario,
  type AgentView,
  type GameState,
} from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { bestTargetingPerCard, chooseCast } from '../src/policies/cast';

const LICH = parseCard({
  kind: 'creature',
  id: 'm11-110-phylactery-policy',
  name: 'Phylactery Lich',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 110 },
  colors: ['B'],
  subtypes: ['Zombie'],
  manaCost: { B: 3 },
  power: 5,
  toughness: 5,
  keywordAbilities: [{ kind: 'indestructible' }],
  entryReplacement: {
    kind: 'putCounterOnControlledPermanent',
    permanentType: 'artifact',
    counter: 'phylactery',
    count: 1,
  },
  abilities: [
    {
      kind: 'stateTriggered',
      condition: { kind: 'controllerControlsNoPermanentWithCounter', counter: 'phylactery' },
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    },
  ],
} as unknown as CardInput);

const SWAMP = parseCard({
  kind: 'land',
  id: 'phylactery-policy-swamp',
  name: 'Swamp',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  basicLandType: 'Swamp',
  supertypes: ['basic'],
  producesMana: ['B'],
} as unknown as CardInput);

const RELIC = parseCard({
  kind: 'artifact',
  id: 'phylactery-policy-relic',
  name: 'Quiet Relic',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  colors: [],
  manaCost: { generic: 2 },
} as unknown as CardInput);

/** The bot is player 0 and holds the Lich with three Swamps untapped. */
function board(extra: readonly Card[]): GameState {
  return scenario({
    active: 0,
    step: 'precombatMain',
    battlefield: [
      { card: SWAMP, controller: 0 as const },
      { card: SWAMP, controller: 0 as const },
      { card: SWAMP, controller: 0 as const },
      ...extra.map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[LICH], []],
  }).state;
}

function viewOf(state: GameState): AgentView {
  const options = legalActions(state).filter(
    (action) => action.type !== 'passPriority' && action.type !== 'concede',
  );
  return {
    state: observeState(state, 0, 'test/phylactery-entry-policy.test.ts:92'),
    player: 0,
    decision: { kind: 'priority', player: 0, options, complete: true },
  };
}

function lichValue(state: GameState): number {
  const candidate = bestTargetingPerCard(viewOf(state), DEFAULT_GREEDY_CONFIG).find(
    (entry) => entry.card.name === 'Phylactery Lich',
  );
  if (candidate === undefined) throw new Error('the policy offered no Phylactery Lich candidate');
  return candidate.value;
}

describe('a permanent that cannot survive its own arrival', () => {
  it('is held when nothing can carry its counter', () => {
    const state = board([]);
    expect(lichValue(state)).toBeLessThanOrEqual(0);
    expect(chooseCast(viewOf(state), DEFAULT_GREEDY_CONFIG)).toBeNull();
  });

  it('is cast once an artifact is there to carry it', () => {
    const state = board([RELIC]);
    expect(lichValue(state)).toBeGreaterThan(0);
    const chosen = chooseCast(viewOf(state), DEFAULT_GREEDY_CONFIG);
    expect(chosen?.oid).toBe(state.players[0].hand[0]);
  });

  it('is cast when the controller already holds the counter elsewhere', () => {
    const state = board([RELIC]);
    const relic = state.battlefield.find((oid) => state.objects[oid]?.card.name === 'Quiet Relic');
    if (relic === undefined) throw new Error('the fixture lost its artifact');
    const counted: GameState = {
      ...state,
      objects: {
        ...state.objects,
        [relic]: { ...state.objects[relic]!, counters: addCounters(NO_COUNTERS, 'phylactery', 1) },
      },
    };
    expect(lichValue(counted)).toBeGreaterThan(0);
  });
});
