import { expect, it } from 'vitest';
import { PROJECTION_VERSION } from '@mtg/engine';
import { bridgeResponse } from '../src/observed/protocol';

const object = {
  oid: 'token-1',
  name: 'Token',
  typeLine: 'Creature — Zombie',
  power: 4,
  toughness: 4,
  tapped: false,
  attacking: false,
  damage: 0,
  controller: 0,
  counters: {},
};
function snapshot(extra: Record<string, unknown> = {}, seatExtra: Record<string, unknown> = {}) {
  const seat = {
    id: 0,
    name: 'Player',
    life: 20,
    hand: [],
    handSize: 0,
    librarySize: 30,
    graveyard: [],
    exile: [],
    battlefield: [{ ...object, ...extra }],
    ...seatExtra,
  };
  return {
    protocolVersion: 2,
    type: 'snapshot',
    requestId: 'request',
    sessionId: 'session',
    revision: 0,
    status: 'awaiting',
    events: [],
    decision: null,
    result: null,
    view: {
      version: PROJECTION_VERSION,
      turn: { number: 1, active: 0, phase: 'Main', step: 'Main' },
      priority: 0,
      stack: [],
      seats: [seat, { ...seat, id: 1, hand: null, battlefield: [] }],
    },
  };
}

it.each([
  { colors: ['B'], manaCost: null, token: true },
  { colors: [], manaCost: '{0}', token: false },
  { colors: ['W', 'U'], manaCost: '{W}{U}', token: false },
])('preserves reported characteristics without confusing no cost with zero: %j', (characteristics) => {
  const result = bridgeResponse.parse(snapshot({ characteristics }));
  if (result.type !== 'snapshot') throw new Error('Expected snapshot');
  expect(result.view.seats[0].battlefield[0]).toMatchObject({ characteristics });
  expect(result.view.seats[1].hand).toBeNull();
});

it('allows unreported characteristics without fabricating defaults', () => {
  const result = bridgeResponse.parse(snapshot());
  if (result.type !== 'snapshot') throw new Error('Expected snapshot');
  expect(result.view.seats[0].battlefield[0]).not.toHaveProperty('characteristics');
});

it.each([
  { colors: ['B'], token: true },
  { colors: ['C'], manaCost: null, token: true },
  { colors: ['W'], manaCost: null, token: 'yes' },
  { colors: [], manaCost: null, token: true, hidden: 'library' },
])('rejects incomplete or malformed characteristics: %j', (characteristics) => {
  expect(bridgeResponse.safeParse(snapshot({ characteristics })).success).toBe(false);
});

it("carries a permanent's keywords, keeps an empty list as none and omits the key when unreported", () => {
  const reported = bridgeResponse.parse(snapshot({ keywords: ['reach', 'first strike'] }));
  const empty = bridgeResponse.parse(snapshot({ keywords: [] }));
  const unreported = bridgeResponse.parse(snapshot());
  if (reported.type !== 'snapshot' || empty.type !== 'snapshot' || unreported.type !== 'snapshot')
    throw new Error('Expected snapshot');
  expect(reported.view.seats[0].battlefield[0]?.keywords).toEqual(['reach', 'first strike']);
  expect(empty.view.seats[0].battlefield[0]?.keywords).toEqual([]);
  expect(unreported.view.seats[0].battlefield[0]).not.toHaveProperty('keywords');
});

it.each([[['']], ['reach'], [[1]], [null]])('rejects malformed keywords: %j', (keywords) => {
  expect(bridgeResponse.safeParse(snapshot({ keywords })).success).toBe(false);
});

it('carries a soulbond partner by oid and omits the key on a permanent with none', () => {
  const paired = bridgeResponse.parse(snapshot({ pairedWith: 'forge-card-7' }));
  const unpaired = bridgeResponse.parse(snapshot());
  if (paired.type !== 'snapshot' || unpaired.type !== 'snapshot') throw new Error('Expected snapshot');
  expect(paired.view.seats[0].battlefield[0]?.pairedWith).toBe('forge-card-7');
  expect(unpaired.view.seats[0].battlefield[0]).not.toHaveProperty('pairedWith');
});

it.each([[''], [7], [['forge-card-7']], [null]])('rejects a malformed pairedWith: %j', (pairedWith) => {
  expect(bridgeResponse.safeParse(snapshot({ pairedWith })).success).toBe(false);
});

it("carries a seat's poison and its other counters, and omits both keys when unreported", () => {
  const held = bridgeResponse.parse(snapshot({}, { poison: 3, playerCounters: { ENERGY: 4, RAD: 1 } }));
  const none = bridgeResponse.parse(snapshot({}, { poison: 0 }));
  const unreported = bridgeResponse.parse(snapshot());
  if (held.type !== 'snapshot' || none.type !== 'snapshot' || unreported.type !== 'snapshot')
    throw new Error('Expected snapshot');
  expect(held.view.seats[0]).toMatchObject({ poison: 3, playerCounters: { ENERGY: 4, RAD: 1 } });
  expect(none.view.seats[0].poison).toBe(0);
  expect(none.view.seats[0]).not.toHaveProperty('playerCounters');
  expect(unreported.view.seats[0]).not.toHaveProperty('poison');
  expect(unreported.view.seats[0]).not.toHaveProperty('playerCounters');
});

it.each([
  [{ poison: -1 }],
  [{ poison: 1.5 }],
  [{ poison: '3' }],
  [{ playerCounters: { ENERGY: -1 } }],
  [{ playerCounters: { ENERGY: 1.5 } }],
  [{ playerCounters: { '': 1 } }],
  [{ playerCounters: [1] }],
])('rejects malformed seat counters: %j', (seatExtra) => {
  expect(bridgeResponse.safeParse(snapshot({}, seatExtra)).success).toBe(false);
});

it('requires projection v4 and rejects obsolete v3 snapshots', () => {
  expect(PROJECTION_VERSION).toBe(4);
  const value = snapshot();
  expect(bridgeResponse.safeParse({ ...value, view: { ...value.view, version: 3 } }).success).toBe(false);
});

it('accepts strict structural mana metadata and rejects malformed source data', () => {
  const value = snapshot();
  const decision = {
    seat: 0,
    kind: 'mana-payment',
    prompt: 'presentation only',
    options: [
      {
        id: 'mana-source-1-0-G',
        text: 'presentation only',
        targets: [],
        manaPayment: { kind: 'mana', resource: 'forge-card-1', color: 'G' },
      },
      {
        id: 'mana-payment-cancel',
        text: 'presentation only',
        targets: [],
        manaPayment: { kind: 'cancel' },
      },
    ],
    input: null,
    manaPayment: { unpaid: ['{1}', '{G}'] },
    complete: true,
  };
  expect(bridgeResponse.safeParse({ ...value, decision }).success).toBe(true);
  expect(
    bridgeResponse.safeParse({
      ...value,
      decision: {
        ...decision,
        options: [
          {
            ...decision.options[0],
            manaPayment: { kind: 'mana', resource: '', color: 'green' },
          },
        ],
      },
    }).success,
  ).toBe(false);
});
