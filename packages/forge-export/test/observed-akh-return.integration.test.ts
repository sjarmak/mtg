/** Return targets either graveyard through public choices, then makes a real token. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
for (const targetSeat of [0, 1] as const) {
  forgeIt(
    `Return exiles a selected card from seat ${String(targetSeat)} and creates one Zombie`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Return pilot',
            controller: 'local',
            deck: {
              name: 'return',
              cards: [
                { name: 'Swamp', count: 30 },
                { name: 'Never // Return', count: 30 },
              ],
            },
          },
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'observer', cards: [{ name: 'Mountain', count: 60 }] },
          },
        ],
        seed: `akh-hou-return-${String(targetSeat)}-v1`,
        maximumTurns: 24,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      let source: string | undefined;
      let selected: string | undefined;
      let survivors: readonly string[] = [];
      let cast = false;
      let resolved = false;
      let rejectedStale = false;
      const trace: string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          const pilot = session.view.seats[0];
          source ??= pilot.graveyard.find((card) => card.name.includes('Never'))?.oid;
          if (cast && pilot.exile.some((card) => card.oid === source)) {
            expect(selected).toBeDefined();
            const owner = session.view.seats[targetSeat];
            expect(owner.exile.some((card) => card.oid === selected)).toBe(true);
            expect(owner.graveyard.some((card) => card.oid === selected)).toBe(false);
            const graves = session.view.seats.flatMap((seat) => seat.graveyard);
            for (const oid of survivors) expect(graves.some((card) => card.oid === oid)).toBe(true);
            expect(graves.some((card) => card.oid === source)).toBe(false);
            const tokens = pilot.battlefield.filter((card) => card.typeLine.includes('Zombie'));
            expect(tokens).toHaveLength(1);
            expect(tokens[0]).toMatchObject({ power: 2, toughness: 2 });
            expect(tokens[0]?.oid).not.toBe(source);
            expect(tokens[0]?.oid).not.toBe(selected);
            expect(session.view.seats[1].battlefield).toHaveLength(0);
            resolved = true;
            break;
          }
          trace.push(
            `${decision.seat}/${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
          );
          let move: string | undefined;
          if (decision.kind === 'priority' && decision.seat === 0 && !cast) {
            // Two cleanup discards provide the source and another own-graveyard target.
            if (pilot.graveyard.length >= 2 && source !== undefined) {
              const sourceOid = source;
              move = decision.options.find((option) => option.text === 'Play Swamp')?.id;
              const spell = decision.options.find(
                (option) =>
                  option.id.startsWith(`ability-${sourceOid.replace(/^forge-card-/u, '')}-`) &&
                  option.text.includes('Exile target card'),
              );
              if (move === undefined && spell !== undefined) {
                expect(session.view.turn.active).toBe(0);
                expect(session.view.turn.step).toMatch(/MAIN/u);
                move = spell.id;
                cast = true;
              }
            }
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'target-selection') {
            expect(cast).toBe(true);
            const graveCards = session.view.seats.flatMap((seat) => seat.graveyard);
            expect(
              new Set(decision.options.flatMap((option) => option.targets.map((entry) => entry.oid))),
            ).toEqual(new Set(graveCards.map((card) => card.oid)));
            const owned = new Set(session.view.seats[targetSeat].graveyard.map((card) => card.oid));
            const choice = decision.options.find((option) =>
              option.targets.some((entry) => owned.has(entry.oid)),
            );
            selected = choice?.targets[0]?.oid;
            expect(selected).not.toBe(source);
            survivors = graveCards.filter((card) => card.oid !== selected).map((card) => card.oid);
            await expect(session.submit('target-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            move = choice?.id;
          } else if (decision.kind === 'discard-selection') {
            move =
              decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
              decision.options.find((option) => option.targets.some((entry) => entry.name.includes('Never')))
                ?.id ??
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
            rejectedStale = true;
          }
          session = advanced.session;
        }
        expect(resolved, trace.slice(-12).join('\n')).toBe(true);
        expect(rejectedStale).toBe(true);
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
