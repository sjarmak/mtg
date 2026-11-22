/** Installed Forge owns the linked counter effects; the bridge owns legal choices. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const counterSeat = (name: string): SessionSpec['seats'][number] => ({
  name,
  controller: 'local',
  deck: {
    name: 'counters',
    cards: [
      { name: 'Swamp', count: 15 },
      { name: 'Forest', count: 15 },
      { name: 'Decimator Beetle', count: 30 },
    ],
  },
});
forgeIt.each([true, false])(
  'Decimator Beetle resolves linked counters (opposing target: %s)',
  async (targetOpponent) => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [counterSeat('Pilot'), counterSeat('Observer')],
      seed: 'akh-hou-decimator-v1',
      maximumTurns: 32,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let attacked = false;
    let removed = false;
    let placed = false;
    let resolved = false;
    let friendly: string | undefined;
    let enemy: string | undefined;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const own = session.view.seats[0].battlefield.filter((card) => card.name === 'Decimator Beetle');
        const opposing = session.view.seats[1].battlefield.filter((card) => card.name === 'Decimator Beetle');
        if (placed && session.view.stack.length === 0) {
          expect(own.find((card) => card.oid === friendly)).toMatchObject({ power: 4, toughness: 5 });
          expect(own.find((card) => card.oid !== friendly)).toMatchObject({ power: 3, toughness: 4 });
          expect(opposing.find((card) => card.oid === enemy)).toMatchObject({
            power: targetOpponent ? 2 : 3,
            toughness: targetOpponent ? 3 : 4,
          });
          expect(opposing.find((card) => card.oid !== enemy)).toMatchObject({ power: 3, toughness: 4 });
          resolved = true;
          break;
        }
        trace.push(
          `${decision.seat}/${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => ['Play Swamp', 'Play Forest'].includes(option.text))?.id;
          const creatures = seatViewOf(session.view, decision.seat).battlefield.filter(
            (card) => card.name === 'Decimator Beetle',
          );
          if (creatures.length < 2)
            move ??= decision.options.find((option) => option.text.startsWith('Decimator Beetle:'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'target-selection') {
          const creatures = seatViewOf(session.view, decision.seat).battlefield.filter(
            (card) => card.name === 'Decimator Beetle',
          );
          const eligible = attacked && removed ? opposing : creatures;
          expect(
            new Set(decision.options.flatMap((option) => option.targets.map((target) => target.oid))),
          ).toEqual(new Set(eligible.map((card) => card.oid)));
          if (!attacked) {
            move = decision.options.find((option) =>
              option.targets.some((target) => target.oid === creatures.at(-1)?.oid),
            )?.id;
          } else if (!removed) {
            friendly = own[1]?.oid;
            move = decision.options.find((option) =>
              option.targets.some((target) => target.oid === friendly),
            )?.id;
            removed = true;
          } else {
            enemy = opposing[0]?.oid;
            move = targetOpponent
              ? decision.options.find((option) => option.targets.some((target) => target.oid === enemy))?.id
              : decision.options.find((option) => option.id === 'target-none')?.id;
            placed = true;
          }
          await expect(session.submit('target-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
        }
        if (!attacked && decision.seat === 0 && own.length === 2 && opposing.length === 2) {
          move ??= decision.options.find(
            (option) =>
              option.id.startsWith('combat-attack-add-') &&
              option.targets.some((target) => target.oid === own[0]?.oid),
          )?.id;
          if (move?.startsWith('combat-attack-add-')) attacked = true;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        if (decision.kind === 'target-selection')
          await expect(session.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
        session = advanced.session;
      }
      expect(resolved, trace.slice(-10).join('\n')).toBe(true);
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
