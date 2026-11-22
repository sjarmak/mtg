/**
 * The per-seat projection over the Forge wire, proven without a JVM.
 *
 * The judge of every case here is `@mtg/engine`'s `auditSeatPayloads`, the same
 * search `checkBackend` runs over a whole game, asked over fabricated snapshots
 * that carry both hands the way `ForgeBridge.java` writes them for two local
 * seats. Each case plants one leak the bridge is known to write (a `sourceOid`
 * in an event's detail, a card name in its sentence) and asks the audit whether
 * the projected payload still carries it.
 */
import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '@mtg/engine';
import { auditSeatPayloads } from '@mtg/engine';
import { concealedFrom, contractDecision, seatProjection } from '../src/observed/seat-projection';
import { FORGE_BRIDGE_PROTOCOL_VERSION } from '../src/observed/protocol';
import type { SnapshotResponse } from '../src/observed/protocol';

/** An object as the Forge wire carries it, where a controller is one of the bridge's two seats. */
type WireObject = SnapshotResponse['view']['stack'][number];

function card(oid: string, name: string, controller: 0 | 1, typeLine = 'Creature'): WireObject {
  return {
    oid,
    name,
    typeLine,
    power: typeLine === 'Creature' ? 2 : null,
    toughness: typeLine === 'Creature' ? 2 : null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
  };
}

const HOST_HAND = [card('forge-card-11', 'Host Secret', 0), card('forge-card-12', 'Island', 0, 'Basic Land')];
const GUEST_HAND = [
  card('forge-card-21', 'Guest Secret', 1),
  card('forge-card-22', 'Island', 1, 'Basic Land'),
];

function event(
  seq: number,
  text: string,
  detail: unknown,
  reveals: SnapshotResponse['events'][number]['reveals'] = [],
): SnapshotResponse['events'][number] {
  return { seq, type: 'Card action', text, detail, reveals };
}

function snapshot(
  events: SnapshotResponse['events'],
  decision: SnapshotResponse['decision'] = null,
): SnapshotResponse {
  return {
    protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
    type: 'snapshot',
    requestId: 'r',
    sessionId: 's',
    revision: 3,
    status: 'awaiting',
    view: {
      version: 4,
      turn: { number: 2, active: 0, phase: 'Main', step: 'MAIN1' },
      priority: 0,
      stack: [],
      seats: [
        {
          id: 0,
          name: 'Host',
          life: 20,
          hand: HOST_HAND,
          handSize: 2,
          librarySize: 30,
          graveyard: [],
          exile: [],
          battlefield: [card('forge-card-31', 'Island', 0, 'Basic Land')],
        },
        {
          id: 1,
          name: 'Guest',
          life: 20,
          hand: GUEST_HAND,
          handSize: 2,
          librarySize: 30,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
      ],
    },
    events,
    decision,
    result: null,
  };
}

const PRIORITY: NonNullable<SnapshotResponse['decision']> = {
  seat: 0,
  kind: 'priority',
  prompt: 'Host has priority',
  options: [{ id: 'pass', text: 'Pass priority', targets: [] }],
  input: null,
  complete: true,
};

function audit(wire: SnapshotResponse): ReturnType<typeof auditSeatPayloads> {
  return auditSeatPayloads(
    seatProjection(wire),
    wire.view,
    contractDecision(wire.decision),
    'r3',
    'seed-7',
    null,
  );
}

describe('concealedFrom', () => {
  it('names the other hand by id, and by name only when the name is unique', () => {
    const concealed = concealedFrom(snapshot([]).view, 0);
    expect([...concealed.oids]).toEqual(['forge-card-21', 'forge-card-22']);
    expect([...concealed.uniqueNames]).toEqual(['Guest Secret']);
  });
});

describe('seatProjection', () => {
  it('passes the audit on a snapshot carrying both hands', () => {
    const report = audit(
      snapshot([event(0, 'Host played Island', { sourceOid: 'forge-card-31' })], PRIORITY),
    );
    expect(report.findings).toEqual([]);
    expect(report.searched).toBe(2);
  });

  it('nulls the other hand and keeps the count, the own hand and every public zone', () => {
    const seats = seatProjection(snapshot([]));
    const host = seats.view(0);
    expect(host.seats[0].hand).toEqual(HOST_HAND);
    expect(host.seats[1].hand).toBeNull();
    expect(host.seats[1].handSize).toBe(2);
    expect(seats.view(1).seats[0].hand).toBeNull();
    expect(seats.view(1).seats[1].hand).toEqual(GUEST_HAND);
    expect(host.seats[0].battlefield).toEqual(snapshot([]).view.seats[0].battlefield);
  });

  it('rewrites an event whose detail names a concealed id, for that viewer only', () => {
    const wire = snapshot([
      event(0, 'Guest activated an ability', { sourceOid: 'forge-card-22' }),
      event(1, 'Host passed', null),
    ]);
    const seats = seatProjection(wire);
    const host = seats.events(0);
    expect(host).toHaveLength(2);
    expect(host.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(host[0]).toEqual({
      seq: 0,
      type: 'Card action',
      text: 'Guest acted on a concealed card',
      detail: undefined,
      reveals: [],
    });
    expect(host[1]).toEqual(wire.events[1]);
    expect(seats.events(1)).toEqual(wire.events);
    expect(audit(wire).findings).toEqual([]);
  });

  it('rewrites a sentence naming a card unique to the concealed hand, and leaves a shared name alone', () => {
    const wire = snapshot([
      event(0, 'Guest looked at Guest Secret', null),
      event(1, 'Guest tapped an Island', null),
    ]);
    const host = seatProjection(wire).events(0);
    expect(host[0]?.text).toBe('Guest acted on a concealed card');
    expect(host[1]?.text).toBe('Guest tapped an Island');
    expect(audit(wire).findings).toEqual([]);
  });

  it('would have leaked without the projection, so the audit is measuring something', () => {
    const wire = snapshot([event(0, 'Guest looked at Guest Secret', { sourceOid: 'forge-card-21' })]);
    const leaking = auditSeatPayloads(
      { view: () => wire.view, events: () => wire.events as readonly EngineEvent[], decision: () => null },
      wire.view,
      null,
      'r3',
      null,
      null,
    );
    expect(leaking.findings.length).toBeGreaterThan(0);
  });

  it('leaves an event whole when its reveals license the card to the viewer', () => {
    const wire = snapshot([
      event(0, 'Guest revealed Guest Secret', { sourceOid: 'forge-card-21' }, [
        { oid: 'forge-card-21', seats: [0, 1] },
      ]),
    ]);
    expect(seatProjection(wire).events(0)).toEqual(wire.events);
    expect(audit(wire).findings).toEqual([]);
  });

  it('redacts a private reveal addressed only to the other seat', () => {
    const wire = snapshot([
      event(0, 'Host looked at Guest Secret', null, [{ oid: 'forge-card-21', seats: [0] }]),
    ]);
    expect(seatProjection(wire).events(0)).toEqual(wire.events);
    const guest = seatProjection(wire).events(1);
    expect(guest[0]?.reveals).toEqual([]);
    expect(guest[0]?.text).toBe('Host acted on a concealed card');
    expect(audit(wire).findings).toEqual([]);
  });

  it('sends the decision to the seat that owes it and nothing to the other', () => {
    const seats = seatProjection(snapshot([], PRIORITY));
    expect(seats.decision(0)).toEqual(contractDecision(PRIORITY));
    expect(seats.decision(1)).toBeNull();
    expect(seatProjection(snapshot([], { ...PRIORITY, seat: 1 })).decision(0)).toBeNull();
  });
});

describe('contractDecision', () => {
  it('drops the null text box and the mana payment plan the wire always writes', () => {
    const decision = contractDecision({
      ...PRIORITY,
      manaPayment: { unpaid: ['G'] },
      options: [{ id: 'pay', text: 'Pay', targets: [], manaPayment: { kind: 'cancel' } }],
    });
    expect(decision).toEqual({
      seat: 0,
      kind: 'priority',
      prompt: 'Host has priority',
      options: [{ id: 'pay', text: 'Pay', targets: [] }],
      complete: true,
    });
    expect(contractDecision(null)).toBeNull();
  });
});
