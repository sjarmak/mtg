/** Forge AI must choose exert itself; the driver sees only its public cards. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local blocker',
      controller: 'local',
      deck: {
        name: 'blocker',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Adorned Pouncer', count: 30 },
        ],
      },
    },
    {
      name: 'Forge exert pilot',
      controller: 'engine',
      deck: {
        name: 'crasher',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Ahn-Crop Crasher', count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-hou-exert-engine-v1',
  maximumTurns: 24,
};

forgeIt(
  'Forge AI exerts an attacking Crasher against a blocker and skips its next untap',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let exerted: { readonly oid: string; readonly turn: number } | undefined;
    let skippedUntap = false;
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const attackingSource = bot.battlefield.find(
          (card) =>
            card.name === 'Ahn-Crop Crasher' &&
            card.attacking &&
            session?.view.stack.some((stacked) => stacked.oid === card.oid),
        );
        if (exerted === undefined && attackingSource !== undefined) {
          expect(pilot.battlefield.some((card) => card.name === 'Adorned Pouncer' && !card.tapped)).toBe(
            true,
          );
          expect(attackingSource.tapped).toBe(true);
          exerted = { oid: attackingSource.oid, turn: session.view.turn.number };
        }
        const observed = exerted;
        if (
          observed !== undefined &&
          session.view.turn.active === 1 &&
          session.view.turn.number === observed.turn + 2 &&
          session.view.turn.step === 'UPKEEP'
        ) {
          expect(bot.battlefield.find((card) => card.oid === observed.oid)?.tapped).toBe(true);
          skippedUntap = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (move === undefined && !pilot.battlefield.some((card) => card.name === 'Adorned Pouncer'))
            move = decision.options.find(
              (option) => option.text.startsWith('Adorned Pouncer:') && !option.text.includes('Eternalize'),
            )?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => target.name === 'Adorned Pouncer'),
          )?.id;
        }
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
      expect(exerted, trace.slice(-20).join('\n')).toBeDefined();
      expect(skippedUntap, trace.slice(-20).join('\n')).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);
