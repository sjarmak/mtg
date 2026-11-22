/** Installed-Forge regressions for the two Cube campaign mana-payment failures. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const emptySeat = {
  life: 20,
  hand: [],
  library: Array<string>(20).fill('Plains'),
  battlefield: [],
  graveyard: [],
};

function table(seed: string): SessionSpec {
  const deck = {
    name: 'mana-payment-regression',
    cards: [
      { name: 'Wall of Blossoms', count: 20 },
      { name: 'Tropical Island', count: 10 },
      { name: 'Lavaclaw Reaches', count: 10 },
      { name: 'Taiga', count: 10 },
      { name: 'Island', count: 10 },
    ],
  };
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'Local', controller: 'local', deck },
      { name: 'Opponent', controller: 'local', deck },
    ],
    seed,
    maximumTurns: 2,
  };
}

function optionSource(session: ObservedSession, move: string): string | undefined {
  return session.decision?.options.find((option) => option.id === move)?.targets[0]?.name;
}

function manaOutput(session: ObservedSession, move: string): string | undefined {
  return session.play?.objectActions.find((action) => action.move === move)?.manaOutput;
}

async function reachCast(start: ObservedSession): Promise<{
  readonly session: ObservedSession;
  readonly move: string;
}> {
  let session = start;
  const trace: string[] = [];
  for (let submitted = 0; submitted < 12; submitted += 1) {
    const wallOid = session.view.seats[0].hand?.find((card) => card.name === 'Wall of Blossoms')?.oid;
    const cast = session.play?.objectActions.find(
      (action) => action.category === 'cast' && action.oid === wallOid,
    );
    if (cast !== undefined) return { session, move: cast.move };
    const move =
      session.decision?.options.find(
        (option) => option.text === 'Play first' || option.text === 'Keep this hand',
      )?.id ?? session.play?.passPriority;
    trace.push(
      `${session.decision?.kind ?? 'none'}: ${session.decision?.options.map((option) => option.text).join(' | ') ?? 'none'}`,
    );
    if (move === null || move === undefined)
      throw new Error(`Forge offered no route to Wall of Blossoms: ${trace.join(' -> ')}`);
    const advanced = await session.submit(move);
    if (!advanced.ok) throw new Error(advanced.error.message);
    session = advanced.session;
  }
  throw new Error(`Forge did not reach Wall of Blossoms: ${trace.join(' -> ')}`);
}

for (const fixture of [
  {
    label: 'Tropical Island plus Lavaclaw Reaches',
    flexible: 'Tropical Island',
    generic: 'Lavaclaw Reaches',
  },
  { label: 'Taiga plus Island', flexible: 'Taiga', generic: 'Island' },
] as const) {
  forgeIt(
    `preserves green while casting Wall of Blossoms with ${fixture.label}`,
    async () => {
      const backend = await snapshotForgeScenarioBackend(
        {
          schemaVersion: 1,
          active: 0,
          phase: 'MAIN1',
          seats: [
            {
              ...emptySeat,
              hand: ['Wall of Blossoms'],
              battlefield: [fixture.flexible, fixture.generic],
            },
            emptySeat,
          ],
        },
        { timeoutMs: 180_000 },
      );
      if (backend === null) throw new Error('Required installed Forge is absent');
      let session: ObservedSession | undefined;
      try {
        const opened = await backend.open(table(`mana-payment-${fixture.generic}`));
        if (!opened.ok) throw new Error(opened.error.message);
        const reached = await reachCast(opened.session);
        session = reached.session;

        const started = await session.submit(reached.move);
        if (!started.ok) throw new Error(started.error.message);
        session = started.session;
        expect(session.decision?.kind).toBe('mana-payment');
        const genericMove = session.play?.automatic?.move;
        if (genericMove === undefined) throw new Error('Missing first automatic mana payment');
        expect(optionSource(session, genericMove)).toBe(fixture.generic);

        const paidGeneric = await session.submit(genericMove);
        if (!paidGeneric.ok) throw new Error(paidGeneric.error.message);
        session = paidGeneric.session;
        const greenMove = session.play?.automatic?.move;
        if (greenMove === undefined) throw new Error('Missing green automatic mana payment');
        expect(optionSource(session, greenMove)).toBe(fixture.flexible);
        expect(manaOutput(session, greenMove)).toBe('G');

        const paidGreen = await session.submit(greenMove);
        if (!paidGreen.ok) throw new Error(paidGreen.error.message);
        session = paidGreen.session;
        expect(session.decision?.kind).not.toBe('mana-payment');
        expect(session.view.stack).toContainEqual(expect.objectContaining({ name: 'Wall of Blossoms' }));
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
