/** Aura host policy values the effects of an ability granted to that host. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput, type TriggeredAbility } from '@mtg/dsl';
import type { Action, AgentView, GameState, ObjectId } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { bestTargetingPerCard } from '../src/policies/cast';
import { creature } from './cards';

const OWN_HOST = creature('Policy Friend', 2, 2);
const OPPONENT_HOST = creature('Policy Enemy', 2, 2);

function oidOf(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no battlefield object named ${name}`);
  return oid;
}

function grantedAura(id: string, ability: TriggeredAbility) {
  return parseCard({
    kind: 'enchantment',
    id,
    name: id,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: id === 'sacrifice-grant' ? 2 : 3 },
    manaCost: { B: 1 },
    colors: ['B'],
    subtypes: ['Aura'],
    aura: {
      enchant: 'creature',
      modifications: [{ kind: 'grantTriggeredAbility', ability }],
    },
  } as CardInput);
}

function chosenHost(ability: TriggeredAbility): string | undefined {
  const aura = grantedAura(
    ability.effects[0]?.kind === 'sacrificeSelf' ? 'sacrifice-grant' : 'draw-grant',
    ability,
  );
  const state = scenario({
    battlefield: [
      { card: OWN_HOST, controller: 0 },
      { card: OPPONENT_HOST, controller: 1 },
    ],
    hands: [[aura], []],
  }).state;
  const oid = state.players[0].hand[0];
  if (oid === undefined) throw new Error('missing policy Aura');
  const targets = [oidOf(state, OWN_HOST.name), oidOf(state, OPPONENT_HOST.name)];
  const options: readonly Extract<Action, { type: 'castSpell' }>[] = targets.map((host) => ({
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'permanent', oid: host }],
  }));
  const view: AgentView = {
    state: observeState(state, 0, 'test/aura-trigger-policy.test.ts:58'),
    player: 0,
    decision: { kind: 'priority', player: 0, options, complete: true },
  };
  const target = bestTargetingPerCard(view, DEFAULT_GREEDY_CONFIG)[0]?.action.targets[0];
  return target?.kind === 'permanent' ? state.objects[target.oid]?.card.name : undefined;
}

describe('Aura granted-trigger targeting policy', () => {
  it('prefers an opposing host for an upkeep sacrifice grant', () => {
    const ability: TriggeredAbility = {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
    };
    expect(chosenHost(ability)).toBe(OPPONENT_HOST.name);
  });

  it('prefers its own host for a beneficial upkeep draw grant', () => {
    const ability: TriggeredAbility = {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    };
    expect(chosenHost(ability)).toBe(OWN_HOST.name);
  });
});
