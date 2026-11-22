/** Independent local aftermath probe through ordinary observed decisions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Aftermath pilot',
      controller: 'local',
      deck: {
        name: 'dawn',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Dusk // Dawn', count: 15 },
          { name: 'Sacred Cat', count: 15 },
        ],
      },
    },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'akh-hou-aftermath-v1',
  maximumTurns: 30,
};

forgeIt(
  'casts Dawn from the graveyard, returns the exact creature, and exiles the split card',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let source: string | undefined;
    let cat: string | undefined;
    let cast = false;
    let resolved = false;
    let offTurnChecked = false;
    let handFaceChecked = false;
    const manaSources = new Set<string>();
    const trace: string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        source ??= pilot.graveyard.find((card) => card.name.includes('Dusk'))?.oid;
        cat ??= pilot.graveyard.find((card) => card.name === 'Sacred Cat')?.oid;
        if (cast && pilot.exile.some((card) => card.oid === source)) {
          expect(pilot.hand?.some((card) => card.oid === cat)).toBe(true);
          expect(pilot.graveyard.some((card) => card.oid === source || card.oid === cat)).toBe(false);
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority' && decision.seat === 0) {
          const dawnOptions = decision.options.filter((option) =>
            option.text.includes('Return all creature cards'),
          );
          for (const option of dawnOptions) {
            expect(
              pilot.graveyard.some((card) =>
                option.id.startsWith(`ability-${card.oid.replace(/^forge-card-/u, '')}-`),
              ),
            ).toBe(true);
          }
          if (
            pilot.battlefield.filter((card) => card.name === 'Plains').length >= 5 &&
            pilot.hand?.some((card) => card.name.includes('Dusk'))
          ) {
            handFaceChecked = true;
          }
          if (source !== undefined && cat !== undefined) {
            const prefix = `ability-${source.replace(/^forge-card-/u, '')}-`;
            expect(
              decision.options.some(
                (option) => option.id.startsWith(prefix) && option.text.includes('Destroy all creatures'),
              ),
            ).toBe(false);
            if (session.view.turn.active !== 0) {
              expect(dawnOptions).toEqual([]);
              offTurnChecked = true;
            }
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
            const dawn = dawnOptions.find((option) => option.id.startsWith(prefix));
            if (move === undefined && dawn !== undefined && !cast) {
              expect(session.view.turn.active).toBe(0);
              expect(session.view.turn.step).toMatch(/MAIN/u);
              move = dawn.id;
              cast = true;
            }
          }
        } else if (decision.kind === 'mana-payment') {
          const payment = decision.options.find((option) => option.id.startsWith('mana-source-'));
          const oid = payment?.targets[0]?.oid;
          if (oid === undefined) throw new Error('No mana source');
          expect(manaSources.has(oid)).toBe(false);
          manaSources.add(oid);
          move = payment?.id;
        } else if (decision.kind === 'discard-selection') {
          const wanted =
            decision.seat !== 0
              ? 'Mountain'
              : source === undefined
                ? 'Dusk'
                : cat === undefined
                  ? 'Sacred Cat'
                  : 'Plains';
          move = decision.options.find((option) =>
            option.targets.some((target) => target.name.includes(wanted)),
          )?.id;
          move ??= decision.options[0]?.id;
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
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
      expect(manaSources.size).toBe(5);
      expect(offTurnChecked).toBe(true);
      expect(handFaceChecked).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);
