/** Native land play/payment is inferred from public transitions, never bot choices. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const LAND = 'Desert of the Indomitable';
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
forgeIt(
  'Forge plays tapped Deserts, pays for Colossapede, and untaps the paid sources',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let previous: readonly { oid: string; tapped: boolean }[] = [];
    let births: Readonly<Record<string, number>> = {};
    let cast: { oid: string; turn: number; paid: readonly string[] } | undefined;
    let resolved = false;
    let untapped = false;
    let trace: readonly string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'lands', cards: [{ name: 'Plains', count: 60 }] },
          },
          {
            name: 'Desert pilot',
            controller: 'engine',
            deck: {
              name: 'Desert mana',
              cards: [
                { name: LAND, count: 30 },
                { name: 'Colossapede', count: 30 },
              ],
            },
          },
        ],
        seed: 'hou-desert-native-land-v1',
        maximumTurns: 24,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1500 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const pilot = session.view.seats[1];
        expect(pilot.hand).toBeNull();
        const lands = pilot.battlefield.filter((card) => card.name === LAND);
        const turn = session.view.turn.number;
        const added = lands.filter((card) => births[card.oid] === undefined);
        if (added.length > 0) {
          expect(added).toHaveLength(1);
          expect(Object.values(births)).not.toContain(turn);
          expect(session.view.turn.active).toBe(1);
          expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
          expect(session.view.stack).toHaveLength(0);
          expect(added[0]?.tapped).toBe(true);
          births = { ...births, [added[0]!.oid]: turn };
        }
        for (const prior of previous) expect(lands.some((card) => card.oid === prior.oid)).toBe(true);
        const spell = session.view.stack.find((card) => card.name === 'Colossapede');
        if (cast === undefined && spell !== undefined) {
          expect(spell.controller).toBe(1);
          expect(session.view.turn.active).toBe(1);
          expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
          const paid = lands.filter(
            (card) => card.tapped && previous.some((prior) => prior.oid === card.oid && !prior.tapped),
          );
          expect(paid).toHaveLength(5);
          for (const card of paid) expect(births[card.oid]).toBeLessThan(turn);
          expect(session.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          cast = { oid: spell.oid, turn, paid: paid.map((card) => card.oid) };
        }
        const creature = pilot.battlefield.find((card) => card.oid === cast?.oid);
        if (creature !== undefined) {
          expect(creature).toMatchObject({ name: 'Colossapede', controller: 1, power: 5, toughness: 5 });
          resolved = true;
        }
        if (cast !== undefined && turn > cast.turn && session.view.turn.active === 1) {
          const paid = cast.paid;
          expect(lands.filter((card) => paid.includes(card.oid))).toHaveLength(5);
          expect(lands.filter((card) => paid.includes(card.oid)).every((card) => !card.tapped)).toBe(true);
          expect(session.play?.manaPools?.[1]).toEqual(EMPTY_MANA);
          expect(resolved).toBe(true);
          untapped = true;
          break;
        }
        previous = lands.map((card) => ({ oid: card.oid, tapped: card.tapped }));
        trace = [
          ...trace.slice(-12),
          `${turn}/${session.view.turn.step} ${decision.kind} lands=${lands.length} stack=${session.view.stack.map((card) => card.name)}`,
        ];
        let move =
          decision.kind === 'priority'
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined;
        if (decision.kind === 'discard-selection')
          move =
            decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
            decision.options[0]?.id;
        move ??= decision.options.find(
          (option) =>
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect({ resolved, untapped }, trace.join('\n')).toEqual({ resolved: true, untapped: true });
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
