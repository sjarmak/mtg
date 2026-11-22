/** Independent AKH/HOU cycling proof through the same observable human decisions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const tableFor = (card: string, land: string): SessionSpec => ({
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Cycling pilot',
      controller: 'local',
      deck: {
        name: 'fixed-mana-cycling',
        cards: [
          { name: land, count: 30 },
          { name: card, count: 30 },
        ],
      },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: {
        name: 'passive',
        cards: [{ name: 'Mountain', count: 60 }],
      },
    },
  ],
  seed: 'akh-hou-censor-cycling-v1',
  maximumTurns: 12,
});

forgeIt.each([
  { card: 'Censor', land: 'Island', cost: 1 },
  { card: 'Sweltering Suns', land: 'Mountain', cost: 3 },
  { card: 'Desert of the Indomitable', land: 'Forest', cost: 2 },
])(
  '$card cycles one exact hand card for $cost mana and draws exactly one',
  async ({ card, land, cost }) => {
    const table = tableFor(card, land);
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourceOid: string | undefined;
    let libraryBefore = -1;
    let handBefore = -1;
    let payments = 0;
    let resolved = false;
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 700 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        if (
          sourceOid !== undefined &&
          session.view.stack.length === 0 &&
          pilot.graveyard.some((card) => card.oid === sourceOid)
        ) {
          expect(pilot.librarySize).toBe(libraryBefore - 1);
          expect(pilot.handSize).toBe(handBefore);
          expect(pilot.hand?.some((card) => card.oid === sourceOid)).toBe(false);
          expect(payments).toBe(cost);
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        let staleSession: ObservedSession | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find(
            (option) => option.text === (decision.seat === 0 ? `Play ${land}` : 'Play Mountain'),
          )?.id;
          if (move === undefined && decision.seat === 0 && sourceOid === undefined) {
            const source = pilot.hand?.find((entry) => entry.name === card);
            const cycle =
              source === undefined
                ? undefined
                : decision.options.find(
                    (option) =>
                      option.id.startsWith(`ability-${source.oid.replace(/^forge-card-/u, '')}-`) &&
                      option.text.includes('Cycling'),
                  );
            if (cycle !== undefined) {
              await expect(session.submit('cycle-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              sourceOid = source?.oid;
              libraryBefore = pilot.librarySize;
              handBefore = pilot.handSize;
              move = cycle.id;
              staleSession = session;
            }
          }
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          payments += 1;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled cycling decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        if (staleSession !== undefined)
          await expect(staleSession.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
        session = advanced.session;
      }
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
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
