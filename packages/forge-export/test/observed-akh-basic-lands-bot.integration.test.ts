/** Public proof of native land-play timing, payment and untap, not colored spell payment. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
for (const land of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) {
  forgeIt(
    `Forge plays ${land} at most once per turn in its main phase, cycles, and untaps next turn`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'passive', cards: [{ name: 'Plains', count: 60 }] },
          },
          {
            name: 'Land pilot',
            controller: 'engine',
            deck: {
              name: 'basic-payment',
              cards: [
                { name: land, count: 30 },
                { name: 'Sweltering Suns', count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-hou-basic-native-payment-v1',
        maximumTurns: 24,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      let cycling:
        | {
            source: string;
            paidLands: readonly string[];
            library: number;
            turn: number;
            step: string;
          }
        | undefined;
      let resolved = false;
      let untapped = false;
      let beforePayment: { untapped: readonly string[]; turn: number; mana: unknown } | undefined;
      let observedLandIds: readonly string[] = [];
      let landPlayTurns: readonly number[] = [];
      const trace: string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          expect(decision.seat).toBe(0);
          const bot = session.view.seats[1];
          expect(bot.hand).toBeNull();
          const landIds = bot.battlefield.filter((card) => card.name === land).map((card) => card.oid);
          const addedLands = landIds.filter((oid) => !observedLandIds.includes(oid));
          if (addedLands.length > 0) {
            expect(addedLands).toHaveLength(1);
            expect(session.view.turn.active).toBe(1);
            expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
            expect(session.view.stack).toEqual([]);
            expect(landPlayTurns).not.toContain(session.view.turn.number);
            landPlayTurns = [...landPlayTurns, session.view.turn.number];
          }
          expect(landIds).toEqual(expect.arrayContaining([...observedLandIds]));
          observedLandIds = landIds;
          const source = session.view.stack.find(
            (card) =>
              card.name === 'Sweltering Suns' && bot.graveyard.some((entry) => entry.oid === card.oid),
          );
          if (cycling === undefined && source !== undefined) {
            expect(bot.battlefield.length).toBeGreaterThan(0);
            for (const card of bot.battlefield) expect(card.name).toBe(land);
            const tapped = bot.battlefield.filter((card) => card.tapped);
            expect(tapped).toHaveLength(3);
            expect(beforePayment?.turn).toBe(session.view.turn.number);
            expect(beforePayment?.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
            for (const card of tapped) expect(beforePayment?.untapped).toContain(card.oid);
            cycling = {
              source: source.oid,
              paidLands: tapped.map((card) => card.oid),
              library: bot.librarySize,
              turn: session.view.turn.number,
              step: session.view.turn.step,
            };
          }
          const pendingCycle = cycling;
          if (
            !resolved &&
            pendingCycle !== undefined &&
            !session.view.stack.some((card) => card.oid === pendingCycle.source)
          ) {
            expect(session.view.turn.number).toBe(pendingCycle.turn);
            expect(session.view.turn.step).toBe(pendingCycle.step);
            expect(bot.librarySize).toBe(pendingCycle.library - 1);
            expect(bot.graveyard.some((card) => card.oid === pendingCycle.source)).toBe(true);
            for (const oid of pendingCycle.paidLands) {
              expect(bot.battlefield.find((card) => card.oid === oid)).toMatchObject({
                name: land,
                tapped: true,
              });
            }
            resolved = true;
          }
          if (
            resolved &&
            pendingCycle !== undefined &&
            session.view.turn.number > pendingCycle.turn &&
            session.view.turn.active === 1
          ) {
            for (const oid of pendingCycle.paidLands) {
              expect(bot.battlefield.find((card) => card.oid === oid)).toMatchObject({
                name: land,
                tapped: false,
              });
            }
            untapped = true;
            break;
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt}; lands=${bot.battlefield.map((card) => `${card.name}:${card.tapped}`).join(',')}; grave=${bot.graveyard.map((card) => card.name).join(',')}; hand=${bot.handSize}`,
          );
          let move: string | undefined;
          if (decision.kind === 'priority')
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (decision.kind === 'discard-selection') move = decision.options[0]?.id;
          move ??= decision.options.find(
            (option) =>
              ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
              ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
          )?.id;
          if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-12).join('\n')}`);
          beforePayment = {
            untapped: bot.battlefield.filter((card) => !card.tapped).map((card) => card.oid),
            turn: session.view.turn.number,
            mana: session.play?.manaPools?.[1],
          };
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
        }
        expect({ resolved, untapped }, trace.slice(-12).join('\n')).toEqual({
          resolved: true,
          untapped: true,
        });
        expect(landPlayTurns.length).toBeGreaterThanOrEqual(3);
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
}
