/** Two established Mummies independently trigger for a third, even sharing a target. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'two Binding Mummy triggers resolve independently against the same creature',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let sources: readonly string[] | undefined;
    let target: string | undefined;
    let selected = 0;
    let confirmed = 0;
    let sawBoth = false;
    let completed = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Mummy pilot',
            controller: 'local',
            deck: {
              name: 'three Mummies',
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
              name: 'tap target',
              cards: [
                { name: 'Plains', count: 30 },
                { name: 'Sacred Cat', count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-binding-multiple-local-v1',
        maximumTurns: 24,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const mummies = session.view.seats[0].battlefield.filter((card) => card.name === 'Binding Mummy');
        const cats = session.view.seats[1].battlefield.filter((card) => card.name === 'Sacred Cat');
        target ??= cats[0]?.oid;
        if (mummies.length === 2) sources ??= mummies.map((card) => card.oid);
        if (mummies.length === 3 && sources !== undefined) {
          const sourceIds = sources;
          const triggers = session.view.stack.filter((card) => sourceIds.includes(card.oid));
          if (triggers.length === 2) {
            expect(new Set(triggers.map((card) => card.oid))).toEqual(new Set(sources));
            expect(triggers.every((card) => card.name === 'Binding Mummy')).toBe(true);
            sawBoth = true;
          }
          if (confirmed === 2 && session.view.stack.length === 0) {
            expect(cats).toHaveLength(1);
            expect(cats[0]).toMatchObject({ oid: target, tapped: true });
            expect(mummies.every((card) => !card.tapped)).toBe(true);
            completed = true;
            break;
          }
        }
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          const cast =
            decision.seat === 1 && cats.length === 0
              ? 'Sacred Cat'
              : decision.seat === 0 && mummies.length < 3 && cats.length === 1
                ? 'Binding Mummy'
                : undefined;
          if (cast !== undefined)
            move ??= decision.options.find((option) =>
              option.text.startsWith(`${cast}: ${cast} - Creature`),
            )?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'trigger-order') {
          expect(decision.seat).toBe(0);
          expect(mummies).toHaveLength(3);
          move = decision.options[0]?.id;
        } else if (decision.kind === 'target-selection') {
          expect(decision.seat).toBe(0);
          move = decision.options.find((option) =>
            option.targets.some((candidate) => candidate.oid === target),
          )?.id;
          if (mummies.length === 3) selected += 1;
        } else if (decision.kind === 'confirm-trigger') {
          expect(decision.seat).toBe(0);
          if (mummies.length === 2) move = 'confirm-trigger-no';
          else {
            expect(mummies).toHaveLength(3);
            expect(cats[0]?.tapped).toBe(confirmed === 1);
            expect(confirmed).toBeLessThan(2);
            confirmed += 1;
            move = 'confirm-trigger-yes';
          }
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
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(completed, trace.slice(-15).join('\n')).toBe(true);
      expect(sawBoth, 'Both established physical Mummies must independently source a trigger').toBe(true);
      expect(selected).toBe(2);
      expect(confirmed).toBe(2);
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
