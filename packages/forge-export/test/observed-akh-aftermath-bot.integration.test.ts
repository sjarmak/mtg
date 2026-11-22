/** Native Forge policy must choose aftermath without revealing its hand. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local defender',
      controller: 'local',
      deck: {
        name: 'defender',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Ahn-Crop Crasher', count: 20 },
          { name: 'Sweltering Suns', count: 10 },
        ],
      },
    },
    {
      name: 'Forge aftermath pilot',
      controller: 'engine',
      deck: {
        name: 'aftermath',
        cards: [
          { name: 'Plains', count: 18 },
          { name: 'Mountain', count: 12 },
          // A vanilla target isolates recovery from Embalm/Eternalize choices.
          { name: 'Defiant Khenra', count: 18 },
          { name: 'Dusk // Dawn', count: 12 },
        ],
      },
    },
  ],
  seed: 'akh-hou-aftermath-engine-v1',
  maximumTurns: 32,
};

forgeIt(
  'Forge AI casts aftermath from the graveyard and recovers creatures',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let priorGraveyard: readonly string[] = [];
    let aftermath: { oid: string; creatures: readonly string[]; hand: number } | undefined;
    let resolved = false;
    const trace: string[] = [];
    const transitions: string[] = [];
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
        const publicState = `lands=${bot.battlefield.filter((card) => card.name === 'Plains').length} stack=${session.view.stack.map((card) => `${card.name}:${card.oid}`).join(',')} grave=${bot.graveyard.map((card) => `${card.name}:${card.oid}`).join(',')} exile=${bot.exile.map((card) => `${card.name}:${card.oid}`).join(',')}`;
        if (transitions.at(-1) !== publicState) transitions.push(publicState);
        const spell = session.view.stack.find(
          (card) => priorGraveyard.includes(card.oid) && card.name.includes('Dawn'),
        );
        if (aftermath === undefined && spell !== undefined) {
          const creatures = bot.graveyard
            .filter((card) => card.name === 'Defiant Khenra')
            .map((card) => card.oid);
          expect(creatures.length).toBeGreaterThan(0);
          aftermath = { oid: spell.oid, creatures, hand: bot.handSize };
        }
        const recovery = aftermath;
        if (recovery !== undefined && bot.exile.some((card) => card.oid === recovery.oid)) {
          expect(bot.graveyard.some((card) => recovery.creatures.includes(card.oid))).toBe(false);
          // Forge can immediately recast a recovered creature before yielding priority.
          const recast = session.view.stack.filter((card) => recovery.creatures.includes(card.oid)).length;
          expect(bot.handSize + recast).toBe(recovery.hand + recovery.creatures.length);
          resolved = true;
          break;
        }
        priorGraveyard = bot.graveyard.map((card) => card.oid);
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} stack=${session.view.stack.map((card) => card.name).join(',')} grave=${bot.graveyard.map((card) => card.name).join(',')} ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
          if (
            bot.battlefield.some((card) => card.name === 'Defiant Khenra') &&
            bot.graveyard.some((card) => card.name.includes('Dusk'))
          ) {
            move ??= decision.options.find((option) =>
              option.text.includes('deals 3 damage to each creature'),
            )?.id;
          }
          if (
            session.view.seats[0].battlefield.filter((card) => card.name === 'Ahn-Crop Crasher').length < 2
          ) {
            move ??= decision.options.find((option) => option.text.startsWith('Ahn-Crop Crasher:'))?.id;
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id.startsWith('combat-block-add-'))?.id;
        } else if (decision.kind === 'combat-exert') {
          move = decision.options.find((option) => option.text === 'Choose none')?.id;
        } else if (decision.kind === 'discard-selection') {
          move = decision.options[0]?.id;
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
      expect(resolved, transitions.concat(trace.slice(-5)).join('\n')).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);
