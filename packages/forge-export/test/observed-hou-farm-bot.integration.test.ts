/** Native Farm removal observed without exposing the bot hand or decisions. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    {
      name: 'Attackers',
      controller: 'local',
      deck: {
        name: 'attackers',
        cards: [
          { name: 'Mountain', count: 30 },
          { name: 'Defiant Khenra', count: 30 },
        ],
      },
    },
    {
      name: 'Native Farm pilot',
      controller: 'engine',
      deck: {
        name: 'farm',
        cards: [
          { name: 'Plains', count: 30 },
          { name: 'Farm // Market', count: 30 },
        ],
      },
    },
  ],
  seed: 'hou-farm-native-v1',
  maximumTurns: 32,
};

forgeIt(
  'Forge casts Farm during combat and destroys one attacker while preserving other copies',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let attackers: readonly string[] = [];
    let attackTurn: number | undefined;
    let cast: { oid: string; creatures: readonly string[]; life: number } | undefined;
    let resolved = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1600 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[0];
        const bot = session.view.seats[1];
        if (attackTurn !== session.view.turn.number) {
          attackers = [];
          attackTurn = session.view.turn.number;
        }
        expect(bot.hand).toBeNull();
        const spell = session.view.stack.find((card) => card.name.includes('Farm'));
        if (cast === undefined && spell !== undefined) {
          expect(spell.controller).toBe(1);
          expect(attackers.length).toBeGreaterThanOrEqual(2);
          expect(session.view.turn.active).toBe(0);
          cast = {
            oid: spell.oid,
            creatures: pilot.battlefield
              .filter((card) => card.name === 'Defiant Khenra')
              .map((card) => card.oid),
            life: bot.life,
          };
        }
        const resolving = cast;
        if (resolving !== undefined && bot.graveyard.some((card) => card.oid === resolving.oid)) {
          const destroyed = pilot.graveyard.filter((card) => resolving.creatures.includes(card.oid));
          expect(destroyed).toHaveLength(1);
          expect(attackers).toContain(destroyed[0]!.oid);
          const survivors = resolving.creatures.filter((oid) => oid !== destroyed[0]!.oid);
          expect(survivors.length).toBeGreaterThanOrEqual(1);
          for (const oid of survivors) expect(pilot.battlefield.some((card) => card.oid === oid)).toBe(true);
          expect(pilot.battlefield.some((card) => card.oid === destroyed[0]!.oid)).toBe(false);
          expect(bot.exile.some((card) => card.oid === resolving.oid)).toBe(false);
          expect(bot.life).toBe(resolving.life);
          resolved = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text === 'Play Mountain')?.id;
          if (pilot.battlefield.filter((card) => card.name === 'Defiant Khenra').length < 3)
            move ??= decision.options.find((option) => option.text.startsWith('Defiant Khenra:'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (
          decision.kind === 'combat-attackers' &&
          pilot.battlefield.filter((card) => card.name === 'Defiant Khenra').length >= 3
        ) {
          const attack = decision.options.find((option) => option.id.startsWith('combat-attack-add-'));
          move = attack?.id;
          if (attack?.targets[0] !== undefined) attackers = [...attackers, attack.targets[0].oid];
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
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
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
