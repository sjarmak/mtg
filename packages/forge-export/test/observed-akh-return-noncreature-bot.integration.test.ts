/** Native Return can exile noncreatures; no creature ever enters either graveyard. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'Forge casts Return with only noncreature graveyard targets',
  async () => {
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        {
          name: 'Observer',
          controller: 'local',
          deck: {
            name: 'cleanup lands',
            cards: [{ name: 'Mountain', count: 60 }],
          },
        },
        {
          name: 'Native Return pilot',
          controller: 'engine',
          deck: {
            name: 'aftermath',
            cards: [
              { name: 'Swamp', count: 24 },
              { name: 'Never // Return', count: 36 },
            ],
          },
        },
      ],
      seed: 'akh-hou-return-native-noncreature-v1',
      maximumTurns: 48,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let priorGrave: readonly string[] = [];
    let cast: { oid: string; graves: readonly string[]; exiles: readonly string[] } | undefined;
    let resolved = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 2200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        const graves = session.view.seats.flatMap((seat) => seat.graveyard);
        const exiles = session.view.seats.flatMap((seat) => seat.exile);
        for (const card of graves) expect(card.typeLine).not.toContain('Creature');
        const spell = session.view.stack.find((card) => priorGrave.includes(card.oid));
        if (cast === undefined && spell !== undefined) {
          expect(spell.name).toMatch(/Never|Return/u);
          expect(spell.controller).toBe(1);
          expect(session.view.turn.active).toBe(1);
          expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
          expect(bot.battlefield.filter((card) => card.name === 'Swamp' && card.tapped)).toHaveLength(4);
          expect(bot.battlefield.some((card) => card.typeLine.includes('Creature'))).toBe(false);
          expect(graves.length).toBeGreaterThan(0);
          cast = {
            oid: spell.oid,
            graves: graves.map((card) => card.oid),
            exiles: exiles.map((card) => card.oid),
          };
        }
        const aftermath = cast;
        if (
          aftermath !== undefined &&
          bot.exile.some((card) => card.oid === aftermath.oid) &&
          session.view.stack.length === 0
        ) {
          const chosen = exiles.filter(
            (card) => card.oid !== aftermath.oid && !aftermath.exiles.includes(card.oid),
          );
          expect(chosen).toHaveLength(1);
          expect(chosen[0]?.typeLine).not.toContain('Creature');
          expect(aftermath.graves).toContain(chosen[0]?.oid);
          expect(new Set(graves.map((card) => card.oid))).toEqual(
            new Set(aftermath.graves.filter((oid) => oid !== chosen[0]?.oid)),
          );
          expect(graves.some((card) => card.oid === aftermath.oid)).toBe(false);
          const tokens = bot.battlefield.filter((card) => card.typeLine.includes('Zombie'));
          expect(tokens).toHaveLength(1);
          expect(tokens[0]).toMatchObject({
            power: 2,
            toughness: 2,
            controller: 1,
            characteristics: { colors: ['B'], manaCost: null, token: true },
          });
          expect(tokens[0]?.oid).not.toBe(aftermath.oid);
          expect(tokens[0]?.oid).not.toBe(chosen[0]?.oid);
          expect(session.view.seats.map((seat) => seat.life)).toEqual([20, 20]);
          resolved = true;
          break;
        }
        priorGrave = bot.graveyard.map((card) => card.oid);
        trace = [
          ...trace.slice(-15),
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind} graves=${graves.map((card) => card.name).join(',')} stack=${session.view.stack.map((card) => card.name).join(',')}`,
        ];
        // The observer never plays a land: cleanup supplies public noncreature targets.
        const move =
          decision.kind === 'discard-selection'
            ? (decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
              decision.options[0]?.id)
            : decision.options.find(
                (option) =>
                  ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
                  ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
              )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
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
