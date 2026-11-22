/** Observe native trigger exclusions through the public stack, never bot internals. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt.each(['itself', 'own non-Zombie', 'opposing Zombie'] as const)(
  'Native Binding Mummy does not trigger for %s',
  async (scenario) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let pending: { oid: string; mummies: readonly string[] } | undefined;
    let completed = false;
    const name =
      scenario === 'itself'
        ? 'Binding Mummy'
        : scenario === 'own non-Zombie'
          ? 'Colossapede'
          : 'Those Who Serve';
    const seat = scenario === 'opposing Zombie' ? 0 : 1;
    const trace: string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: {
              name: 'entry observer',
              cards: [
                { name: 'Plains', count: 24 },
                { name: 'Sacred Cat', count: 18 },
                { name: 'Those Who Serve', count: 18 },
              ],
            },
          },
          {
            name: 'Native pilot',
            controller: 'engine',
            deck: {
              name: 'entry exclusions',
              cards: [
                { name: 'Plains', count: 12 },
                { name: 'Forest', count: 12 },
                { name: 'Binding Mummy', count: 18 },
                { name: 'Colossapede', count: 18 },
              ],
            },
          },
        ],
        seed: `akh-binding-native-negative-${scenario}-v1`,
        maximumTurns: 24,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        const mummies = session.view.seats[1].battlefield.filter((card) => card.name === 'Binding Mummy');
        const own = session.view.seats[0].battlefield;
        const cats = own.filter((card) => card.name === 'Sacred Cat');
        const spell = session.view.stack.find((card) => card.name === name && card.controller === seat);
        const eligible = scenario === 'itself' ? mummies.length === 0 : mummies.length > 0;
        if (pending === undefined && eligible && spell !== undefined && cats.length > 0) {
          expect(session.view.stack).toHaveLength(1);
          pending = { oid: spell.oid, mummies: mummies.map((card) => card.oid) };
        }
        if (pending !== undefined) {
          const tracked = pending;
          const entry = session.view.seats[seat].battlefield.find((card) => card.oid === tracked.oid);
          const triggerSources = [...tracked.mummies, ...(scenario === 'itself' ? [tracked.oid] : [])];
          expect(
            session.view.stack.filter(
              (card) =>
                triggerSources.includes(card.oid) &&
                // Before entry, the first Mummy itself is a spell, not a trigger.
                !(scenario === 'itself' && entry === undefined && card.oid === tracked.oid),
            ),
          ).toEqual([]);
          if (entry !== undefined) {
            expect(entry.name).toBe(name);
            expect(entry.controller).toBe(seat);
            expect(session.view.stack).toHaveLength(0);
            expect(mummies.map((card) => card.oid)).toEqual(
              scenario === 'itself' ? [tracked.oid] : tracked.mummies,
            );
            completed = true;
            break;
          }
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} mummies=${mummies.length} stack=${session.view.stack.map((card) => `${card.name}:${card.oid}`).join(',')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          const cast =
            cats.length === 0
              ? 'Sacred Cat'
              : scenario === 'opposing Zombie' && mummies.length > 0 && pending === undefined
                ? 'Those Who Serve'
                : undefined;
          if (cast !== undefined)
            move ??= decision.options.find((option) =>
              option.text.startsWith(`${cast}: ${cast} - Creature`),
            )?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
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
        if (move === undefined) throw new Error(`Unhandled ${decision.kind}\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(pending, trace.slice(-15).join('\n')).toBeDefined();
      expect(completed, 'The actual named spell must resolve without a Mummy trigger').toBe(true);
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
