/** Observe Forge AI cycling through public zones, without inspecting its hidden hand. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const tableFor = (card: string, land: string): SessionSpec => ({
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local pilot',
      controller: 'local',
      deck: {
        name: 'pouncer',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Adorned Pouncer', count: 30 },
        ],
      },
    },
    {
      name: 'Forge counter pilot',
      controller: 'engine',
      deck: {
        name: 'cycling-bot',
        cards:
          card === 'Desert of the Indomitable'
            ? [
                { name: land, count: 26 },
                { name: card, count: 14 },
                { name: 'Shefet Monitor', count: 20 },
              ]
            : [
                { name: land, count: 30 },
                { name: card, count: 30 },
              ],
      },
    },
  ],
  seed: 'akh-hou-censor-engine-v1',
  maximumTurns: 40,
});

forgeIt.each([
  { cardName: 'Censor', land: 'Island' },
  { cardName: 'Sweltering Suns', land: 'Mountain' },
  { cardName: 'Desert of the Indomitable', land: 'Forest' },
])(
  'Forge AI cycles $cardName with exact public card conservation',
  async ({ cardName, land }) => {
    const table = tableFor(cardName, land);
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cycling:
      | {
          oid: string;
          library: number;
          hand: number;
          turn: number;
          step: string;
          graveyard: readonly string[];
          battlefield: readonly string[];
        }
      | undefined;
    let cycled = false;
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const stackedSource = session.view.stack.find((card) => card.name === cardName);
        // A cycling ability's source is already in the graveyard as its cost; a counterspell is not.
        if (
          cycling === undefined &&
          stackedSource !== undefined &&
          bot.graveyard.some((card) => card.oid === stackedSource.oid)
        )
          cycling = {
            oid: stackedSource.oid,
            library: bot.librarySize,
            hand: bot.handSize,
            turn: session.view.turn.number,
            step: session.view.turn.step,
            graveyard: bot.graveyard.map((card) => card.oid),
            battlefield: bot.battlefield.map((card) => card.oid),
          };
        const observedCycle = cycling;
        if (
          !cycled &&
          observedCycle !== undefined &&
          !session.view.stack.some((card) => card.oid === observedCycle.oid)
        ) {
          expect(session.view.turn.number).toBe(observedCycle.turn);
          expect(session.view.turn.step).toBe(observedCycle.step);
          expect(bot.librarySize).toBe(observedCycle.library - 1);
          // Forge may immediately cycle again before returning priority to the local pilot.
          const newDiscards = bot.graveyard.filter((card) => !observedCycle.graveyard.includes(card.oid));
          for (const card of newDiscards) {
            expect(card.name).toBe(cardName);
            expect(session.view.stack.some((source) => source.oid === card.oid)).toBe(true);
          }
          // The bot can also play its land before yielding priority after the draw.
          const newLands = bot.battlefield.filter((card) => !observedCycle.battlefield.includes(card.oid));
          expect(newLands.length).toBeLessThanOrEqual(1);
          for (const entry of newLands)
            expect(cardName === 'Desert of the Indomitable' ? [land, cardName] : [land]).toContain(
              entry.name,
            );
          expect(bot.handSize).toBe(observedCycle.hand + 1 - newDiscards.length - newLands.length);
          expect(bot.graveyard.some((card) => card.oid === observedCycle.oid)).toBe(true);
          cycled = true;
          break;
        }
        trace.push(
          `bot public: hand=${bot.handSize} library=${bot.librarySize} board=${bot.battlefield.map((card) => card.name).join(',')} grave=${bot.graveyard.map((card) => card.name).join(',')}`,
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} | ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) =>
              option.targets.some((target) => target.name === 'Adorned Pouncer'),
            )?.id ??
            decision.options.find((option) => option.targets.some((target) => target.name === 'Plains'))?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      expect(cycled, trace.slice(-20).join('\n')).toBe(true);
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
