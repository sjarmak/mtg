/** A Zombie entry offers a real optional trigger, not an optional target. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt.each([true, false])(
  'Binding Mummy optional tap (accept: %s)',
  async (accept) => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Pilot',
          controller: 'local',
          deck: {
            name: 'zombies',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Binding Mummy', count: 30 },
            ],
          },
        },
        {
          name: 'Observer',
          controller: 'local',
          deck: {
            name: 'observer',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Sacred Cat', count: 30 },
            ],
          },
        },
      ],
      seed: 'akh-hou-binding-mummy-v1',
      maximumTurns: 24,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let confirmed = false;
    let targeted = false;
    let resolved = false;
    let targetOid: string | undefined;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const own = session.view.seats[0].battlefield.filter((card) => card.name === 'Binding Mummy');
        const opposing = session.view.seats[1].battlefield.filter((card) => card.name === 'Sacred Cat');
        targetOid ??= opposing[0]?.oid;
        if (confirmed && session.view.stack.length === 0) {
          expect(opposing).toHaveLength(1);
          expect(opposing[0]).toMatchObject({ oid: targetOid, tapped: accept });
          expect(own).toHaveLength(2);
          expect(own.every((card) => !card.tapped)).toBe(true);
          resolved = true;
          break;
        }
        trace.push(
          `${decision.seat}/${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (decision.seat === 1 && opposing.length === 0)
            move ??= decision.options.find((option) =>
              option.text.startsWith('Sacred Cat: Sacred Cat - Creature'),
            )?.id;
          if (decision.seat === 0 && own.length < 2 && (own.length === 0 || opposing.length === 1))
            move ??= decision.options.find((option) => option.text.startsWith('Binding Mummy:'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'confirm-trigger') {
          expect(targeted).toBe(true);
          expect(decision.seat).toBe(0);
          expect(own).toHaveLength(2);
          expect(opposing[0]?.tapped).toBe(false);
          expect(decision.options.map((option) => option.id)).toEqual([
            'confirm-trigger-yes',
            'confirm-trigger-no',
          ]);
          move = accept ? 'confirm-trigger-yes' : 'confirm-trigger-no';
          confirmed = true;
        } else if (decision.kind === 'target-selection') {
          expect(confirmed).toBe(false);
          expect(decision.seat).toBe(0);
          expect(
            new Set(decision.options.flatMap((option) => option.targets.map((target) => target.oid))),
          ).toEqual(new Set([...own, ...opposing].map((card) => card.oid)));
          move = decision.options.find((option) =>
            option.targets.some((target) => target.oid === targetOid),
          )?.id;
          targeted = true;
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
        if (decision.kind === 'target-selection' || decision.kind === 'confirm-trigger')
          await expect(session.submit('invented-choice')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        if (decision.kind === 'target-selection' || decision.kind === 'confirm-trigger')
          await expect(session.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
        session = advanced.session;
      }
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
      expect(targeted).toBe(true);
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
