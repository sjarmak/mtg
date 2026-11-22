/** Native colored payment, with wrong-color controls; not full-card qualification. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const cases = [
  { land: 'Plains', wrongLand: 'Island', card: 'Adorned Pouncer', cost: 2, action: 'cast' },
  { land: 'Island', wrongLand: 'Swamp', card: 'Censor', cost: 1, action: 'cycle' },
  { land: 'Swamp', wrongLand: 'Mountain', card: 'Khenra Eternal', cost: 2, action: 'cast' },
  { land: 'Mountain', wrongLand: 'Forest', card: 'Defiant Khenra', cost: 2, action: 'cast' },
  { land: 'Forest', wrongLand: 'Plains', card: 'Shefet Monitor', cost: 4, action: 'cycle' },
] as const;

for (const fixture of cases) {
  for (const matching of [true, false]) {
    const land = matching ? fixture.land : fixture.wrongLand;
    forgeIt(
      `Native ${land} ${matching ? 'pays' : 'cannot pay'} the colored cost to ${fixture.action} ${fixture.card}`,
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
              name: 'Mana pilot',
              controller: 'engine',
              deck: {
                name: 'single-color payment',
                cards: [
                  { name: land, count: 30 },
                  { name: fixture.card, count: 30 },
                ],
              },
            },
          ],
          seed: 'akh-hou-native-colored-payment-v1',
          maximumTurns: 16,
        };
        const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
        if (backend === null) throw new Error('Required installed Forge is absent');
        let session: ObservedSession | undefined;
        let paid = false;
        let observedEnoughLands = false;
        let observedThroughTurn = 0;
        const trace: string[] = [];
        try {
          const opened = await backend.open(table);
          if (!opened.ok) throw new Error(opened.error.message);
          session = opened.session;
          for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
            const decision = session.decision;
            if (decision === null) throw new Error('Missing local decision');
            expect(decision.seat).toBe(0);
            const bot = session.view.seats[1];
            expect(bot.hand).toBeNull();
            observedThroughTurn = session.view.turn.number;
            observedEnoughLands ||=
              bot.battlefield.filter((card) => card.name === land).length >= fixture.cost;
            const source = session.view.stack.find((card) => card.name === fixture.card);
            if (source !== undefined) {
              expect(matching, 'A wrong-color mana source must not pay the colored requirement').toBe(true);
              expect(bot.battlefield.every((card) => card.name === land)).toBe(true);
              expect(bot.battlefield.filter((card) => card.tapped)).toHaveLength(fixture.cost);
              expect(bot.graveyard.some((card) => card.oid === source.oid)).toBe(fixture.action === 'cycle');
              expect(session.play?.manaPools?.[1]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
              paid = true;
              break;
            }
            if (!matching) {
              expect(bot.battlefield.every((card) => card.name === land)).toBe(true);
              if (observedThroughTurn >= 12 && observedEnoughLands) break;
            }
            trace.push(
              `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}; lands=${bot.battlefield.length}; hand=${bot.handSize}`,
            );
            const move =
              (decision.kind === 'priority'
                ? decision.options.find((option) => option.text === 'Play Plains')
                : undefined) ??
              (decision.kind === 'discard-selection' ? decision.options[0] : undefined) ??
              decision.options.find(
                (option) =>
                  ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
                  ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
              );
            if (move === undefined) throw new Error(`Unhandled local decision: ${decision.kind}`);
            const advanced = await session.submit(move.id);
            if (!advanced.ok) throw new Error(advanced.error.message);
            session = advanced.session;
          }
          expect(paid, trace.slice(-12).join('\n')).toBe(matching);
          if (!matching) {
            expect(observedEnoughLands, 'Control must have enough lands for the generic amount').toBe(true);
            expect(observedThroughTurn).toBeGreaterThanOrEqual(12);
          }
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
}
