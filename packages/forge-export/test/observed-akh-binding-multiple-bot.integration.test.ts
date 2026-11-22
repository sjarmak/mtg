/** Multiple native optional triggers are observed without supplying any bot choices. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'Forge resolves two independent Binding Mummy triggers without exposing bot choices',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let before:
      | { target: string; sources: readonly string[]; mummies: readonly { oid: string; tapped: boolean }[] }
      | undefined;
    let resolved = false;
    let sawOneRemaining = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
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
          {
            name: 'Pilot',
            controller: 'engine',
            deck: {
              name: 'zombies',
              cards: [
                { name: 'Plains', count: 30 },
                { name: 'Binding Mummy', count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-hou-binding-mummy-multiple-native-v1',
        maximumTurns: 24,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        const cats = session.view.seats[0].battlefield.filter((card) => card.name === 'Sacred Cat');
        const mummies = session.view.seats[1].battlefield.filter((card) => card.name === 'Binding Mummy');
        const triggers = session.view.stack.filter((entry) => mummies.some((card) => card.oid === entry.oid));
        if (
          before === undefined &&
          triggers.length === 2 &&
          cats.length === 1 &&
          !cats[0]?.tapped &&
          mummies.length === 3
        ) {
          expect(session.view.stack).toHaveLength(2);
          expect(new Set(triggers.map((entry) => entry.oid)).size).toBe(2);
          expect(triggers.every((entry) => entry.name === 'Binding Mummy')).toBe(true);
          before = {
            target: cats[0]!.oid,
            sources: triggers.map((entry) => entry.oid),
            mummies: mummies.map((card) => ({ oid: card.oid, tapped: card.tapped })),
          };
        }
        const pending =
          before === undefined
            ? undefined
            : session.view.stack.filter((entry) => before?.sources.includes(entry.oid));
        if (pending?.length === 1) {
          sawOneRemaining = true;
        }
        if (before !== undefined && pending?.length === 0) {
          const observation = before;
          expect(cats).toHaveLength(1);
          expect(cats[0]).toMatchObject({ oid: before.target, tapped: true });
          expect(mummies.map((card) => ({ oid: card.oid, tapped: card.tapped }))).toEqual(before.mummies);
          expect(observation.sources.every((oid) => mummies.some((card) => card.oid === oid))).toBe(true);
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} cats=${cats.map((card) => `${card.oid}:${card.tapped}`).join(',')} mummies=${mummies.length} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (cats.length === 0)
            move ??= decision.options.find((option) =>
              option.text.startsWith('Sacred Cat: Sacred Cat - Creature'),
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
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.slice(-15).join('\n')).toBe(true);
      expect(sawOneRemaining).toBe(true);
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
