/** Real Forge behavior for AKH/HOU choices that branch into card-cost callbacks. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
/** A whole Forge boot per branch; under a loaded machine that alone passes vitest's default five seconds. */
const TIMEOUT_MS = 180_000;
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    { name: 'Caster', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
    { name: 'Payer', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
  ],
  seed: 'akh-hou-alternative-costs-v1',
  maximumTurns: 2,
};

type Branch = 'tragic-discard' | 'hailfire-sacrifice' | 'venom-sacrifice';
type RunningBranch = {
  readonly session: ObservedSession;
  readonly shutdown: () => Promise<void>;
};

async function runBranch(branch: Branch): Promise<RunningBranch> {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const spell =
    branch === 'tragic-discard'
      ? 'Tragic Lesson'
      : branch === 'hailfire-sacrifice'
        ? 'Torment of Hailfire'
        : 'Torment of Venom';
  const land = branch === 'tragic-discard' ? 'Island' : 'Swamp';
  const backend = await snapshotForgeScenarioBackend(
    {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: [spell],
          battlefield: [...Array<string>(9).fill(land), 'Grizzly Bears'],
          library: ['Mountain', 'Forest', 'Plains'],
          graveyard: [],
        },
        {
          life: 20,
          hand: ['Lightning Bolt'],
          battlefield: ['Hill Giant', 'Manalith'],
          library: ['Island', 'Plains', 'Forest'],
          graveyard: [],
        },
      ],
    },
    compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
  );
  if (backend === null) throw new Error('Installed Forge required');
  let session: ObservedSession | undefined;
  let cast = false;
  let stacked = false;
  const trace: string[] = [];
  try {
    const opened = await backend.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Missing Forge decision');
      trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
      stacked ||= session.view.stack.some((card) => card.name === spell);
      if (stacked && session.view.stack.length === 0 && decision.kind === 'priority') {
        return {
          session,
          shutdown: async () => {
            await session?.close();
            await backend.shutdown?.();
          },
        };
      }

      let move: string | undefined;
      if (decision.kind === 'priority') {
        move = !cast
          ? decision.options.find(
              (option) => option.text.startsWith(`${spell}:`) && !option.text.includes('Cycling'),
            )?.id
          : decision.options.find((option) => option.text === 'Pass priority')?.id;
        cast ||= move !== undefined && !stacked;
      } else if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
      } else if (decision.kind === 'number') {
        move = decision.options.find((option) => option.text === 'Choose 1')?.id;
      } else if (decision.kind === 'target-selection') {
        move = decision.options.find((option) =>
          option.targets.some((target) => target.name === 'Hill Giant'),
        )?.id;
      } else if (decision.kind === 'ability-selection') {
        move = decision.options.find((option) => option.text.includes('sacrifice'))?.id;
      } else if (decision.kind === 'confirm-payment') {
        move = decision.options.find((option) =>
          branch === 'tragic-discard' ? option.text === 'Do not pay it' : option.text === 'Pay it',
        )?.id;
      } else if (decision.kind === 'cost-card-selection') {
        move = decision.options.find((option) =>
          option.targets.some(
            (target) => target.name === (branch === 'venom-sacrifice' ? 'Manalith' : 'Hill Giant'),
          ),
        )?.id;
      } else if (decision.kind === 'hand-card-selection') {
        move = decision.options.find((option) => option.targets[0]?.name === 'Mountain')?.id;
      }
      if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-10).join('\n')}`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
      session = advanced.session;
    }
    throw new Error(`Spell did not resolve\n${trace.slice(-10).join('\n')}`);
  } catch (error) {
    await session?.close();
    await backend.shutdown?.();
    throw error;
  }
}

describe.skipIf(!required)('AKH/HOU alternative card costs', () => {
  it(
    'discards exactly one drawn card when Tragic Lesson return-land is declined',
    async () => {
      const running = await runBranch('tragic-discard');
      try {
        expect(running.session.view.seats[0].graveyard.map((card) => card.name).sort()).toEqual([
          'Mountain',
          'Tragic Lesson',
        ]);
        expect(running.session.view.seats[0].hand?.map((card) => card.name).sort()).toEqual(['Forest']);
      } finally {
        await running.shutdown();
      }
    },
    TIMEOUT_MS,
  );

  it.each([
    ['hailfire-sacrifice', 'Hill Giant'],
    ['venom-sacrifice', 'Manalith'],
  ] as const)(
    '%s pays by sacrificing the exact chosen permanent',
    async (branch, sacrificed) => {
      const running = await runBranch(branch);
      try {
        expect(running.session.view.seats[1].graveyard.map((card) => card.name)).toContain(sacrificed);
        expect(running.session.view.seats[1].life).toBe(20);
      } finally {
        await running.shutdown();
      }
    },
    TIMEOUT_MS,
  );

  it(
    'lets Forge announce and resolve Torment of Hailfire X',
    async () => {
      if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
        throw new Error('Installed Forge required');
      const backend = await snapshotForgeScenarioBackend(
        {
          schemaVersion: 1,
          active: 1,
          phase: 'MAIN1',
          seats: [
            {
              life: 20,
              hand: ['Lightning Bolt'],
              battlefield: ['Grizzly Bears', 'Manalith'],
              library: ['Island'],
              graveyard: [],
            },
            {
              life: 20,
              hand: ['Torment of Hailfire'],
              battlefield: Array<string>(8).fill('Swamp'),
              library: ['Forest'],
              graveyard: [],
            },
          ],
        },
        compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
      );
      if (backend === null) throw new Error('Installed Forge required');
      let session: ObservedSession | undefined;
      let cast = false;
      let resolved = false;
      const trace: string[] = [];
      try {
        const opened = await backend.open({
          ...table,
          seats: [
            { ...table.seats[0]!, controller: 'local' },
            { ...table.seats[1]!, controller: 'engine' },
          ],
          seed: 'akh-hou-hailfire-engine-x-v1',
        });
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
          const decision = session.decision;
          if (decision === null) throw new Error('Missing Hailfire decision');
          expect(decision.seat).toBe(0);
          cast ||= session.view.stack.some((card) => card.name === 'Torment of Hailfire');
          if (cast && session.view.stack.length === 0) {
            resolved = true;
            break;
          }
          trace.push(`${decision.kind}: ${decision.prompt}`);
          let move = decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (decision.kind === 'confirm-payment')
            move = decision.options.find((option) => option.text === 'Do not pay it')?.id;
          else if (decision.kind === 'ability-selection')
            move = decision.options.find((option) => option.text.includes('lose 3 life'))?.id;
          else if (decision.kind === 'cost-card-selection')
            move = decision.options.find((option) => option.targets.length === 1)?.id;
          move ??= decision.options.find(
            (option) =>
              option.text === 'Keep this hand' ||
              option.text === 'Play first' ||
              option.id === 'combat-attackers-commit' ||
              option.id === 'combat-blockers-commit',
          )?.id;
          if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
          session = advanced.session;
        }
        expect(cast, trace.slice(-12).join('\n')).toBe(true);
        expect(resolved, trace.slice(-12).join('\n')).toBe(true);
        expect(session.view.seats[0].life).toBeLessThan(20);
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    TIMEOUT_MS,
  );
});
