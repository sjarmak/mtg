/** Observe a native Suns cast and its exact public damage outcome. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Damage controls',
      controller: 'local',
      deck: {
        name: 'damage controls',
        cards: [
          { name: 'Mountain', count: 20 },
          { name: 'Forest', count: 10 },
          { name: 'Hyena Pack', count: 10 },
          { name: 'Harrier Naga', count: 10 },
          { name: 'Defiant Khenra', count: 10 },
        ],
      },
    },
    {
      name: 'Native Suns pilot',
      controller: 'engine',
      deck: {
        name: 'suns',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Sweltering Suns', count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-suns-native-damage-v1',
  maximumTurns: 48,
};

forgeIt(
  'Forge casts Sweltering Suns to kill small creatures while a four-toughness creature survives',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cast:
      | {
          oid: string;
          turn: number;
          lives: readonly number[];
          creatures: readonly { oid: string; toughness: number }[];
        }
      | undefined;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        // Cycling pays its discard cost before the ability reaches the stack.
        const spell = session.view.stack.find(
          (card) => card.name === 'Sweltering Suns' && !bot.graveyard.some((entry) => entry.oid === card.oid),
        );
        if (cast === undefined && spell !== undefined) {
          expect(spell.controller).toBe(1);
          const creatures = pilot.battlefield.filter((card) =>
            ['Hyena Pack', 'Harrier Naga', 'Defiant Khenra'].includes(card.name),
          );
          expect(creatures.some((card) => card.toughness === 4)).toBe(true);
          expect(creatures.some((card) => card.toughness === 2 || card.toughness === 3)).toBe(true);
          for (const card of creatures) expect(card.damage).toBe(0);
          cast = {
            oid: spell.oid,
            turn: session.view.turn.number,
            lives: session.view.seats.map((seat) => seat.life),
            creatures: creatures.map((card) => ({ oid: card.oid, toughness: card.toughness! })),
          };
        }
        const resolving = cast;
        if (resolving !== undefined && bot.graveyard.some((card) => card.oid === resolving.oid)) {
          expect(session.view.turn.number).toBe(resolving.turn);
          expect(session.view.stack).toHaveLength(0);
          expect(session.view.seats.map((seat) => seat.life)).toEqual(resolving.lives);
          for (const card of resolving.creatures) {
            if (card.toughness === 4) {
              expect(pilot.battlefield.find((entry) => entry.oid === card.oid)).toMatchObject({
                toughness: 4,
                damage: 3,
              });
              expect(pilot.graveyard.some((entry) => entry.oid === card.oid)).toBe(false);
            } else {
              expect(pilot.graveyard.some((entry) => entry.oid === card.oid)).toBe(true);
              expect(pilot.battlefield.some((entry) => entry.oid === card.oid)).toBe(false);
            }
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
          move = decision.options.find((option) =>
            ['Play Mountain', 'Play Forest'].includes(option.text),
          )?.id;
          const established = pilot.battlefield.some((card) => card.name === 'Hyena Pack');
          const names = established ? ['Harrier Naga', 'Defiant Khenra'] : ['Hyena Pack'];
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
