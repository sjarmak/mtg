/** Cycling search must resolve before the draw, using only the revealed legal candidates. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Monitor pilot',
      controller: 'local',
      deck: {
        name: 'monitor-search',
        cards: [
          { name: 'Forest', count: 30 },
          { name: 'Shefet Monitor', count: 20 },
          { name: 'Desert of the Indomitable', count: 10 },
        ],
      },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'akh-shefet-search-v1',
  maximumTurns: 16,
};

forgeIt.each(['Forest', 'Desert of the Indomitable', 'decline'])(
  'Shefet Monitor cycles for four mana and searches before drawing: %s',
  async (selection) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let sourceOid: string | undefined;
    let landOid: string | undefined;
    let libraryBefore = -1;
    let handBefore = -1;
    let searched = false;
    let resolved = false;
    const payments = new Set<string>();
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        if (searched && session.view.stack.length === 0) {
          expect(pilot.graveyard.some((card) => card.oid === sourceOid)).toBe(true);
          expect(pilot.handSize).toBe(handBefore);
          expect(pilot.librarySize).toBe(libraryBefore - (selection === 'decline' ? 1 : 2));
          expect(payments.size).toBe(4);
          if (selection !== 'decline') {
            const land = pilot.battlefield.find((card) => card.oid === landOid);
            expect(land?.name).toBe(selection);
            expect(land?.tapped).toBe(selection === 'Desert of the Indomitable');
          }
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find(
            (option) => option.text === (decision.seat === 0 ? 'Play Forest' : 'Play Mountain'),
          )?.id;
          if (move === undefined && decision.seat === 0 && sourceOid === undefined) {
            const source = pilot.hand?.find((card) => card.name === 'Shefet Monitor');
            const cycle =
              source === undefined
                ? undefined
                : decision.options.find(
                    (option) =>
                      option.id.startsWith(`ability-${source.oid.replace(/^forge-card-/u, '')}-`) &&
                      option.text.includes('Cycling'),
                  );
            if (cycle !== undefined) {
              sourceOid = source?.oid;
              libraryBefore = pilot.librarySize;
              handBefore = pilot.handSize;
              move = cycle.id;
            }
          }
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          if (move !== undefined) payments.add(move);
        } else if (decision.kind === 'zone-card-selection') {
          await expect(session.submit('zone-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          expect(decision.seat).toBe(0);
          expect(pilot.librarySize).toBe(libraryBefore);
          expect(pilot.handSize).toBe(handBefore - 1);
          expect(pilot.graveyard.some((card) => card.oid === sourceOid)).toBe(true);
          const candidates = decision.options.flatMap((option) => option.targets);
          expect(candidates.some((card) => card.name === 'Forest')).toBe(true);
          expect(candidates.some((card) => card.name === 'Desert of the Indomitable')).toBe(true);
          expect(
            candidates.every((card) => ['Forest', 'Desert of the Indomitable'].includes(card.name)),
          ).toBe(true);
          expect(new Set(candidates.map((card) => card.oid)).size).toBe(candidates.length);
          const choice = decision.options.find((option) =>
            selection === 'decline' ? option.id === 'zone-decline' : option.targets[0]?.name === selection,
          );
          move = choice?.id;
          landOid = choice?.targets[0]?.oid;
          searched = true;
        } else if (decision.kind === 'confirm-trigger') {
          move = decision.options.find((option) => option.text === 'Use the trigger')?.id;
        } else if (decision.kind === 'confirm-action' && searched && selection === 'decline') {
          move = decision.options.find((option) => option.id === 'confirm-action-yes')?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled Monitor decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
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
