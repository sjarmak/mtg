/** Native Afflict and blocked combat, including the separate lifelink gain. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Local blocker',
      controller: 'local',
      deck: {
        name: 'sacred-cat',
        cards: [
          { name: 'Plains', count: 20 },
          { name: 'Sacred Cat', count: 20 },
        ],
      },
    },
    {
      name: 'Forge afflict pilot',
      controller: 'engine',
      deck: {
        name: 'khenra-eternal',
        cards: [
          { name: 'Swamp', count: 20 },
          { name: 'Khenra Eternal', count: 20 },
        ],
      },
    },
  ],
  seed: 'hou-afflict-engine-v1',
  maximumTurns: 20,
};

forgeIt(
  'Forge Khenra kills its Cat blocker after Afflict and survives with one damage',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let blockedSource: string | undefined;
    let blocker: string | undefined;
    let lifeBeforeBlock: number | undefined;
    let blockTurn: number | undefined;
    let completedCombat = false;
    let sawTrigger = false;
    let resolvedBeforeDamage = false;
    let trace: readonly string[] = [];
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1000 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const local = session.view.seats[0];
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        if (blockedSource !== undefined) {
          const triggers = session.view.stack.filter((card) => card.oid === blockedSource);
          if (triggers.length > 0) {
            expect(triggers).toHaveLength(1);
            expect(local.life).toBe(lifeBeforeBlock);
            expect(bot.battlefield.find((card) => card.oid === blockedSource)?.attacking).toBe(true);
            sawTrigger = true;
          } else if (sawTrigger && !resolvedBeforeDamage) {
            expect(lifeBeforeBlock).toBeDefined();
            expect(local.life).toBe(lifeBeforeBlock! - 1);
            expect(local.battlefield.find((card) => card.oid === blocker)).toMatchObject({
              name: 'Sacred Cat',
              toughness: 1,
            });
            expect(bot.battlefield.find((card) => card.oid === blockedSource)).toMatchObject({
              name: 'Khenra Eternal',
              toughness: 2,
            });
            resolvedBeforeDamage = true;
          }
        }
        if (
          resolvedBeforeDamage &&
          session.view.turn.number === blockTurn &&
          session.view.turn.step === 'MAIN2'
        ) {
          expect(local.graveyard.some((card) => card.oid === blocker)).toBe(true);
          expect(local.battlefield.some((card) => card.oid === blocker)).toBe(false);
          expect(bot.battlefield.find((card) => card.oid === blockedSource)).toMatchObject({
            name: 'Khenra Eternal',
            power: 2,
            toughness: 2,
            damage: 1,
            tapped: true,
          });
          expect(bot.graveyard.some((card) => card.oid === blockedSource)).toBe(false);
          expect(local.life).toBe(lifeBeforeBlock);
          completedCombat = true;
          break;
        }
        trace = [
          ...trace.slice(-19),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
        ];
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (move === undefined && !local.battlefield.some((card) => card.name === 'Sacred Cat'))
            move = decision.options.find(
              (option) => option.text.startsWith('Sacred Cat:') && !option.text.includes('Embalm'),
            )?.id;
          move ??= decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'combat-blockers' && blockedSource === undefined) {
          const block = decision.options.find(
            (option) =>
              option.id.startsWith('combat-block-add-') &&
              option.targets.some((card) => card.name === 'Khenra Eternal'),
          );
          if (block !== undefined) {
            blockedSource = block.targets.find((card) => card.name === 'Khenra Eternal')?.oid;
            blocker = block.targets.find((card) => card.name === 'Sacred Cat')?.oid;
            expect(blockedSource).toBeDefined();
            expect(blocker).toBeDefined();
            lifeBeforeBlock = local.life;
            blockTurn = session.view.turn.number;
            expect(bot.battlefield.filter((card) => card.attacking)).toHaveLength(1);
            move = block.id;
          }
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'discard-selection') {
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
        }
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }
      expect(resolvedBeforeDamage, trace.join('\n')).toBe(true);
      expect(completedCombat, trace.join('\n')).toBe(true);
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
