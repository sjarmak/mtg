/** Native Forge chooses Market and resolves it without exposing its hand. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Observer',
      controller: 'local',
      deck: {
        name: 'observer',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Defiant Khenra', count: 30 },
        ],
      },
    },
    {
      name: 'Native Market pilot',
      controller: 'engine',
      deck: {
        name: 'market',
        cards: [
          { name: 'Island', count: 15 },
          { name: 'Plains', count: 15 },
          { name: 'Farm // Market', count: 30 },
        ],
      },
    },
  ],
  seed: 'akh-hou-market-native-v1',
  maximumTurns: 32,
};

forgeIt(
  'Forge casts Market from its graveyard, draws and discards two, then exiles it',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let priorGraveyard: readonly string[] = [];
    let cast:
      | {
          oid: string;
          library: number;
          hand: number;
          lands: number;
          grave: readonly string[];
        }
      | undefined;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1400 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const spell = session.view.stack.find(
          (card) => priorGraveyard.includes(card.oid) && card.name.includes('Market'),
        );
        if (cast === undefined && spell !== undefined) {
          cast = {
            oid: spell.oid,
            library: bot.librarySize,
            hand: bot.handSize,
            lands: bot.battlefield.length,
            grave: bot.graveyard.map((card) => card.oid),
          };
        }
        const resolving = cast;
        if (resolving !== undefined && bot.exile.some((card) => card.oid === resolving.oid)) {
          expect(bot.librarySize).toBe(resolving.library - 2);
          expect(bot.handSize + bot.battlefield.length - resolving.lands).toBe(resolving.hand);
          const discarded = bot.graveyard.filter((card) => !resolving.grave.includes(card.oid));
          expect(discarded).toHaveLength(2);
          expect(new Set(discarded.map((card) => card.oid)).size).toBe(2);
          expect(bot.graveyard.some((card) => card.oid === resolving.oid)).toBe(false);
          resolved = true;
          break;
        }
        priorGraveyard = bot.graveyard.map((card) => card.oid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} library=${bot.librarySize} hand=${bot.handSize} grave=${bot.graveyard.map((card) => card.name).join(',')} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        );
        let move =
          decision.kind === 'priority'
            ? (decision.options.find((option) => option.text === 'Play Mountain')?.id ??
              decision.options.find((option) => option.text.startsWith('Defiant Khenra:'))?.id)
            : decision.kind === 'mana-payment'
              ? decision.options.find((option) => option.id.startsWith('mana-source-'))?.id
              : decision.kind === 'combat-attackers'
                ? decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id
                : undefined;
        move ??=
          decision.kind === 'discard-selection'
            ? (decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
              decision.options[0]?.id)
            : decision.options.find(
                (option) =>
                  ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
                  ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
              )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(resolved, trace.slice(-16).join('\n')).toBe(true);
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
