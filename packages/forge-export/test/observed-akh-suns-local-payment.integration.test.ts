/** Local cycling spends generic mana before its one-card draw resolves. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const SUNS = 'Sweltering Suns';
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

forgeIt.each(['Mountain', 'Plains'])(
  'Local pilot pays exactly three %s sources to cycle Sweltering Suns',
  async (land) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let cycle: { oid: string; library: number; hand: number; turn: number; step: string } | undefined;
    let paid: readonly string[] = [];
    let stacked = false;
    let resolved = false;
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Cycling pilot',
            controller: 'local',
            deck: {
              name: 'generic cycling',
              cards: [
                { name: land, count: 30 },
                { name: SUNS, count: 30 },
              ],
            },
          },
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'passive', cards: [{ name: 'Mountain', count: 60 }] },
          },
        ],
        seed: 'akh-hou-censor-cycling-v1',
        maximumTurns: 16,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        const activated = cycle;
        if (activated !== undefined && session.view.stack.some((card) => card.oid === activated.oid)) {
          expect(paid).toHaveLength(3);
          expect(new Set(paid).size).toBe(3);
          expect(
            pilot.battlefield
              .filter((card) => card.tapped)
              .map((card) => card.oid)
              .sort(),
          ).toEqual([...paid].sort());
          expect(pilot.graveyard.find((card) => card.oid === activated.oid)).toMatchObject({ name: SUNS });
          expect(pilot.handSize).toBe(activated.hand - 1);
          expect(pilot.librarySize).toBe(activated.library);
          expect(session.play?.manaPools?.[0]).toEqual(EMPTY_MANA);
          stacked = true;
        }
        if (activated !== undefined && stacked && session.view.stack.length === 0) {
          expect(session.view.turn.number).toBe(activated.turn);
          expect(session.view.turn.step).toBe(activated.step);
          expect(pilot.librarySize).toBe(activated.library - 1);
          expect(pilot.handSize).toBe(activated.hand);
          expect(pilot.hand?.some((card) => card.oid === activated.oid)).toBe(false);
          expect(pilot.graveyard.filter((card) => card.oid === activated.oid)).toHaveLength(1);
          expect(pilot.exile.some((card) => card.oid === activated.oid)).toBe(false);
          expect(session.view.seats.map((seat) => seat.life)).toEqual([20, 20]);
          expect(session.play?.manaPools?.[0]).toEqual(EMPTY_MANA);
          resolved = true;
          break;
        }
        let move: string | undefined;
        if (decision.kind === 'priority' && cycle === undefined) {
          move = decision.options.find(
            (option) => option.text === `Play ${decision.seat === 0 ? land : 'Mountain'}`,
          )?.id;
          const source = decision.seat === 0 ? pilot.hand?.find((card) => card.name === SUNS) : undefined;
          const option =
            source === undefined
              ? undefined
              : decision.options.find(
                  (entry) =>
                    entry.id.startsWith(`ability-${source.oid.replace(/^forge-card-/u, '')}-`) &&
                    entry.text.includes('Cycling'),
                );
          if (move === undefined && source !== undefined && option !== undefined) {
            expect(pilot.battlefield.every((card) => card.name === land && !card.tapped)).toBe(true);
            expect(session.play?.manaPools?.[0]).toEqual(EMPTY_MANA);
            cycle = {
              oid: source.oid,
              library: pilot.librarySize,
              hand: pilot.handSize,
              turn: session.view.turn.number,
              step: session.view.turn.step,
            };
            move = option.id;
          }
        } else if (decision.kind === 'mana-payment') {
          expect(decision.seat).toBe(0);
          expect(cycle).toBeDefined();
          const source = decision.options.find((option) => option.id.startsWith('mana-source-'));
          if (source === undefined) throw new Error('Missing basic-land payment option');
          const before = pilot.battlefield;
          const advanced = await session.submit(source.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          const tapped = advanced.session.view.seats[0].battlefield.filter(
            (card) => card.tapped && before.some((old) => old.oid === card.oid && !old.tapped),
          );
          expect(tapped).toHaveLength(1);
          expect(tapped[0]?.name).toBe(land);
          paid = [...paid, tapped[0]!.oid];
          session = advanced.session;
          continue;
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
        if (move === undefined)
          throw new Error(
            `Unhandled ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
          );
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(resolved).toBe(true);
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
