/** Scry across the wire: chooser-only identities and public count-only results. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { BASIC_LANDS, parseCard } from '@mtg/dsl';
import type { DeckList, GameSetup, PlayerId } from '@mtg/kernel';
import { humanSeat } from '@mtg/kernel';
import type { SeatSnapshot, Table } from '@mtg/netplay';
import { createTable } from '@mtg/netplay';

function basicIsland(): Card {
  const found = BASIC_LANDS.find((card) => card.name === 'Island');
  if (found === undefined) throw new Error('the DSL ships no Island');
  return found;
}

const ISLAND = basicIsland();

const PREORDAIN = parseCard({
  kind: 'sorcery',
  id: 'netplay-preordain',
  name: 'Preordain',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { U: 1 },
  colors: ['U'],
  effects: [
    { kind: 'scry', count: 2 },
    { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
  ],
});

function preordainDeck(name: string): DeckList {
  return {
    name,
    cards: [...Array.from({ length: 20 }, () => PREORDAIN), ...Array.from({ length: 20 }, () => ISLAND)],
  };
}

const SETUP: GameSetup = {
  seed: 'netplay/scry/v0',
  decks: [preordainDeck('Blue one'), preordainDeck('Blue two')],
  maximumTurns: 8,
};

function table(): Table {
  return createTable({
    id: 'scry-table',
    setup: SETUP,
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: 'one' },
      { name: 'Two', token: 'two' },
    ],
  });
}

function chooseIndex(snapshot: SeatSnapshot): number {
  const decision = snapshot.pending;
  if (decision === null) throw new Error('the owing seat received no decision');
  if (decision.kind === 'mulligan') {
    return decision.options.findIndex((action) => action.type === 'keepHand');
  }
  if (decision.kind === 'priority') {
    const land = decision.options.findIndex((action) => action.type === 'playLand');
    if (land >= 0) return land;
    const spell = decision.options.findIndex(
      (action) =>
        action.type === 'castSpell' && snapshot.state.objects[action.oid]?.card.name === 'Preordain',
    );
    if (spell >= 0) return spell;
  }
  return decision.options.findIndex((action) =>
    action.type === 'declareAttackers'
      ? action.attackers.length === 0
      : action.type === 'declareBlockers'
        ? action.blocks.length === 0
        : true,
  );
}

function untilScry(live: Table): PlayerId {
  for (let guard = 0; guard < 500; guard += 1) {
    const awaiting = live.snapshotFor(0).awaiting;
    if (awaiting === null) throw new Error('the game ended before scry');
    const snapshot = live.snapshotFor(awaiting);
    if (snapshot.pending?.kind === 'scry') return awaiting;
    const index = chooseIndex(snapshot);
    if (index < 0) throw new Error(`no drive option for ${snapshot.pending?.kind ?? 'nothing'}`);
    const refusal = live.apply(awaiting, { kind: 'choose', index, at: snapshot.decisions });
    if (refusal !== null) throw new Error(refusal.refused);
  }
  throw new Error('the game never reached scry');
}

interface ScryProbe {
  readonly chooser: PlayerId;
  readonly before: SeatSnapshot;
  readonly pending: SeatSnapshot;
}

function untilScryProbe(live: Table): ScryProbe {
  let previous: readonly [SeatSnapshot, SeatSnapshot] | null = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const current = [live.snapshotFor(0), live.snapshotFor(1)] as const;
    const awaiting = current[0].awaiting;
    if (awaiting === null) throw new Error('the game ended before scry');
    if (current[awaiting].pending?.kind === 'scry') {
      const opponent: PlayerId = awaiting === 0 ? 1 : 0;
      const before = previous?.[opponent];
      if (before === undefined) throw new Error('scry was the first snapshot');
      return { chooser: awaiting, before, pending: current[opponent] };
    }
    const index = chooseIndex(current[awaiting]);
    if (index < 0) throw new Error(`no drive option for ${current[awaiting].pending?.kind ?? 'nothing'}`);
    const refusal = live.apply(awaiting, { kind: 'choose', index, at: current[awaiting].decisions });
    if (refusal !== null) throw new Error(refusal.refused);
    previous = current;
  }
  throw new Error('the game never reached scry');
}

function concealedIds(snapshot: SeatSnapshot): ReadonlySet<string> {
  const other: PlayerId = snapshot.seat === 0 ? 1 : 0;
  return new Set([
    ...snapshot.state.players[0].library,
    ...snapshot.state.players[1].library,
    ...snapshot.state.players[other].hand,
  ]);
}

function expectDisjoint(first: ReadonlySet<string>, second: ReadonlySet<string>): void {
  for (const id of first) expect(second.has(id), `concealed id ${id} survived a snapshot`).toBe(false);
}

describe('scry in a netplay snapshot', () => {
  it('sends the looked-at identities and options only to the chooser', () => {
    const live = table();
    const chooser = untilScry(live);
    const opponent: PlayerId = chooser === 0 ? 1 : 0;
    const choosing = live.snapshotFor(chooser);
    const waiting = live.snapshotFor(opponent);
    const decision = choosing.pending;
    if (decision?.kind !== 'scry') throw new Error('chooser received no scry decision');
    expect(live.snapshotFor(chooser)).toEqual(choosing);

    expect(decision.cards).toHaveLength(2);
    expect(decision.options).toHaveLength(6);
    expect(choosing.state.pendingScry?.cards).toEqual(decision.cards);
    expect(waiting.pending).toBeNull();
    expect(waiting.awaiting).toBe(chooser);
    expect(waiting.state.pendingScry).toBeUndefined();
    for (const oid of decision.cards) {
      expect(choosing.state.objects[oid]?.card.name).toBeDefined();
      expect(waiting.state.objects[oid]).toBeUndefined();
    }
  });

  it('sends both seats the same count-only public event after the choice', () => {
    const live = table();
    const chooser = untilScry(live);
    const opponent: PlayerId = chooser === 0 ? 1 : 0;
    const choosing = live.snapshotFor(chooser);
    const decision = choosing.pending;
    if (decision?.kind !== 'scry') throw new Error('chooser received no scry decision');
    const index = decision.options.findIndex(
      (action) => action.type === 'scry' && action.bottom.length === 1,
    );
    if (index < 0) throw new Error('scry offered no mixed partition');

    expect(live.apply(chooser, { kind: 'choose', index, at: choosing.decisions })).toBeNull();
    const chooserEvent = live.snapshotFor(chooser).events.findLast((event) => event.type === 'cardsScried');
    const opponentEvent = live.snapshotFor(opponent).events.findLast((event) => event.type === 'cardsScried');

    expect(chooserEvent).toEqual({ type: 'cardsScried', player: chooser, count: 2, bottom: 1 });
    expect(opponentEvent).toEqual(chooserEvent);
    expect(Object.keys(chooserEvent ?? {}).sort()).toEqual(['bottom', 'count', 'player', 'type']);
    for (const oid of decision.cards) expect(JSON.stringify(chooserEvent)).not.toContain(oid);
  });

  it('cannot correlate a hidden scry choice through snapshots, draw events, or a later reveal', () => {
    const live = table();
    const probe = untilScryProbe(live);
    const chooser = probe.chooser;
    const opponent: PlayerId = chooser === 0 ? 1 : 0;
    const choosing = live.snapshotFor(chooser);
    const decision = choosing.pending;
    if (decision?.kind !== 'scry') throw new Error('chooser received no scry decision');
    const [drawn, bottomed] = decision.cards;
    if (drawn === undefined || bottomed === undefined) throw new Error('scry looked at fewer than two cards');
    const index = decision.options.findIndex(
      (action) =>
        action.type === 'scry' &&
        action.top.length === 1 &&
        action.top[0] === drawn &&
        action.bottom.length === 1 &&
        action.bottom[0] === bottomed,
    );
    if (index < 0) throw new Error('scry offered no chosen top/bottom partition');

    const beforeIds = concealedIds(probe.before);
    const pendingIds = concealedIds(probe.pending);
    expectDisjoint(beforeIds, pendingIds);
    expect(JSON.stringify(probe.before)).not.toContain(drawn);
    expect(JSON.stringify(probe.pending)).not.toContain(drawn);

    const choicesBeforeScry = live.record().choices.length;
    expect(live.apply(chooser, { kind: 'choose', index, at: choosing.decisions })).toBeNull();
    const rawAfterScry = live.record().choices;
    expect(rawAfterScry[choicesBeforeScry]).toBe(index);

    const after = live.snapshotFor(opponent);
    const afterIds = concealedIds(after);
    expectDisjoint(pendingIds, afterIds);
    expect(Array.isArray(after.choices)).toBe(false);
    expect(after.choices).toEqual({ length: rawAfterScry.length });
    expect(JSON.stringify(after)).not.toContain(drawn);
    const privateDraw = after.events.findLast(
      (event) => event.type === 'cardDrawn' && event.player === chooser,
    );
    if (privateDraw?.type !== 'cardDrawn') throw new Error('Preordain emitted no draw');
    expect(privateDraw.oid).not.toBe(drawn);
    expect(afterIds.has(privateDraw.oid)).toBe(false);

    let revealed: SeatSnapshot | null = null;
    for (let guard = 0; guard < 500; guard += 1) {
      const waiting = live.snapshotFor(opponent);
      const publicMove = waiting.events.find(
        (event) => (event.type === 'landPlayed' || event.type === 'spellCast') && event.oid === drawn,
      );
      if (publicMove !== undefined) {
        revealed = waiting;
        break;
      }
      const awaiting = waiting.awaiting;
      if (awaiting === null) break;
      const owing = live.snapshotFor(awaiting);
      const matching =
        owing.pending?.kind === 'priority'
          ? owing.pending.options.findIndex(
              (action) => (action.type === 'playLand' || action.type === 'castSpell') && action.oid === drawn,
            )
          : -1;
      const next = matching >= 0 ? matching : chooseIndex(owing);
      if (next < 0) throw new Error(`no drive option for ${owing.pending?.kind ?? 'nothing'}`);
      const refusal = live.apply(awaiting, { kind: 'choose', index: next, at: owing.decisions });
      if (refusal !== null) throw new Error(refusal.refused);
    }
    if (revealed === null) throw new Error('the drawn card was never publicly played');

    const revealIds = concealedIds(revealed);
    expectDisjoint(afterIds, revealIds);
    expect(revealed.events.some((event) => event.type === 'cardDrawn' && event.oid === drawn)).toBe(false);
    expect(JSON.stringify(revealed)).toContain(drawn);
    expect(live.record().choices.slice(0, rawAfterScry.length)).toEqual(rawAfterScry);
  });
});
