/** Security Blockade through attachment, trigger, grant, and prevention resolution. */
import { parseCard } from '@mtg/dsl';
import {
  abilitiesOf,
  applyDamage,
  beginTrace,
  controllerOf,
  hasKeyword,
  isLegalAuraHost,
  legalActions,
  moveObject,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type Action,
  type DamageInstance,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, ISLAND, lands, PLAINS } from './cards';
import { oidOf } from './helpers';

const SECURITY_BLOCKADE = parseCard({
  kind: 'enchantment',
  id: 'rtr-020-security-blockade-kernel',
  name: 'Security Blockade',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 20 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [
      {
        kind: 'grantActivatedAbility',
        ability: {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [
            {
              kind: 'preventNextDamageToYouAndRetaliate',
              amount: 1,
              target: { kind: 'noTarget' },
            },
          ],
        },
      },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisAura',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Knight',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Knight'],
            keywords: ['vigilance'],
          },
        },
      ],
    },
  ],
});

const INVALID_HOST = creature('Security Blockade Invalid Host', 2, 2);
const DAMAGE_SOURCE = creature('Security Blockade Damage Source', 3, 3);

function passesFrom(player: 0 | 1): readonly Action[] {
  return [
    { type: 'passPriority', player },
    { type: 'passPriority', player: player === 0 ? 1 : 0 },
  ];
}

function named(state: GameState, name: string): ObjectId {
  return oidOf(state, name);
}

function board(hostController: 0 | 1 = 0): GameState {
  return scenario({
    active: 0,
    battlefield: [
      ...lands(PLAINS, 3).map((card, index) => ({
        card,
        controller: 0 as const,
        summoningSick: index === 0,
      })),
      { card: ISLAND, controller: hostController, summoningSick: true },
      { card: INVALID_HOST, controller: 1 as const },
      { card: DAMAGE_SOURCE, controller: 1 as const },
    ],
    hands: [[SECURITY_BLOCKADE], []],
  }).state;
}

function castAndResolveEntry(start: GameState, host: ObjectId): ReduceResult {
  const aura = start.players[0].hand.find((oid) => start.objects[oid]?.card.id === SECURITY_BLOCKADE.id);
  if (aura === undefined) throw new Error('Security Blockade is not in hand');
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid: aura,
    targets: [{ kind: 'permanent', oid: host }],
  });
  const entered = reduceAll(cast.state, passesFrom(0));
  const tokenMade = reduceAll(entered.state, passesFrom(0));
  return { state: tokenMade.state, events: [...cast.events, ...entered.events, ...tokenMade.events] };
}

function activationFor(
  state: GameState,
  player: 0 | 1,
  host: ObjectId,
): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' && candidate.player === player && candidate.oid === host,
  );
  if (action === undefined) throw new Error('enchanted land has no activation');
  return action;
}

function damage(state: GameState, player: 0 | 1, amount: number): DamageInstance {
  return {
    sourceOid: named(state, DAMAGE_SOURCE.name),
    controller: 1,
    recipient: { kind: 'player', player },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
    preventable: true,
  };
}

describe('Security Blockade in the kernel', () => {
  it('enchants only a land and creates exactly one white 2/2 vigilant Knight', () => {
    const start = board();
    expect(isLegalAuraHost(start, SECURITY_BLOCKADE, named(start, INVALID_HOST.name))).toBe(false);
    const host = named(start, 'Island');
    expect(isLegalAuraHost(start, SECURITY_BLOCKADE, host)).toBe(true);
    const resolved = castAndResolveEntry(start, host);
    const token = named(resolved.state, 'Knight');
    expect(controllerOf(resolved.state, token)).toBe(0);
    expect([powerOf(resolved.state, token), toughnessOf(resolved.state, token)]).toEqual([2, 2]);
    expect(resolved.state.objects[token]?.card.colors).toEqual(['W']);
    expect(hasKeyword(resolved.state, token, 'vigilance')).toBe(true);
  });

  it('lets a summoning-sick land pay the tap cost before the shield resolves, then prevents one point once', () => {
    const start = board();
    const host = named(start, 'Island');
    const entered = castAndResolveEntry(start, host);
    const activated = reduce(entered.state, activationFor(entered.state, 0, host));
    expect(activated.state.objects[host]?.tapped).toBe(true);
    expect(activated.state.replacements).toEqual([]);
    const shielded = reduceAll(activated.state, passesFrom(0));
    expect(shielded.state.replacements).toHaveLength(1);
    const hit = applyDamage(beginTrace(shielded.state), [damage(shielded.state, 0, 3)]);
    expect(hit.state.players[0].life).toBe(18);
    expect(hit.state.replacements).toEqual([]);
  });

  it('protects the land controller, not the Aura controller', () => {
    const start = board(1);
    const host = named(start, 'Island');
    const entered = castAndResolveEntry(start, host);
    const priority = reduce(entered.state, { type: 'passPriority', player: 0 });
    const activated = reduce(priority.state, activationFor(priority.state, 1, host));
    const shielded = reduceAll(activated.state, passesFrom(1));
    const hitBoth = applyDamage(beginTrace(shielded.state), [
      damage(shielded.state, 0, 2),
      damage(shielded.state, 1, 2),
    ]);
    expect(hitBoth.state.players.map((player) => player.life)).toEqual([18, 19]);
  });

  it('removes the granted activation when the Aura leaves', () => {
    const start = board();
    const host = named(start, 'Island');
    const entered = castAndResolveEntry(start, host);
    const aura = named(entered.state, SECURITY_BLOCKADE.name);
    expect(abilitiesOf(entered.state, host).some((ability) => ability.kind === 'activated')).toBe(true);
    const gone = moveObject(beginTrace(entered.state), aura, 'graveyard');
    expect(abilitiesOf(gone.state, host).some((ability) => ability.kind === 'activated')).toBe(false);
  });
});
