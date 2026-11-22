/**
 * A table of four, projected: whose opponent the band is drawn from, the order
 * the others sit in, and the numbers the seat rail reads.
 *
 * `mtg-bc2.154.6.5.4`. The kernel is two-seat and the Forge wire is two-seat
 * (`packages/ui/src/net/backend-gateway.ts` refuses a third), so a real pod
 * cannot reach this function yet. These positions are built by hand from the
 * engine's `TableView`, which is what a backend that plays one will send, and the
 * function is proven against them rather than against a game.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectView, SeatId, SeatView, TableView } from '@mtg/engine';
import { backendBoardPosition } from '../../src/routes/play/backend-position';

function creature(oid: string, controller: SeatId, extra: Partial<ObjectView> = {}): ObjectView {
  return {
    oid,
    name: `Creature ${oid}`,
    typeLine: 'Creature — Bear',
    power: 2,
    toughness: 2,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
    ...extra,
  };
}

const NAMES = ['Ana', 'Bo', 'Cy', 'Di'] as const;

function seat(id: SeatId, extra: Partial<SeatView> = {}): SeatView {
  return {
    id,
    name: NAMES[id] ?? `Seat ${String(id)}`,
    life: 40,
    hand: id === 0 ? [] : null,
    handSize: 7,
    librarySize: 80,
    graveyard: [],
    exile: [],
    battlefield: [creature(`bear-${String(id)}`, id)],
    ...extra,
  };
}

function pod(active: SeatId, extra: Partial<TableView> = {}, seats?: readonly SeatView[]): TableView {
  return {
    version: 4,
    turn: { number: 5, active, phase: 'main', step: 'main' },
    priority: active,
    stack: [],
    seats: seats ?? [seat(0), seat(1), seat(2), seat(3)],
    ...extra,
  } as TableView;
}

const emmara = creature('cmd-0', 0, { name: 'Emmara' });
const kaalia = creature('cmd-2', 2, { name: 'Kaalia' });
const tymna = creature('cmd-3a', 3, { name: 'Tymna' });
const thrasios = creature('cmd-3b', 3, { name: 'Thrasios' });

/** Four Commander seats: `dealt[receiver]` is what that seat has taken, per commander oid. */
function commanderPod(
  active: SeatId,
  dealt: readonly Record<string, number>[],
  matrix?: readonly (readonly number[])[],
) {
  const zones: readonly (readonly ObjectView[])[] = [[emmara], [], [kaalia], [tymna, thrasios]];
  return pod(
    active,
    matrix === undefined ? {} : { commanderDamageMatrix: matrix },
    NAMES.map((_, id) =>
      seat(id as SeatId, {
        commandZone: zones[id] ?? [],
        commanderDamage: dealt[id] ?? {},
        commanderCasts: Object.fromEntries((zones[id] ?? []).map((one) => [one.oid, 0])),
      }),
    ),
  );
}

describe('a table of four, projected', () => {
  it('leaves a table of two exactly the duel it was', () => {
    const duel = backendBoardPosition({ ...pod(0), seats: [seat(0), seat(1)] } as TableView, 0);
    expect(duel.pod).toBeUndefined();
    expect(duel.opponent.status.name).toBe('Bo');
  });

  it("draws the band from the active opponent on another player's turn, and seats the rest in turn order", () => {
    const position = backendBoardPosition(pod(2), 0);
    expect(position.opponent.status.name).toBe('Cy');
    expect(position.pod?.opponentSeat).toBe(2);
    expect(position.pod?.others.map((other) => other.seat)).toEqual([1, 3]);
    // Bo (1), Cy (2), Di (3): the row reads in the order the seats sit, so the primary is second.
    expect(position.pod?.opponentAt).toBe(1);
    expect(position.you.status.name).toBe('Ana');
  });

  it('starts the row after the viewer wherever the viewer sits', () => {
    const position = backendBoardPosition(pod(1), 2);
    // Viewer is Cy (2): the seats after them are Di (3), Ana (0), Bo (1), and Bo is active.
    expect(position.pod?.opponentSeat).toBe(1);
    expect(position.pod?.others.map((other) => other.seat)).toEqual([3, 0]);
    expect(position.pod?.opponentAt).toBe(2);
  });

  it('on the viewer’s own turn takes the seat after them, and the seat blocking when one is', () => {
    expect(backendBoardPosition(pod(0), 0).pod?.opponentSeat).toBe(1);
    const blocked = pod(0, {}, [
      seat(0, { battlefield: [creature('raider', 0, { attacking: true, blockedBy: ['wall-3'] })] }),
      seat(1),
      seat(2),
      seat(3, { battlefield: [creature('wall-3', 3)] }),
    ]);
    const position = backendBoardPosition(blocked, 0);
    expect(position.pod?.opponentSeat).toBe(3);
    expect(position.pod?.others.map((other) => other.seat)).toEqual([1, 2]);
    expect(position.pod?.opponentAt).toBe(2);
  });

  it('carries every opponent’s battlefield, not only the one the band reads', () => {
    const position = backendBoardPosition(pod(1), 0);
    const boards = [position.opponent, ...(position.pod?.others.map((other) => other.side) ?? [])].map(
      (side) => side.battlefield.permanents.map((permanent) => permanent.key),
    );
    expect(boards).toEqual([['bear-1'], ['bear-2'], ['bear-3']]);
  });

  it('gives every seat a rail row with its life, marks the viewer, and says whose turn it is', () => {
    const position = backendBoardPosition(
      pod(2, {}, [seat(0, { life: 31 }), seat(1, { life: 4 }), seat(2), seat(3, { life: 12 })]),
      0,
    );
    const rail = position.pod?.rail.seats ?? [];
    expect(rail.map((entry) => [entry.seat, entry.name, entry.life, entry.you, entry.active])).toEqual([
      [0, 'Ana', 31, true, false],
      [1, 'Bo', 4, false, false],
      [2, 'Cy', 40, false, true],
      [3, 'Di', 12, false, false],
    ]);
  });

  it('draws poison only where the backend reports it, and none is not unknown', () => {
    const rail = backendBoardPosition(
      pod(0, {}, [seat(0, { poison: 0 }), seat(1, { poison: 7 }), seat(2), seat(3)]),
      0,
    ).pod?.rail.seats;
    expect(rail?.map((entry) => entry.poison)).toEqual([0, 7, null, null]);
  });

  it('draws no commander chips on a table that plays no commander game', () => {
    const rail = backendBoardPosition(pod(0), 0).pod?.rail.seats ?? [];
    expect(rail.every((entry) => entry.damage.length === 0)).toBe(true);
  });

  it('gives each seat a chip per other dealer, zeroes included, from the matrix', () => {
    // matrix[dealer][receiver]: Bo has dealt 9 to Ana; Cy has dealt 15 to Ana and 3 to Di.
    const matrix = [
      [0, 0, 0, 0],
      [9, 0, 0, 0],
      [15, 0, 0, 3],
      [0, 0, 0, 0],
    ];
    const rail = backendBoardPosition(commanderPod(0, [{}, {}, {}, {}], matrix), 0).pod?.rail.seats ?? [];
    expect(rail[0]?.damage.map((from) => [from.dealer, from.name, from.amount])).toEqual([
      [1, 'Bo', 9],
      [2, 'Cy', 15],
      [3, 'Di', 0],
    ]);
    expect(rail[3]?.damage.map((from) => [from.dealer, from.amount])).toEqual([
      [0, 0],
      [1, 0],
      [2, 3],
    ]);
    // A seat is never its own dealer.
    expect(rail.every((entry) => entry.damage.every((from) => from.dealer !== entry.seat))).toBe(true);
  });

  it('reads per-commander tallies when there is no matrix, and keeps the largest as the tone’s figure', () => {
    // Di's two partners have each dealt 10 to Ana: 20 from one dealer, and neither is lethal.
    const rail =
      backendBoardPosition(
        commanderPod(0, [{ [tymna.oid]: 10, [thrasios.oid]: 10, [kaalia.oid]: 4 }, {}, {}, {}]),
        0,
      ).pod?.rail.seats ?? [];
    const fromDi = rail[0]?.damage.find((from) => from.dealer === 3);
    expect(fromDi).toMatchObject({ amount: 20, peak: 10 });
    const fromCy = rail[0]?.damage.find((from) => from.dealer === 2);
    expect(fromCy).toMatchObject({ amount: 4, peak: 4 });
    // Bo has no commander, so nothing is tallied against them and no peak is claimed.
    expect(rail[0]?.damage.find((from) => from.dealer === 1)?.peak).toBeUndefined();
  });

  it('prefers the matrix’s total for a dealer over the sum it is derived from', () => {
    const rail =
      backendBoardPosition(
        commanderPod(
          0,
          [{ [kaalia.oid]: 6 }, {}, {}, {}],
          [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [8, 0, 0, 0],
            [0, 0, 0, 0],
          ],
        ),
        0,
      ).pod?.rail.seats ?? [];
    expect(rail[0]?.damage.find((from) => from.dealer === 2)).toMatchObject({ amount: 8, peak: 6 });
  });
});
