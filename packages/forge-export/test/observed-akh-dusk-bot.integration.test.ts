/** Native Dusk must distinguish power two from power three, not toughness. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Power controls',
      controller: 'local',
      deck: {
        name: 'power controls',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Defiant Khenra', count: 15 },
          { name: 'Hyena Pack', count: 15 },
        ],
      },
    },
    {
      name: 'Native Dusk pilot',
      controller: 'engine',
      deck: {
        name: 'dusk',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Dusk // Dawn', count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-dusk-native-power-v1',
  maximumTurns: 40,
};

forgeIt(
  'Forge casts Dusk destroying power-three creatures while preserving power-two creatures',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cast:
      | {
          oid: string;
          turn: number;
          lives: readonly number[];
          low: readonly string[];
          high: readonly string[];
        }
      | undefined;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const spell = session.view.stack.find((card) => card.name.includes('Dusk'));
        if (cast === undefined && spell !== undefined) {
          expect(spell.controller).toBe(1);
          const low = pilot.battlefield.filter((card) => card.name === 'Defiant Khenra');
          const high = pilot.battlefield.filter((card) => card.name === 'Hyena Pack');
          expect(low.length).toBeGreaterThan(0);
          expect(high.length).toBeGreaterThan(0);
          for (const card of low) expect(card).toMatchObject({ power: 2, toughness: 2, damage: 0 });
          for (const card of high) expect(card).toMatchObject({ power: 3, toughness: 4, damage: 0 });
          cast = {
            oid: spell.oid,
            turn: session.view.turn.number,
            lives: session.view.seats.map((seat) => seat.life),
            low: low.map((card) => card.oid),
            high: high.map((card) => card.oid),
          };
        }
        const resolving = cast;
        if (resolving !== undefined && bot.graveyard.some((card) => card.oid === resolving.oid)) {
          expect(session.view.turn.number).toBe(resolving.turn);
          expect(session.view.stack).toHaveLength(0);
          expect(session.view.seats.map((seat) => seat.life)).toEqual(resolving.lives);
          for (const oid of resolving.low) {
            expect(pilot.battlefield.find((card) => card.oid === oid)).toMatchObject({
              power: 2,
              toughness: 2,
              damage: 0,
            });
            expect(pilot.graveyard.some((card) => card.oid === oid)).toBe(false);
          }
          for (const oid of resolving.high) {
            expect(pilot.graveyard.some((card) => card.oid === oid)).toBe(true);
            expect(pilot.battlefield.some((card) => card.oid === oid)).toBe(false);
          }
          expect(bot.exile.some((card) => card.oid === resolving.oid)).toBe(false);
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority' && cast === undefined) {
          move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
          const name = pilot.battlefield.some((card) => card.name === 'Defiant Khenra')
            ? 'Hyena Pack'
            : 'Defiant Khenra';
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
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.slice(-16).join('\n')).toBe(true);
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
