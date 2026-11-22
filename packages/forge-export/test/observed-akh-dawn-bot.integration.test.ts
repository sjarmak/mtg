/** Native Dawn filters both power and ownership without exposing the bot hand. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local opponent',
      controller: 'local',
      deck: {
        name: 'graveyard controls',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Ahn-Crop Crasher', count: 12 },
          { name: 'Defiant Khenra', count: 8 },
          { name: 'Sweltering Suns', count: 10 },
        ],
      },
    },
    {
      name: 'Forge Dawn pilot',
      controller: 'engine',
      deck: {
        name: 'power boundary',
        cards: [
          { name: 'Plains', count: 18 },
          { name: 'Mountain', count: 12 },
          { name: 'Defiant Khenra', count: 12 },
          { name: 'Ahn-Crop Crasher', count: 6 },
          { name: 'Dusk // Dawn', count: 12 },
        ],
      },
    },
  ],
  seed: 'akh-dawn-native-boundaries-v1',
  maximumTurns: 40,
};

forgeIt(
  'Forge Dawn recovers low power, excludes high power, and leaves the other graveyard unchanged',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let priorGraveyard: readonly string[] = [];
    let recovery:
      | {
          source: string;
          low: readonly string[];
          high: readonly string[];
          opponent: readonly string[];
          hand: number;
          turn: number;
          life: readonly number[];
        }
      | undefined;
    let resolved = false;
    const trace: string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const view = session.view;
        const [local, bot] = view.seats;
        expect(bot.hand).toBeNull();
        const dawn = view.stack.find(
          (card) => priorGraveyard.includes(card.oid) && card.name.includes('Dawn'),
        );
        if (recovery === undefined && dawn !== undefined) {
          expect(dawn.controller).toBe(1);
          const low = bot.graveyard.filter((card) => card.name === 'Defiant Khenra');
          const high = bot.graveyard.filter((card) => card.name === 'Ahn-Crop Crasher');
          expect(low.length).toBeGreaterThan(0);
          expect(high.length).toBeGreaterThan(0);
          for (const card of low) expect(card).toMatchObject({ power: 2, toughness: 2 });
          for (const card of high) expect(card).toMatchObject({ power: 3, toughness: 2 });
          expect(local.graveyard.some((card) => card.name === 'Defiant Khenra')).toBe(true);
          recovery = {
            source: dawn.oid,
            low: low.map((card) => card.oid),
            high: high.map((card) => card.oid),
            opponent: local.graveyard.map((card) => card.oid),
            hand: bot.handSize,
            turn: view.turn.number,
            life: view.seats.map((seat) => seat.life),
          };
        }
        const observed = recovery;
        if (observed !== undefined && bot.exile.some((card) => card.oid === observed.source)) {
          expect(view.turn.number).toBe(observed.turn);
          expect(view.seats.map((seat) => seat.life)).toEqual(observed.life);
          expect(local.graveyard.map((card) => card.oid)).toEqual(observed.opponent);
          expect(bot.graveyard.some((card) => card.oid === observed.source)).toBe(false);
          expect(bot.battlefield.some((card) => card.oid === observed.source)).toBe(false);
          for (const oid of observed.high) {
            expect(bot.graveyard.some((card) => card.oid === oid)).toBe(true);
            expect(bot.battlefield.some((card) => card.oid === oid)).toBe(false);
          }
          for (const oid of observed.low) {
            expect(bot.graveyard.some((card) => card.oid === oid)).toBe(false);
            expect(bot.exile.some((card) => card.oid === oid)).toBe(false);
            expect(bot.battlefield.some((card) => card.oid === oid)).toBe(false);
          }
          // A recovered creature can be recast before Forge yields priority.
          expect(view.stack.every((card) => observed.low.includes(card.oid))).toBe(true);
          expect(bot.handSize + view.stack.length).toBe(observed.hand + observed.low.length);
          resolved = true;
          break;
        }
        priorGraveyard = bot.graveyard.map((card) => card.oid);
        trace.push(
          `${view.turn.number}/${view.turn.step} ${decision.kind} stack=${view.stack.map((card) => card.name).join(',')} local=${local.graveyard.map((card) => card.name).join(',')} bot=${bot.graveyard.map((card) => card.name).join(',')} options=${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
          if (
            bot.graveyard.some((card) => card.name.includes('Dusk')) &&
            bot.battlefield.some((card) => card.name === 'Defiant Khenra') &&
            [...bot.battlefield, ...bot.graveyard].some((card) => card.name === 'Ahn-Crop Crasher') &&
            local.battlefield.some((card) => card.name === 'Defiant Khenra')
          ) {
            move ??= decision.options.find((option) =>
              option.text.includes('deals 3 damage to each creature'),
            )?.id;
          }
          for (const [name, count] of [
            ['Defiant Khenra', 1],
            ['Ahn-Crop Crasher', 3],
          ] as const) {
            if (local.battlefield.filter((card) => card.name === name).length < count) {
              move ??= decision.options.find((option) => option.text.startsWith(`${name}:`))?.id;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'combat-exert') {
          move = decision.options.find((option) => option.text === 'Choose none')?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.slice(-20).join('\n')).toBe(true);
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
