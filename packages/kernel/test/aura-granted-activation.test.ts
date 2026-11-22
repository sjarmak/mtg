/** Layer-6 activated-ability grants from Auras are live attachment-derived state. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard } from '@mtg/dsl';
import {
  abilitiesOf,
  attachmentOf,
  beginTrace,
  hasKeyword,
  isLegalAuraHost,
  legalActions,
  moveObject,
  reduce,
  reduceAll,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';

const HOST = parseCard({
  kind: 'creature',
  id: 'tst-granted-host',
  name: 'Granted Host',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  colors: [],
  manaCost: { generic: 2 },
  subtypes: ['Bear'],
  power: 2,
  toughness: 2,
});

const GLEE = parseCard({
  kind: 'enchantment',
  id: 'rtr-65',
  name: 'Deviant Glee',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 65 },
  manaCost: { B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      { kind: 'statBonus', power: 2, toughness: 1 },
      {
        kind: 'grantActivatedAbility',
        ability: {
          kind: 'activated',
          cost: { mana: { R: 1 }, tapSelf: false },
          effects: [
            {
              kind: 'grantKeywordUntilEndOfTurn',
              keyword: 'trample',
              target: { kind: 'selfCreature' },
            },
          ],
        },
      },
    ],
  },
});

const CONNECTIONS = parseCard({
  kind: 'enchantment',
  id: 'rtr-83',
  name: 'Underworld Connections',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 83 },
  manaCost: { generic: 1, B: 2 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [
      {
        kind: 'grantActivatedAbility',
        ability: {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true, payLife: 1 },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      },
    ],
  },
});

function named(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no ${name} on battlefield`);
  return oid;
}

function inHand(state: GameState, player: 0 | 1, name: string): ObjectId {
  const oid = state.players[player].hand.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no ${name} in hand`);
  return oid;
}

function activationFor(state: GameState, oid: ObjectId): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' && candidate.oid === oid,
  );
  if (action === undefined) throw new Error(`no activation for ${oid}`);
  return action;
}

describe('Aura-granted activations', () => {
  it('belongs to the host only while attached and resolves from that source', () => {
    const start = scenario({
      battlefield: [
        { card: HOST, controller: 0, summoningSick: false },
        { card: basicLand('Mountain', 'TST', 2), controller: 0 },
      ],
      hands: [[GLEE], []],
    }).state;
    const host = named(start, HOST.name);
    const aura = inHand(start, 0, GLEE.name);
    const attached = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host });
    expect(attachmentOf(attached.state, aura)).toBe(host);
    expect(abilitiesOf(attached.state, host).some((ability) => ability.kind === 'activated')).toBe(true);
    expect(abilitiesOf(attached.state, aura).some((ability) => ability.kind === 'activated')).toBe(false);

    const activated = reduce(attached.state, activationFor(attached.state, host));
    const detached = moveObject(beginTrace(activated.state), aura, 'graveyard');
    expect(abilitiesOf(detached.state, host).some((ability) => ability.kind === 'activated')).toBe(false);
    const resolved = reduceAll(detached.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(hasKeyword(resolved.state, host, 'trample')).toBe(true);
  });

  it('accepts only a land host and charges tap plus life before drawing', () => {
    const draw = basicLand('Island', 'TST', 3);
    const land = basicLand('Swamp', 'TST', 4);
    const start = scenario({
      battlefield: [
        { card: HOST, controller: 0, summoningSick: false },
        { card: land, controller: 0 },
      ],
      hands: [[CONNECTIONS], []],
      libraries: [[draw], []],
    }).state;
    const host = named(start, HOST.name);
    const aura = inHand(start, 0, CONNECTIONS.name);
    const swamp = named(start, 'Swamp');
    expect(isLegalAuraHost(start, CONNECTIONS, host)).toBe(false);
    expect(isLegalAuraHost(start, CONNECTIONS, swamp)).toBe(true);

    const attached = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: swamp });
    const activated = reduce(attached.state, activationFor(attached.state, swamp));
    expect(activated.state.objects[swamp]?.tapped).toBe(true);
    expect(activated.state.players[0].life).toBe(19);
    const resolved = reduceAll(activated.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(resolved.state.players[0].hand.map((oid) => resolved.state.objects[oid]?.card.name)).toContain(
      'Island',
    );
  });
});
