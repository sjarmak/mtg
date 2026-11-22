/** Bilateral real-Forge witnesses that Innistrad scripts reach the reusable controller contracts. */
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
    content: { kind: 'printed', format: 'isd' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Swamp', count: 60 }] },
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
    diagnosticCardNames: [
      'Civilized Scholar',
      'Darkthicket Wolf',
      'Deranged Assistant',
      'Forest',
      'Island',
      'Stitched Drake',
      'Swamp',
      'Think Twice',
      'Victim of Night',
    ],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('ISD controller contract witnesses', () => {
  it('lets the local Victim of Night caster choose and destroy the only legal creature', async () => {
    const running = await openScenario(table(['local', 'engine'], 'isd-victim-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Victim of Night'],
          battlefield: ['Swamp', 'Swamp'],
          library: ['Swamp'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: ['Darkthicket Wolf'], library: ['Forest'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let targeted = false;
    let stacked = false;
    const target = session.view.seats[1].battlefield[0]?.oid;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Victim of Night decision');
        stacked ||= session.view.stack.some((card) => card.name === 'Victim of Night');
        if (stacked && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Victim of Night:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'target-selection') {
          const legal = decision.options.filter((option) => option.targets.length > 0);
          expect(legal.map((option) => option.targets[0]?.oid)).toEqual([target]);
          move = legal[0]?.id;
          targeted = true;
        } else move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled Victim decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(targeted, trace.join('\n')).toBe(true);
      expect(stacked, trace.join('\n')).toBe(true);
      expect(session.view.seats[1].battlefield).toEqual([]);
      expect(session.view.seats[1].graveyard.map((card) => card.name)).toEqual(['Darkthicket Wolf']);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge attack with Darkthicket Wolf while the local seat only answers its own decisions', async () => {
    const running = await openScenario(table(['local', 'engine'], 'isd-wolf-engine-contract-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
        {
          life: 20,
          hand: [],
          battlefield: ['Darkthicket Wolf', 'Forest', 'Forest', 'Forest'],
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
        if (decision === null) throw new Error('Missing engine Wolf decision');
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
      expect(session.view.seats[0].life).toBeLessThanOrEqual(18);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local seat choose Stitched Drake graveyard-exile payment', async () => {
    const running = await openScenario(table(['local', 'engine'], 'isd-stitched-drake-cost-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Stitched Drake'],
          battlefield: ['Island', 'Island', 'Island'],
          library: ['Island'],
          graveyard: ['Darkthicket Wolf'],
        },
        { life: 20, hand: [], battlefield: [], library: ['Forest'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let paid = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Stitched Drake decision');
        if (session.view.seats[0].battlefield.some((card) => card.name === 'Stitched Drake')) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Stitched Drake:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.prompt.includes('exile from your graveyard')) {
          move = decision.options.find((option) => option.text.includes('Darkthicket Wolf'))?.id;
          paid = move !== undefined;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Stitched Drake decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(paid, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].battlefield.map((card) => card.name)).toContain('Stitched Drake');
      expect(session.view.seats[0].graveyard.map((card) => card.name)).not.toContain('Darkthicket Wolf');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge choose Stitched Drake graveyard-exile payment', async () => {
    const running = await openScenario(table(['local', 'engine'], 'isd-stitched-drake-engine-cost-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
        {
          life: 20,
          hand: ['Stitched Drake'],
          battlefield: ['Island', 'Island', 'Island'],
          library: ['Island'],
          graveyard: ['Darkthicket Wolf'],
        },
      ],
    });
    let session = running.session;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const cast = session.view.seats[1].battlefield.some((card) => card.name === 'Stitched Drake');
        if (cast) break;
        const decision = session.decision;
        if (decision === null) throw new Error('Missing local decision during engine Stitched Drake witness');
        expect(decision.seat).toBe(0);
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(
        session.view.seats[1].battlefield.map((card) => card.name),
        trace.join('\n'),
      ).toContain('Stitched Drake');
      expect(session.view.seats[1].graveyard.map((card) => card.name)).not.toContain('Darkthicket Wolf');
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('pays Deranged Assistant mill without inventing a player choice', async () => {
    const running = await openScenario(table(['local', 'engine'], 'isd-deranged-assistant-cost-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Think Twice'],
          battlefield: ['Deranged Assistant', 'Island'],
          library: ['Island', 'Swamp'],
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
        if (decision === null) throw new Error('Missing Deranged Assistant decision');
        if (session.view.seats[0].graveyard.length > 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = decision.options.find((option) => option.text.startsWith('Think Twice:'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.text.includes('Deranged Assistant'))?.id;
          activated ||= move !== undefined;
          move ??= routineMove(decision);
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Deranged Assistant decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(activated, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].graveyard).toHaveLength(1);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Civilized Scholar controller discard a creature and transforms it without a second question', async () => {
    const running = await openScenario(table(['local', 'engine'], 'isd-civilized-scholar-discard-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Darkthicket Wolf'],
          battlefield: ['Civilized Scholar', 'Island'],
          library: ['Island', 'Swamp'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Forest'], graveyard: [] },
      ],
    });
    let session = running.session;
    let activated = false;
    let discarded = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Civilized Scholar decision');
        if (discarded && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !activated) {
          move = decision.options.find((option) => option.text.startsWith('Civilized Scholar:'))?.id;
          activated ||= move !== undefined;
        } else if (decision.kind === 'hand-card-selection') {
          // Both cards in hand are offered; the drawn Island and the Wolf. Discarding the creature is
          // what makes the continuation fire, and the continuation must ask nothing.
          expect(decision.options.map((option) => option.text)).toEqual(
            expect.arrayContaining([expect.stringContaining('Discard Darkthicket Wolf')]),
          );
          move = decision.options.find((option) => option.text.startsWith('Discard Darkthicket Wolf'))?.id;
          discarded = move !== undefined;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Civilized Scholar decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(activated, trace.join('\n')).toBe(true);
      expect(discarded, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].graveyard.map((card) => card.name)).toEqual(['Darkthicket Wolf']);
      expect(session.view.seats[0].hand?.map((card) => card.name)).toEqual(['Island']);
      const brute = session.view.seats[0].battlefield.find((card) => card.name === 'Homicidal Brute');
      expect(brute, trace.join('\n')).toBeDefined();
      expect(brute?.tapped).toBe(false);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
