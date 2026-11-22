/** Native colored payment is proven by exclusive sources, not by reading bot hands. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const CASES = [
  { color: 'W', land: 'Island', spell: 'Those Who Serve', pips: 1, power: 2, toughness: 4 },
  { color: 'U', land: 'Plains', spell: 'Ancient Crab', pips: 2, power: 1, toughness: 5 },
  { color: 'B', land: 'Plains', spell: 'Dune Beetle', pips: 1, power: 1, toughness: 4 },
  { color: 'R', land: 'Plains', spell: 'Defiant Khenra', pips: 1, power: 2, toughness: 2 },
  { color: 'G', land: 'Plains', spell: 'Colossapede', pips: 1, power: 5, toughness: 5 },
] as const;

forgeIt.each(CASES)(
  'Forge uses Manalith as its only $color source to cast $spell',
  async ({ color, land, spell, pips, power, toughness }) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let casting: { oid: string; sources: readonly string[] } | undefined;
    let resolved = false;
    const trace: string[] = [];
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
            name: 'Native pilot',
            controller: 'engine',
            deck: {
              name: `Manalith ${color}`,
              cards: [
                { name: land, count: 24 },
                { name: 'Manalith', count: 18 },
                { name: spell, count: 18 },
              ],
            },
          },
        ],
        seed: `hou-manalith-native-${color}-v1`,
        maximumTurns: 32,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[1];
        expect(pilot.hand).toBeNull();
        const artifacts = pilot.battlefield.filter((card) => card.name === 'Manalith');
        const cast = session.view.stack.find((card) => card.name === spell && card.controller === 1);
        if (casting === undefined && cast !== undefined) {
          expect(pilot.battlefield.every((card) => [land, 'Manalith'].includes(card.name))).toBe(true);
          const tapped = artifacts.filter((card) => card.tapped);
          expect(tapped.length).toBeGreaterThanOrEqual(pips);
          expect(artifacts.every((card) => card.typeLine === 'Artifact')).toBe(true);
          expect(pilot.battlefield.some((card) => card.name === spell)).toBe(false);
          casting = { oid: cast.oid, sources: tapped.map((card) => card.oid) };
        }
        if (casting !== undefined) {
          const entry = pilot.battlefield.find((card) => card.oid === casting?.oid);
          if (entry !== undefined) {
            expect(entry).toMatchObject({ name: spell, controller: 1, power, toughness, tapped: false });
            expect(session.view.stack.some((card) => card.oid === entry.oid)).toBe(false);
            expect(
              casting.sources.every((oid) => artifacts.some((card) => card.oid === oid && card.tapped)),
            ).toBe(true);
            expect(session.play?.manaPools?.[1]).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
            resolved = true;
            break;
          }
        }
        trace.push(
          `${session.view.turn.number}/${decision.kind}: ${JSON.stringify({ stack: session.view.stack.map((card) => card.name), board: pilot.battlefield.map((card) => `${card.name}:${card.tapped}`) })}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority')
          move = decision.options.find((option) => option.text === 'Play Plains')?.id;
        else if (decision.kind === 'discard-selection')
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
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
      expect(casting, trace.slice(-12).join('\n')).toBeDefined();
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
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
