/** One exact passive creature exercises the closed priority/combat controller surface. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const SOURCE = 'Ancient Crab';
const emptySeat = { life: 20, hand: [], library: Array<string>(20).fill('Island'), graveyard: [] };

for (const controller of ['local', 'engine'] as const) {
  forgeIt(
    `Ancient Crab ${controller} controller profile`,
    async () => {
      const sourceSeat = controller === 'local' ? 0 : 1;
      const state = {
        schemaVersion: 1 as const,
        active: sourceSeat,
        phase: 'MAIN1' as const,
        seats: [
          { ...emptySeat, battlefield: sourceSeat === 0 ? [SOURCE] : [] },
          {
            ...emptySeat,
            battlefield: sourceSeat === 1 ? [SOURCE, ...Array<string>(4).fill('Grizzly Bears')] : [],
          },
        ] as const,
      };
      const backend = await snapshotForgeScenarioBackend(state, { timeoutMs: 180_000 });
      if (backend === null) throw new Error('Required installed Forge is absent');
      const table: SessionSpec = {
        content: { kind: 'printed', format: 'akh-hou' },
        seats: [
          {
            name: 'Local',
            controller: 'local',
            deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
          },
          {
            name: 'Native',
            controller: controller === 'engine' ? 'engine' : 'local',
            deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
          },
        ],
        seed: `ancient-crab-${controller}-controller-profile-v1`,
        maximumTurns: 4,
      };
      let session: ObservedSession | undefined;
      let sawPriority = false;
      let sawAttack = false;
      let staged = false;
      const defendingSeat = sourceSeat === 0 ? 1 : 0;
      const initialLife = state.seats[defendingSeat].life;
      let trace: readonly string[] = [];
      try {
        const opened = await backend.open(table);
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        const sourceOid = session.view.seats[sourceSeat].battlefield.find(
          (card) => card.name === SOURCE,
        )?.oid;
        expect(sourceOid).toBeDefined();
        for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing decision');
          const source = session.view.seats[sourceSeat].battlefield.find((card) => card.oid === sourceOid);
          expect(source).toMatchObject({ name: SOURCE, power: 1, toughness: 5 });
          if (source?.attacking) sawAttack = true;
          if (decision.kind === 'priority') sawPriority = true;
          if (sawAttack && session.view.turn.active === sourceSeat && session.view.turn.step === 'MAIN2') {
            expect(session.view.seats[defendingSeat].life).toBeLessThan(initialLife);
            break;
          }
          trace = [
            ...trace.slice(-19),
            `${session.view.turn.number}/${session.view.turn.step} ${decision.seat}/${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
          ];
          let move: string | undefined;
          if (decision.kind === 'combat-attackers' && decision.seat === sourceSeat) {
            if (controller === 'local' && !staged) {
              move = decision.options.find(
                (option) =>
                  option.id.startsWith('combat-attack-add-') &&
                  option.targets.some((target) => target.oid === sourceOid),
              )?.id;
              staged = move !== undefined;
            }
            move ??= decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
          } else if (decision.kind === 'combat-blockers') {
            move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
          } else if (decision.kind === 'priority') {
            move = decision.options.find((option) => option.text === 'Pass priority')?.id;
          }
          if (move === undefined)
            throw new Error(`Unhandled controller-profile decision\n${trace.join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
          session = advanced.session;
        }
        expect({ sawPriority, sawAttack }, trace.join('\n')).toEqual({
          sawPriority: true,
          sawAttack: true,
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
