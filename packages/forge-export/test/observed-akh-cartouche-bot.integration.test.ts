/** Native Trial recycling is proved by public physical identity, never bot-hand inspection. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'Forge casts a Cartouche beside a Trial and recasts that same returned Trial',
  async () => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Observer',
          controller: 'local',
          deck: {
            name: 'observer',
            cards: [
              { name: 'Plains', count: 30 },
              { name: 'Sacred Cat', count: 30 },
            ],
          },
        },
        {
          name: 'Native pilot',
          controller: 'engine',
          deck: {
            name: 'trial',
            cards: [
              { name: 'Plains', count: 26 },
              { name: 'Sacred Cat', count: 14 },
              { name: 'Trial of Solidarity', count: 10 },
              { name: 'Cartouche of Solidarity', count: 10 },
            ],
          },
        },
      ],
      seed: 'akh-hou-cartouche-native-v1',
      maximumTurns: 32,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let interaction: { trial: string; aura: string; tokens: readonly string[] } | undefined;
    let returned = false;
    let recast = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const trial = bot.battlefield.find((card) => card.name === 'Trial of Solidarity');
        const aura = session.view.stack.find((card) => card.name === 'Cartouche of Solidarity');
        if (interaction === undefined && trial !== undefined && aura !== undefined)
          interaction = {
            trial: trial.oid,
            aura: aura.oid,
            tokens: bot.battlefield
              .filter((card) => card.typeLine.includes('Warrior'))
              .map((card) => card.oid),
          };
        if (interaction !== undefined) {
          const current = interaction;
          if (
            !bot.battlefield.some((card) => card.oid === current.trial) &&
            bot.battlefield.some((card) => card.oid === current.aura)
          ) {
            expect(bot.graveyard.some((card) => card.oid === current.trial)).toBe(false);
            expect(bot.exile.some((card) => card.oid === current.trial)).toBe(false);
            const tokens = bot.battlefield.filter(
              (card) => card.typeLine.includes('Warrior') && !current.tokens.includes(card.oid),
            );
            // Observe a gap with no Trial on the stack: its return trigger is not a recast.
            if (tokens.length === 1 && !session.view.stack.some((card) => card.oid === current.trial))
              returned = true;
          }
          if (
            returned &&
            !bot.battlefield.some((card) => card.oid === current.trial) &&
            session.view.stack.some(
              (card) => card.oid === current.trial && card.name === 'Trial of Solidarity',
            )
          ) {
            recast = true;
            break;
          }
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} board=${bot.battlefield.map((card) => `${card.oid}:${card.name}`).join(',')} stack=${session.view.stack.map((card) => `${card.oid}:${card.name}`).join(',')}`,
        );
        let move =
          decision.kind === 'priority'
            ? (decision.options.find((option) => option.text === 'Play Plains')?.id ??
              decision.options.find((option) => option.text.startsWith('Sacred Cat: Sacred Cat - Creature'))
                ?.id)
            : decision.kind === 'mana-payment'
              ? decision.options.find((option) => option.id.startsWith('mana-source-'))?.id
              : decision.kind === 'combat-blockers'
                ? decision.options.find((option) => option.id.startsWith('combat-block-add-'))?.id
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
      expect(returned, trace.slice(-15).join('\n')).toBe(true);
      expect(recast, trace.slice(-15).join('\n')).toBe(true);
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
