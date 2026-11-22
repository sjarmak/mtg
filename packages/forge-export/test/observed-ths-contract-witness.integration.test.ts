/** Bilateral real-Forge witnesses that Theros scripts reach the reusable controller contracts. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

type Decision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.text === 'Keep this hand' ||
      option.text === 'Play first' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function table(controllers: readonly ['local' | 'engine', 'local' | 'engine'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'ths' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Plains', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: controllers[1],
        deck: { name: 'setup-one', cards: [{ name: 'Forest', count: 60 }] },
      },
    ],
    seed,
    maximumTurns: 3,
  };
}

async function openScenario(spec: SessionSpec, state: Parameters<typeof snapshotForgeScenarioBackend>[0]) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(state, {
    ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
    diagnosticCardNames: ['Hopeful Eidolon', 'Nessian Asp', 'Nessian Courser', 'Forest', 'Plains'],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('THS controller contract witnesses', () => {
  // Bestow is the alternate-cast-cost family (`optional-costs`, the same family Flashback,
  // Cycling and Overload already exercise) rather than a new one: casting Hopeful Eidolon
  // offers two priority options, "Hopeful Eidolon - Creature 1/1" and "Bestow {3}{W}", and
  // choosing the bestow option makes it an Aura spell needing a target, the already-covered
  // `target-selection` family (Victim of Night in Innistrad's witness).
  it('lets the local Hopeful Eidolon caster choose bestow and enchant the only legal creature', async () => {
    const running = await openScenario(table(['local', 'engine'], 'ths-eidolon-bestow-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Hopeful Eidolon'],
          battlefield: ['Plains', 'Plains', 'Plains', 'Plains'],
          library: ['Plains'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: ['Nessian Courser'], library: ['Forest'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let targeted = false;
    const target = session.view.seats[1].battlefield[0]?.oid;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Hopeful Eidolon decision');
        const attached = session.view.seats[0].battlefield.some((card) => card.name === 'Hopeful Eidolon');
        if (attached) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !cast) {
          move = decision.options.find((option) => option.text.includes('Bestow'))?.id;
          cast ||= move !== undefined;
        } else if (decision.kind === 'target-selection') {
          const legal = decision.options.filter((option) => option.targets.length > 0);
          expect(legal.map((option) => option.targets[0]?.oid)).toEqual([target]);
          move = legal[0]?.id;
          targeted = true;
        } else move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled Eidolon decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(targeted, trace.join('\n')).toBe(true);
      const eidolon = session.view.seats[0].battlefield.find((card) => card.name === 'Hopeful Eidolon');
      expect(eidolon?.typeLine, trace.join('\n')).toBe('Enchantment - Aura');
      const courser = session.view.seats[1].battlefield.find((card) => card.name === 'Nessian Courser');
      expect(courser?.power, trace.join('\n')).toBe(4);
      expect(courser?.toughness, trace.join('\n')).toBe(4);
      expect(session.view.seats[0].hand).toEqual([]);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Nessian Asp controller activate monstrosity and add four +1/+1 counters', async () => {
    const running = await openScenario(table(['local', 'engine'], 'ths-asp-monstrosity-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: [],
          battlefield: ['Nessian Asp', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'],
          library: ['Forest'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Forest'], graveyard: [] },
      ],
    });
    let session = running.session;
    let activated = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Nessian Asp decision');
        const monstrous = session.view.seats[0].battlefield.find((card) => card.name === 'Nessian Asp');
        if (activated && monstrous !== undefined && (monstrous.power ?? 0) > 4) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !activated) {
          move = decision.options.find((option) => option.text.includes('Monstrosity'))?.id;
          activated ||= move !== undefined;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Nessian Asp decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(activated, trace.join('\n')).toBe(true);
      const asp = session.view.seats[0].battlefield.find((card) => card.name === 'Nessian Asp');
      expect(asp?.power, trace.join('\n')).toBe(8);
      expect(asp?.toughness, trace.join('\n')).toBe(9);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge attack with Nessian Courser while the local seat only answers its own decisions', async () => {
    const running = await openScenario(table(['local', 'engine'], 'ths-courser-engine-contract-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Plains'], graveyard: [] },
        {
          life: 20,
          hand: [],
          battlefield: ['Nessian Courser', 'Forest', 'Forest', 'Forest'],
          library: ['Forest'],
          graveyard: [],
        },
      ],
    });
    let session = running.session;
    let attacked = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Courser decision');
        expect(decision.seat).toBe(0);
        attacked ||= session.view.seats[0].life < 20;
        if (attacked) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(attacked, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].life).toBeLessThanOrEqual(17);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
