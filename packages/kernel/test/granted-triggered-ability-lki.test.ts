/** Layer-granted death triggers retain their derived ability through departure. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, scenario, settle } from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';

const HOST = creature('Borrowed Witness', 2, 2);
const DEATH_GIFT = parseCard({
  kind: 'enchantment',
  id: 'test-death-gift',
  name: 'Death Gift',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'grantTriggeredAbility',
        ability: {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      },
    ],
  },
});

describe('layer-granted triggered ability LKI', () => {
  it('puts exactly one host-controlled granted selfDies trigger on the stack', () => {
    const start = scenario({ battlefield: [{ card: HOST, controller: 1 }], hands: [[DEATH_GIFT], []] }).state;
    const aura = start.players[0].hand[0];
    if (aura === undefined) throw new Error('missing test Aura');
    const host = oidOf(start, HOST.name);
    const attached = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host });

    const dead = settle(moveObject(beginTrace(attached.state), host, 'graveyard'));
    const granted = dead.state.stack.filter((entry) => entry.ability?.sourceOid === host);

    expect(granted).toHaveLength(1);
    expect(granted[0]?.controller).toBe(1);
  });
});
