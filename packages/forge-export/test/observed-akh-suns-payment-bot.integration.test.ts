/** Observe native cycling payment using only public zones and basic-land mana. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const SUNS = 'Sweltering Suns';

forgeIt.each(['Mountain', 'Plains'])(
  'Forge pays exactly three %s sources to cycle Sweltering Suns',
  async (land) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let previous: ObservedSession | undefined;
    let cycle:
      | {
          oid: string;
          library: number;
          hand: number;
          sources: readonly string[];
          board: readonly string[];
          graveyard: readonly string[];
          turn: number;
          step: string;
        }
      | undefined;
    let resolved = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'passive', cards: [{ name: 'Plains', count: 60 }] },
          },
          {
            name: 'Native cycling pilot',
            controller: 'engine',
            deck: {
              name: 'generic cycling',
              cards: [
                { name: land, count: 30 },
                { name: SUNS, count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-hou-censor-engine-v1',
        maximumTurns: 32,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[1];
        expect(pilot.hand).toBeNull();
        expect(pilot.battlefield.every((card) => card.name === land)).toBe(true);
        const ability = session.view.stack.find((card) => card.name === SUNS);
        const observedCycle = cycle;
        if (cycle === undefined && ability !== undefined) {
          expect(previous).toBeDefined();
          if (previous === undefined) throw new Error('Missing pre-activation public frame');
          const before = previous.view.seats[1];
          expect(previous.view.turn.number).toBe(session.view.turn.number);
          expect(previous.view.stack).toHaveLength(0);
          expect(before.battlefield.every((card) => !card.tapped)).toBe(true);
          expect(previous.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          expect(session.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          expect(ability.controller).toBe(1);
          expect(session.view.stack).toHaveLength(1);
          const tapped = pilot.battlefield.filter((card) => card.tapped);
          expect(tapped).toHaveLength(3);
          // No earlier spell or ability could have consumed mana on this otherwise empty table.
          const newLands = pilot.battlefield.filter(
            (card) => !before.battlefield.some((old) => old.oid === card.oid),
          );
          expect(newLands.length).toBeLessThanOrEqual(1);
          expect(before.graveyard.some((card) => card.oid === ability.oid)).toBe(false);
          expect(
            pilot.graveyard.filter((card) => !before.graveyard.some((old) => old.oid === card.oid)),
          ).toEqual([expect.objectContaining({ oid: ability.oid, name: SUNS })]);
          expect(pilot.librarySize).toBe(before.librarySize);
          expect(pilot.handSize).toBe(before.handSize - 1 - newLands.length);
          cycle = {
            oid: ability.oid,
            library: pilot.librarySize,
            hand: pilot.handSize,
            sources: tapped.map((card) => card.oid),
            board: pilot.battlefield.map((card) => card.oid),
            graveyard: pilot.graveyard.map((card) => card.oid),
            turn: session.view.turn.number,
            step: session.view.turn.step,
          };
        } else if (
          observedCycle !== undefined &&
          !session.view.stack.some((card) => card.oid === observedCycle.oid)
        ) {
          expect(session.view.turn.number).toBe(observedCycle.turn);
          expect(session.view.turn.step).toBe(observedCycle.step);
          expect(pilot.librarySize).toBe(observedCycle.library - 1);
          // Forge can activate a second cycle or play a land before yielding again.
          const newDiscards = pilot.graveyard.filter((card) => !observedCycle.graveyard.includes(card.oid));
          for (const card of newDiscards) {
            expect(card.name).toBe(SUNS);
            expect(
              session.view.stack.some((source) => source.oid === card.oid && source.controller === 1),
            ).toBe(true);
          }
          const newLands = pilot.battlefield.filter((card) => !observedCycle.board.includes(card.oid));
          expect(newLands.length).toBeLessThanOrEqual(1);
          expect(pilot.handSize).toBe(observedCycle.hand + 1 - newDiscards.length - newLands.length);
          expect(pilot.graveyard.some((card) => card.oid === observedCycle.oid)).toBe(true);
          expect(pilot.exile.some((card) => card.oid === observedCycle.oid)).toBe(false);
          expect(
            observedCycle.sources.every((oid) =>
              pilot.battlefield.some((card) => card.oid === oid && card.tapped),
            ),
          ).toBe(true);
          expect(session.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          expect(session.view.seats.map((seat) => seat.life)).toEqual([20, 20]);
          resolved = true;
          break;
        }
        trace = [
          ...trace.slice(-12),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: board=${pilot.battlefield.map((card) => `${card.name}:${card.oid}:${card.tapped}`).join(',')} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        ];
        const move =
          decision.kind === 'discard-selection'
            ? (decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
              decision.options[0]?.id)
            : decision.options.find(
                (option) =>
                  ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
                  ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
              )?.id;
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.join('\n')}`);
        previous = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.join('\n')).toBe(true);
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
