/** Native cast payment is witnessed through public zones, never the bot's hand. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const SUNS = 'Sweltering Suns';
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

forgeIt(
  'Forge pays three distinct lands including two Mountains to cast Sweltering Suns without drawing',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let previous: ObservedSession | undefined;
    let cast:
      | {
          readonly oid: string;
          readonly hand: number;
          readonly library: number;
          readonly turn: number;
          readonly step: string;
          readonly sources: readonly string[];
          readonly board: readonly string[];
          readonly graveyard: readonly string[];
        }
      | undefined;
    let completed = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Damage controls',
            controller: 'local',
            deck: {
              name: 'damage controls',
              cards: [
                { name: 'Mountain', count: 20 },
                { name: 'Forest', count: 10 },
                { name: 'Hyena Pack', count: 10 },
                { name: 'Harrier Naga', count: 10 },
                { name: 'Defiant Khenra', count: 10 },
              ],
            },
          },
          {
            name: 'Native Suns pilot',
            controller: 'engine',
            deck: {
              name: 'colored cast payment',
              cards: [
                { name: 'Mountain', count: 30 },
                { name: SUNS, count: 30 },
              ],
            },
          },
        ],
        seed: 'akh-suns-native-damage-v1',
        maximumTurns: 48,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        expect(bot.battlefield.every((card) => card.name === 'Mountain')).toBe(true);
        const spell = session.view.stack.find(
          (card) => card.name === SUNS && !bot.graveyard.some((entry) => entry.oid === card.oid),
        );
        if (cast === undefined && spell !== undefined) {
          if (previous === undefined) throw new Error('Missing pre-cast public snapshot');
          const before = previous.view.seats[1];
          expect(previous.view.turn.number).toBe(session.view.turn.number);
          // Draw-step priority is after the draw; Forge may cast before yielding in MAIN1.
          expect(['DRAW/MAIN1', 'MAIN1/MAIN1', 'MAIN2/MAIN2']).toContain(
            `${previous.view.turn.step}/${session.view.turn.step}`,
          );
          expect(previous.view.turn.active).toBe(1);
          expect(session.view.turn.active).toBe(1);
          expect(previous.view.stack).toHaveLength(0);
          expect(previous.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          expect(session.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          expect(session.view.stack).toHaveLength(1);
          expect(spell.controller).toBe(1);
          const newLands = bot.battlefield.filter(
            (card) => !before.battlefield.some((old) => old.oid === card.oid),
          );
          expect(newLands.length).toBeLessThanOrEqual(1);
          const tapped = bot.battlefield.filter(
            (card) => card.tapped && !before.battlefield.some((old) => old.oid === card.oid && old.tapped),
          );
          expect(tapped).toHaveLength(3);
          expect(new Set(tapped.map((card) => card.oid)).size).toBe(3);
          expect(tapped.filter((card) => card.name === 'Mountain').length).toBeGreaterThanOrEqual(2);
          expect(bot.graveyard).toEqual(before.graveyard);
          expect(bot.librarySize).toBe(before.librarySize);
          expect(bot.handSize).toBe(before.handSize - 1 - newLands.length);
          cast = {
            oid: spell.oid,
            hand: bot.handSize,
            library: bot.librarySize,
            turn: session.view.turn.number,
            step: session.view.turn.step,
            sources: tapped.map((card) => card.oid),
            board: bot.battlefield.map((card) => card.oid),
            graveyard: bot.graveyard.map((card) => card.oid),
          };
        }
        const resolving = cast;
        if (resolving !== undefined && bot.graveyard.some((card) => card.oid === resolving.oid)) {
          expect(session.view.turn.number).toBe(resolving.turn);
          expect(session.view.turn.step).toBe(resolving.step);
          expect(session.view.stack).toHaveLength(0);
          expect(bot.librarySize).toBe(resolving.library);
          const newLands = bot.battlefield.filter((card) => !resolving.board.includes(card.oid));
          expect(newLands.length).toBeLessThanOrEqual(1);
          expect(bot.handSize).toBe(resolving.hand - newLands.length);
          expect(bot.graveyard.map((card) => card.oid).sort()).toEqual(
            [...resolving.graveyard, resolving.oid].sort(),
          );
          expect(bot.exile.some((card) => card.oid === resolving.oid)).toBe(false);
          expect(
            resolving.sources.every((oid) => bot.battlefield.some((card) => card.oid === oid && card.tapped)),
          ).toBe(true);
          expect(session.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          completed = true;
          break;
        }
        trace = [
          ...trace.slice(-12),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        ];
        let move: string | undefined;
        if (decision.kind === 'priority' && cast === undefined) {
          move = decision.options.find((option) =>
            ['Play Mountain', 'Play Forest'].includes(option.text),
          )?.id;
          const established = session.view.seats[0].battlefield.some((card) => card.name === 'Hyena Pack');
          for (const name of established ? ['Harrier Naga', 'Defiant Khenra'] : ['Hyena Pack'])
            move ??= decision.options.find((option) => option.text.startsWith(`${name}:`))?.id;
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
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
        previous = session;
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(completed, trace.join('\n')).toBe(true);
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
