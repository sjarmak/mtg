/** Bot decisions are verified through public counter deltas, never hidden cards. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const counterSeat = (controller: 'local' | 'engine'): SessionSpec['seats'][number] => ({
  name: controller,
  controller,
  deck: {
    name: 'counters',
    cards: [
      { name: 'Swamp', count: 15 },
      { name: 'Forest', count: 15 },
      { name: 'Decimator Beetle', count: 30 },
    ],
  },
});
forgeIt(
  'Forge removes its own counter and puts a counter on a defending creature with Decimator Beetle',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let before: { own: ReadonlyMap<string, number>; enemy: ReadonlyMap<string, number> } | undefined;
    let resolved = false;
    let intermediate = 0;
    const trace: string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [counterSeat('local'), counterSeat('engine')],
        seed: 'akh-hou-decimator-v1',
        maximumTurns: 32,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        const own = session.view.seats[1].battlefield.filter((card) => card.name === 'Decimator Beetle');
        const enemy = session.view.seats[0].battlefield.filter((card) => card.name === 'Decimator Beetle');
        const counts = (cards: typeof own) =>
          new Map(
            cards.map((card) => [
              card.oid,
              Object.values(card.counters).reduce((sum, count) => sum + count, 0),
            ]),
          );
        const attacking = session.view.turn.step === 'COMBAT_DECLARE_ATTACKERS';
        if (
          before === undefined &&
          attacking &&
          enemy.length > 0 &&
          own.some((card) => Object.values(card.counters).some((count) => count > 0)) &&
          session.view.stack.some((card) => own.some((creature) => creature.oid === card.oid))
        ) {
          expect(session.view.stack).toHaveLength(3);
          expect(
            session.view.stack.every(
              (entry) => entry.name === 'Decimator Beetle' && own.some((card) => card.oid === entry.oid),
            ),
          ).toBe(true);
          expect(enemy).toHaveLength(1);
          expect([...counts(own).values()].reduce((sum, count) => sum + count, 0)).toBe(1);
          before = { own: counts(own), enemy: counts(enemy) };
        }
        if (before !== undefined && session.view.stack.length < 3) {
          const currentOwn = counts(own);
          const currentEnemy = counts(enemy);
          const ownDeltas = [...before.own].map(([oid, count]) => (currentOwn.get(oid) ?? NaN) - count);
          const enemyDeltas = [...before.enemy].map(([oid, count]) => (currentEnemy.get(oid) ?? NaN) - count);
          expect(ownDeltas.filter((delta) => delta === -1)).toHaveLength(1);
          expect(enemyDeltas).toEqual([3 - session.view.stack.length]);
          expect(ownDeltas.every((delta) => delta === 0 || delta === -1)).toBe(true);
          if (session.view.stack.length === 0) {
            resolved = true;
            break;
          }
          intermediate += 1;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} stack=${session.view.stack.map((card) => card.name).join(',')} own=${JSON.stringify([...counts(own)])} enemy=${JSON.stringify([...counts(enemy)])}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => ['Play Swamp', 'Play Forest'].includes(option.text))?.id;
          if (enemy.length < 2)
            move ??= decision.options.find((option) => option.text.startsWith('Decimator Beetle:'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) =>
            option.targets.some((target) => target.oid === enemy.at(-1)?.oid),
          )?.id;
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
      expect(resolved, trace.slice(-20).join('\n')).toBe(true);
      expect(intermediate).toBe(2);
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
