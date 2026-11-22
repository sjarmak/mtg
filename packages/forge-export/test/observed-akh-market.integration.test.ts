/** Local Market resolution uses real Forge draws and explicit discard choices. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Market pilot',
      controller: 'local',
      deck: {
        name: 'market',
        cards: [
          { name: 'Island', count: 30 },
          { name: 'Farm // Market', count: 30 },
        ],
      },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'observer', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'akh-hou-market-local-v1',
  maximumTurns: 24,
};

forgeIt(
  'Market draws two, discards the selected two physical cards, and exiles itself',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let source: string | undefined;
    let before: { hand: number; library: number } | undefined;
    const discarded = new Set<string>();
    const manaSources = new Set<string>();
    let rejectedInventedDiscard = false;
    let rejectedStaleDiscard = false;
    let drew = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        source ??= pilot.graveyard.find((card) => card.name.includes('Farm'))?.oid;
        if (before !== undefined && pilot.exile.some((card) => card.oid === source)) {
          expect(pilot.librarySize).toBe(before.library - 2);
          expect(pilot.handSize).toBe(before.hand);
          expect(discarded.size).toBe(2);
          for (const oid of discarded) {
            expect(pilot.graveyard.some((card) => card.oid === oid)).toBe(true);
            expect(pilot.hand?.some((card) => card.oid === oid)).toBe(false);
          }
          expect(pilot.graveyard.some((card) => card.oid === source)).toBe(false);
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority' && decision.seat === 0) {
          if (source !== undefined && before === undefined) {
            const sourceOid = source;
            move = decision.options.find((option) => option.text === 'Play Island')?.id;
            const spell = decision.options.find(
              (option) =>
                option.id.startsWith(`ability-${sourceOid.replace(/^forge-card-/u, '')}-`) &&
                option.text.includes('Draw two cards'),
            );
            if (move === undefined && spell !== undefined) {
              expect(session.view.turn.active).toBe(0);
              expect(session.view.turn.step).toMatch(/MAIN/u);
              before = { hand: pilot.handSize, library: pilot.librarySize };
              move = spell.id;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          const payment = decision.options.find((option) => option.id.startsWith('mana-source-'));
          const oid = payment?.targets[0]?.oid;
          if (oid === undefined) throw new Error('Mana payment has no source');
          expect(manaSources.has(oid)).toBe(false);
          manaSources.add(oid);
          move = payment?.id;
        } else if (decision.kind === 'discard-selection' || decision.kind === 'hand-card-selection') {
          const commit = decision.options.find((option) => option.id === 'discard-selection-commit');
          const card = decision.options.find((option) =>
            option.targets.some((target) =>
              before === undefined ? target.name.includes('Farm') : !discarded.has(target.oid),
            ),
          );
          move = commit?.id ?? card?.id ?? decision.options[0]?.id;
          if (before !== undefined && decision.seat === 0) {
            expect(decision.kind).toBe('hand-card-selection');
            for (const option of decision.options) {
              for (const target of option.targets) {
                expect(pilot.hand?.some((card) => card.oid === target.oid)).toBe(true);
              }
            }
            if (!rejectedInventedDiscard) {
              await expect(session.submit('hand-card-selection-invented')).resolves.toMatchObject({
                ok: false,
                error: { kind: 'unknown-move' },
              });
              rejectedInventedDiscard = true;
            }
            if (!drew) {
              expect(pilot.librarySize).toBe(before.library - 2);
              expect(pilot.handSize).toBe(before.hand + 2);
              drew = true;
            }
            if (commit === undefined) {
              const oid = card?.targets[0]?.oid;
              if (oid === undefined) throw new Error('Discard has no physical card');
              discarded.add(oid);
            }
          }
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        if (decision.kind === 'hand-card-selection' && !rejectedStaleDiscard) {
          await expect(session.submit(move)).resolves.toMatchObject({
            ok: false,
            error: {
              kind: 'backend-failure',
              message: expect.stringContaining('stale'),
            },
          });
          rejectedStaleDiscard = true;
        }
        session = advanced.session;
      }
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
      expect(drew).toBe(true);
      expect(manaSources.size).toBe(3);
      expect(rejectedInventedDiscard).toBe(true);
      expect(rejectedStaleDiscard).toBe(true);
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
