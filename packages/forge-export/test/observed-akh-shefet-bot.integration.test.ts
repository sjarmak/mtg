/** Native AI must cycle and search on its own; the driver sees only public transitions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
    },
    {
      name: 'Native Monitor pilot',
      controller: 'engine',
      deck: {
        name: 'monitor-search',
        cards: [
          { name: 'Forest', count: 30 },
          { name: 'Shefet Monitor', count: 20 },
          { name: 'Desert of the Indomitable', count: 10 },
        ],
      },
    },
  ],
  seed: 'akh-shefet-native-v1',
  maximumTurns: 24,
};

forgeIt(
  'Forge AI cycles Shefet Monitor, searches for a land, then draws',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cycling:
      | {
          oid: string;
          library: number;
          hand: number;
          battlefield: readonly string[];
          turn: number;
          step: string;
        }
      | undefined;
    let foundLand: string | undefined;
    let resolved = false;
    const trace: string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const source = session.view.stack.find(
          (card) => card.name === 'Shefet Monitor' && bot.graveyard.some((grave) => grave.oid === card.oid),
        );
        if (cycling === undefined && source !== undefined) {
          cycling = {
            oid: source.oid,
            library: bot.librarySize,
            hand: bot.handSize,
            battlefield: bot.battlefield.map((card) => card.oid),
            turn: session.view.turn.number,
            step: session.view.turn.step,
          };
        }
        const observed = cycling;
        if (observed !== undefined) {
          expect(session.view.turn.number).toBe(observed.turn);
          expect(session.view.turn.step).toBe(observed.step);
          const entered = bot.battlefield.filter((card) => !observed.battlefield.includes(card.oid));
          if (foundLand === undefined && entered.length > 0) {
            expect(entered).toHaveLength(1);
            expect(['Forest', 'Desert of the Indomitable']).toContain(entered[0]?.name);
            expect(bot.librarySize).toBe(observed.library - 1);
            expect(bot.handSize).toBe(observed.hand);
            expect(session.view.stack.some((card) => card.oid === observed.oid)).toBe(true);
            foundLand = entered[0]?.oid;
          }
          if (!session.view.stack.some((card) => card.oid === observed.oid)) {
            expect(foundLand).toBeDefined();
            expect(bot.librarySize).toBe(observed.library - 2);
            expect(bot.handSize).toBe(observed.hand + 1);
            expect(bot.graveyard.some((card) => card.oid === observed.oid)).toBe(true);
            resolved = true;
            break;
          }
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} stack=${session.view.stack.map((card) => `${card.name}:${card.oid}`).join(',')} grave=${bot.graveyard.map((card) => card.name).join(',')} ${decision.kind}: ${decision.prompt}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority')
          move =
            decision.options.find((option) => option.text === 'Play Mountain')?.id ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
        else if (decision.kind === 'discard-selection') move = decision.options[0]?.id;
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
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
