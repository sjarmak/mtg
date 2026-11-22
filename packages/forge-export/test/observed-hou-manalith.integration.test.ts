/** Manalith uses the existing printed permanent and priority-mana routes. */
import { expect, it } from 'vitest';
import type { ObservedSession } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

forgeIt.each(COLORS)(
  'Manalith produces exactly one %s, cannot tap twice, and untaps next turn',
  async (color) => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    let source: string | undefined;
    let activatedTurn: number | undefined;
    let castObserved = false;
    let emptied = false;
    let untapped = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open({
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Pilot',
            controller: 'local',
            deck: {
              name: 'Manalith',
              cards: [
                { name: 'Plains', count: 30 },
                { name: 'Manalith', count: 30 },
              ],
            },
          },
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'passive', cards: [{ name: 'Plains', count: 60 }] },
          },
        ],
        seed: `hou-manalith-${color}-v1`,
        maximumTurns: 16,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 700 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const pilot = session.view.seats[0];
        const artifact = pilot.battlefield.find((card) => card.oid === source);
        if (source !== undefined && session.view.stack.some((card) => card.oid === source)) {
          expect(pilot.battlefield.filter((card) => card.name === 'Plains' && card.tapped)).toHaveLength(3);
          castObserved = true;
        }
        trace.push(
          `${session.view.turn.number}/${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'priority' && decision.seat === 0) {
          if (source === undefined) {
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
            const cast = session.play?.objectActions.find(
              (action) =>
                action.category === 'cast' &&
                pilot.hand?.some((card) => card.oid === action.oid && card.name === 'Manalith'),
            );
            if (move === undefined && cast !== undefined) {
              source = cast.oid;
              move = cast.move;
            }
          } else if (artifact !== undefined) {
            expect(artifact).toMatchObject({
              name: 'Manalith',
              typeLine: 'Artifact',
              power: null,
              toughness: null,
            });
            const mana =
              session.play?.objectActions.filter(
                (action) => action.oid === source && action.category === 'mana',
              ) ?? [];
            if (activatedTurn === undefined) {
              expect(castObserved).toBe(true);
              expect(artifact.tapped).toBe(false);
              expect(mana.map((action) => action.manaOutput).sort()).toEqual([...COLORS].sort());
              const action = mana.find((candidate) => candidate.manaOutput === color);
              if (action === undefined) throw new Error(`Missing ${color} mana action`);
              activatedTurn = session.view.turn.number;
              const advanced = await session.submit(action.move);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              expect(session.view.stack).toEqual([]);
              expect(session.play?.manaPools?.[0]).toEqual({ ...EMPTY_MANA, [color]: 1 });
              expect(session.view.seats[0].battlefield.find((card) => card.oid === source)?.tapped).toBe(
                true,
              );
              expect(
                session.play?.objectActions.filter(
                  (candidate) => candidate.oid === source && candidate.category === 'mana',
                ),
              ).toEqual([]);
              continue;
            }
            if (session.play?.manaPools?.[0]?.[color] === 0) {
              expect(session.play.manaPools[0]).toEqual(EMPTY_MANA);
              emptied = true;
            }
            if (session.view.turn.number > activatedTurn && session.view.turn.active === 0) {
              expect(artifact.tapped).toBe(false);
              expect(mana.map((action) => action.manaOutput).sort()).toEqual([...COLORS].sort());
              untapped = true;
              break;
            }
            expect(artifact.tapped).toBe(true);
            expect(mana).toEqual([]);
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
            ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
            ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
        )?.id;
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect({ castObserved, emptied, untapped }, trace.slice(-12).join('\n')).toEqual({
        castObserved: true,
        emptied: true,
        untapped: true,
      });
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
