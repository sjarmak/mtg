import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { MOMIR_RULES } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

const cards = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name) => ({ name, count: 12 }));

function momirTable(
  controllers: readonly ['local' | 'engine', 'local' | 'engine'],
  seed: string,
): SessionSpec {
  return {
    content: { kind: 'printed', format: 'momir-basic' },
    seats: [
      { name: 'Pilot 0', controller: controllers[0], deck: { name: 'momir-0', cards } },
      { name: 'Pilot 1', controller: controllers[1], deck: { name: 'momir-1', cards } },
    ],
    seed,
    maximumTurns: 10,
    rules: MOMIR_RULES,
  };
}

const momir = momirTable(['local', 'local'], 'momir-probe');

forgeIt(
  'opens Momir Basic, pays variable X and discard, creates a random creature, and finishes',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    try {
      expect(await backend.supports(momir)).toEqual([]);
      const opened = await backend.open(momir);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.view.seats.map((seat) => seat.life)).toEqual([24, 24]);
      expect(session.view.seats.map((seat) => seat.avatars?.map((avatar) => avatar.name))).toEqual([
        ['Momir Vig, Simic Visionary Avatar'],
        ['Momir Vig, Simic Visionary Avatar'],
      ]);
      let sawVariableX = false;
      let sawDiscard = false;
      const decisionKinds = new Set<string>();
      let created: string | undefined;
      for (let step = 0; step < 40 && session.status !== 'finished'; step += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Momir witness stopped without a decision');
        decisionKinds.add(decision.kind);
        let move = decision.options[0]?.id;
        if (decision.kind === 'mulligan') move = 'pregame-keep';
        if (decision.kind === 'number') {
          move = decision.options.find((option) => option.id === 'number-1')?.id;
          sawVariableX = move !== undefined;
        }
        if (decision.kind === 'cost-discard-selection') {
          move = decision.options.find((option) => option.id !== 'cost-discard-cancel')?.id;
          sawDiscard = move !== undefined;
        }
        const play = session.play;
        const land = play?.objectActions.find((action) => action.category === 'play');
        const avatar = play?.objectActions.find(
          (action) =>
            action.category === 'ability' &&
            session?.view.seats[decision.seat]?.avatars?.some((entry) => entry.oid === action.oid) === true,
        );
        if (!sawVariableX && land !== undefined) move = land.move;
        else if (!sawVariableX && avatar !== undefined) move = avatar.move;
        else if (play?.passPriority !== null && play?.passPriority !== undefined) move = play.passPriority;
        created = session.view.seats
          .flatMap((seat) => seat.battlefield)
          .find((object) => !object.typeLine.startsWith('Basic Land'))?.name;
        if (created !== undefined)
          move = decision.options.find((option) => option.id === 'concede')?.id ?? move;
        if (move === undefined) throw new Error(`Momir witness cannot answer ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(sawVariableX).toBe(true);
      expect(sawDiscard).toBe(true);
      expect([...decisionKinds]).toEqual(expect.arrayContaining(['starting-player', 'mulligan', 'priority']));
      expect(created).toBe('Ravenous Squirrel');
      expect(session.status).toBe('finished');
      expect(session.result).not.toBeNull();
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  120_000,
);

forgeIt(
  'runs Momir Basic starting choice, mulligan and priority for an engine-controlled seat',
  async () => {
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    try {
      for (let attempt = 0; attempt < 16 && session === undefined; attempt += 1) {
        const opened = await backend.open(momirTable(['engine', 'local'], `momir-engine-${String(attempt)}`));
        if (!opened.ok) throw new Error(opened.error.message);
        if (opened.session.decision?.kind === 'mulligan' && opened.session.decision.seat === 1) {
          session = opened.session;
        } else {
          await opened.session.close();
        }
      }
      if (session === undefined) throw new Error('No seed gave the engine seat the starting choice');
      const kept = await session.submit('pregame-keep');
      if (!kept.ok) throw new Error(kept.error.message);
      session = kept.session;
      expect(session.decision).toMatchObject({ kind: 'priority', seat: 1 });
      expect(session.view.turn.active).toBe(0);
      let created: string | undefined;
      for (let step = 0; step < 200 && session.status === 'awaiting'; step += 1) {
        created = session.view.seats[0].battlefield.find(
          (object) => !object.typeLine.startsWith('Basic Land'),
        )?.name;
        if (created !== undefined) break;
        expect(session.decision?.seat).toBe(1);
        const move =
          session.play?.automatic?.move ??
          session.play?.passPriority ??
          session.play?.objectActions.find((action) => action.category === 'play')?.move ??
          session.decision?.options[0]?.id;
        if (move === null || move === undefined)
          throw new Error(`Local observer cannot answer ${session.decision?.kind ?? 'missing decision'}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
      }
      expect(created).toBeDefined();
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  },
  180_000,
);
