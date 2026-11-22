/** AKH/HOU basic-land behavior through local decisions; no native-bot claim. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const EMPTY_MANA = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

for (const [land, color] of [
  ['Plains', 'W'],
  ['Island', 'U'],
  ['Swamp', 'B'],
  ['Mountain', 'R'],
  ['Forest', 'G'],
] as const) {
  forgeIt(
    `${land} plays once in its own main phase, produces only ${color}, and untaps next turn`,
    async () => {
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Land pilot',
            controller: 'local',
            deck: { name: land, cards: [{ name: land, count: 60 }] },
          },
          {
            name: 'Observer',
            controller: 'local',
            deck: { name: 'passive', cards: [{ name: 'Plains', count: 60 }] },
          },
        ],
        seed: `akh-hou-basic-${color}-v1`,
        maximumTurns: 8,
      };
      const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      let source: string | undefined;
      let activatedTurn: number | undefined;
      let manaEmptied = false;
      let untapped = false;
      const trace: string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 300 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          trace.push(`${session.view.turn.number}/${session.view.turn.step} ${decision.kind}`);
          const pilot = session.view.seats[0];
          let move: string | undefined;
          if (decision.kind === 'priority' && decision.seat === 1)
            move = decision.options.find((option) => option.text === 'Play Plains')?.id;
          if (decision.kind === 'priority' && decision.seat === 0) {
            const actions = session.play?.objectActions;
            if (actions === undefined) throw new Error('Missing local object actions');
            if (source === undefined) {
              const play = actions.find((action) => action.category === 'play');
              if (play !== undefined) {
                expect(session.view.turn.active).toBe(0);
                expect(['MAIN1', 'MAIN2']).toContain(session.view.turn.step);
                expect(session.view.stack).toEqual([]);
                source = play.oid;
                expect(pilot.hand?.find((card) => card.oid === source)?.name).toBe(land);
                move = play.move;
              }
            } else if (activatedTurn === undefined) {
              expect(pilot.hand?.some((card) => card.oid === source)).toBe(false);
              expect(pilot.battlefield).toHaveLength(1);
              expect(pilot.battlefield[0]).toMatchObject({ oid: source, name: land, tapped: false });
              expect(actions.filter((action) => action.category === 'play')).toEqual([]);
              const mana = actions.filter((action) => action.oid === source && action.category === 'mana');
              expect(mana.map((action) => action.manaOutput)).toEqual([color]);
              move = mana[0]!.move;
              activatedTurn = session.view.turn.number;
              const advanced = await session.submit(move);
              if (!advanced.ok) throw new Error(advanced.error.message);
              session = advanced.session;
              expect(session.view.seats[0].battlefield[0]).toMatchObject({ oid: source, tapped: true });
              expect(session.play?.manaPools?.[0]).toEqual({ ...EMPTY_MANA, [color]: 1 });
              expect(session.play?.objectActions.filter((action) => action.category === 'mana')).toEqual([]);
              continue;
            } else {
              const card = pilot.battlefield.find((entry) => entry.oid === source);
              expect(card).toBeDefined();
              if (session.play?.manaPools?.[0]?.[color] === 0) {
                expect(session.play.manaPools[0]).toEqual(EMPTY_MANA);
                manaEmptied = true;
              }
              if (session.view.turn.number === activatedTurn || session.view.turn.active === 1)
                expect(card?.tapped).toBe(true);
              if (session.view.turn.number > activatedTurn && session.view.turn.active === 0) {
                expect(card?.tapped).toBe(false);
                expect(
                  actions
                    .filter((action) => action.oid === source && action.category === 'mana')
                    .map((action) => action.manaOutput),
                ).toEqual([color]);
                untapped = true;
                break;
              }
            }
          }
          move ??= decision.options.find(
            (option) =>
              ['Play first', 'Keep this hand', 'Pass priority'].includes(option.text) ||
              ['combat-attackers-commit', 'combat-blockers-commit'].includes(option.id),
          )?.id;
          if (move === undefined)
            throw new Error(`Unhandled basic-land decision: ${JSON.stringify(decision)}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
        }
        expect({ manaEmptied, untapped }, trace.slice(-12).join('\n')).toEqual({
          manaEmptied: true,
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
}
