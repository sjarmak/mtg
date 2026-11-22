/** Native Suns must hit the pilot's own creatures, not just its opponent's. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const SUNS = 'Sweltering Suns';
const SMALL = 'Defiant Khenra';
const LARGE = 'Hyena Pack';
type Witness = { readonly oid: string; readonly name: string; readonly toughness: number };

forgeIt(
  'Forge casts Sweltering Suns with deaths and four-toughness survivors on both sides',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cast:
      | {
          readonly oid: string;
          readonly turn: number;
          readonly lives: readonly number[];
          readonly creatures: readonly (readonly Witness[])[];
        }
      | undefined;
    let completed = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Damage controls',
            controller: 'local',
            deck: {
              name: 'bilateral controls',
              cards: [
                { name: 'Mountain', count: 20 },
                { name: SMALL, count: 20 },
                { name: LARGE, count: 20 },
              ],
            },
          },
          {
            name: 'Native Suns pilot',
            controller: 'engine',
            deck: {
              name: 'bilateral Suns',
              cards: [
                { name: 'Mountain', count: 30 },
                { name: SMALL, count: 15 },
                { name: LARGE, count: 15 },
                { name: SUNS, count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-suns-native-bilateral-v1',
        maximumTurns: 48,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const seats = session.view.seats;
        expect(seats[1].hand).toBeNull();
        const spell = session.view.stack.find(
          (card) => card.name === SUNS && !seats[1].graveyard.some((entry) => entry.oid === card.oid),
        );
        const boards = seats.map((seat) =>
          seat.battlefield.filter((card) => card.name === SMALL || card.name === LARGE),
        );
        if (
          cast === undefined &&
          spell !== undefined &&
          boards.every(
            (board) =>
              [SMALL, LARGE].every((name) => board.some((card) => card.name === name)) &&
              board.every((card) => card.damage === 0),
          )
        ) {
          expect(spell.controller).toBe(1);
          for (const board of boards)
            for (const card of board) {
              expect(card.toughness).toBe(card.name === SMALL ? 2 : 4);
            }
          cast = {
            oid: spell.oid,
            turn: session.view.turn.number,
            lives: seats.map((seat) => seat.life),
            creatures: boards.map((board) =>
              board.map((card) => ({
                oid: card.oid,
                name: card.name,
                toughness: card.toughness!,
              })),
            ),
          };
        }
        const resolving = cast;
        if (resolving !== undefined && seats[1].graveyard.some((card) => card.oid === resolving.oid)) {
          expect(session.view.turn.number).toBe(resolving.turn);
          expect(session.view.stack).toHaveLength(0);
          expect(seats.map((seat) => seat.life)).toEqual(resolving.lives);
          seats.forEach((seat, seatIndex) => {
            for (const card of resolving.creatures[seatIndex] ?? []) {
              if (card.toughness === 4) {
                expect(seat.battlefield.find((entry) => entry.oid === card.oid)).toMatchObject({
                  name: LARGE,
                  power: 3,
                  toughness: 4,
                  damage: 3,
                });
                expect(seat.graveyard.some((entry) => entry.oid === card.oid)).toBe(false);
              } else {
                expect(seat.graveyard.find((entry) => entry.oid === card.oid)).toMatchObject({ name: SMALL });
                expect(seat.battlefield.some((entry) => entry.oid === card.oid)).toBe(false);
              }
            }
          });
          expect(seats[1].exile.some((card) => card.oid === resolving.oid)).toBe(false);
          completed = true;
          break;
        }
        trace = [
          ...trace.slice(-15),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${boards.map((board) => board.map((card) => `${card.name}:${card.damage}`).join(',')).join(' / ')} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        ];
        let move: string | undefined;
        if (decision.kind === 'priority' && cast === undefined) {
          move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
          // Establish a survivor before offering small creatures to the board wipe.
          const names = boards[0]?.some((card) => card.name === LARGE) ? [SMALL, LARGE] : [LARGE];
          for (const name of names)
            move ??= decision.options.find((option) => option.text.startsWith(`${name}:`))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(completed, trace.join('\n')).toBe(true);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  180_000,
);
