/** Never's creature and planeswalker targets use the existing physical target seam. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
for (const targetName of ['Defiant Khenra', "Liliana, Death's Majesty"] as const) {
  forgeIt(
    `Never destroys the selected ${targetName} and excludes lands`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Never pilot',
            controller: 'local',
            deck: {
              name: 'removal',
              cards: [
                { name: 'Swamp', count: 30 },
                { name: 'Never // Return', count: 30 },
              ],
            },
          },
          {
            name: 'Target pilot',
            controller: 'local',
            deck: {
              name: 'targets',
              cards: [
                { name: targetName === 'Defiant Khenra' ? 'Mountain' : 'Swamp', count: 30 },
                { name: targetName, count: 30 },
              ],
            },
          },
        ],
        seed: `akh-hou-never-local-${targetName}-v1`,
        maximumTurns: 24,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      let source: string | undefined;
      let target: string | undefined;
      let cast = false;
      let resolved = false;
      let staleRejected = false;
      let preserved: readonly string[] = [];
      const trace: string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          const pilot = session.view.seats[0];
          const opponent = session.view.seats[1];
          if (cast) source ??= session.view.stack.find((card) => card.name.includes('Never'))?.oid;
          if (source !== undefined && pilot.graveyard.some((card) => card.oid === source)) {
            expect(opponent.graveyard.some((card) => card.oid === target)).toBe(true);
            expect(opponent.battlefield.some((card) => card.oid === target)).toBe(false);
            expect(pilot.exile.some((card) => card.oid === source)).toBe(false);
            for (const oid of preserved)
              expect(opponent.battlefield.some((card) => card.oid === oid)).toBe(true);
            resolved = true;
            break;
          }
          trace.push(
            `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
          );
          let move: string | undefined;
          if (decision.kind === 'priority' && !cast) {
            move = decision.options.find(
              (option) =>
                option.text ===
                (decision.seat === 0 || targetName !== 'Defiant Khenra' ? 'Play Swamp' : 'Play Mountain'),
            )?.id;
            if (decision.seat === 1 && !opponent.battlefield.some((card) => card.name === targetName)) {
              move ??= decision.options.find((option) => option.text.startsWith(`${targetName}:`))?.id;
            }
            if (
              decision.seat === 0 &&
              move === undefined &&
              opponent.battlefield.some((card) => card.name === targetName)
            ) {
              move = decision.options.find((option) =>
                option.text.includes('Destroy target creature or planeswalker'),
              )?.id;
              if (move !== undefined) cast = true;
            }
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'target-selection') {
            expect(cast).toBe(true);
            const valid = opponent.battlefield.filter((card) => card.name === targetName);
            expect(
              new Set(decision.options.flatMap((option) => option.targets.map((entry) => entry.oid))),
            ).toEqual(new Set(valid.map((card) => card.oid)));
            const choice = decision.options.find((option) =>
              option.targets.some((entry) => entry.name === targetName),
            );
            target = choice?.targets[0]?.oid;
            expect(target).toBeDefined();
            preserved = opponent.battlefield.filter((card) => card.oid !== target).map((card) => card.oid);
            expect(preserved.length).toBeGreaterThan(0);
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = choice?.id;
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
          if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
          if (decision.kind === 'target-selection') {
            await expect(session.submit(move)).resolves.toMatchObject({
              ok: false,
              error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
            });
            staleRejected = true;
          }
          session = advanced.session;
        }
        expect(resolved, trace.slice(-12).join('\n')).toBe(true);
        expect(staleRejected).toBe(true);
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
