/** Real-Forge scenarios for the interaction families found by the AKH/HOU sealed sweep. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PendingDecision, ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;
beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    { name: 'Pilot', controller: 'local', deck: { name: 'white', cards: [{ name: 'Plains', count: 60 }] } },
    {
      name: 'Observer',
      controller: 'local',
      deck: { name: 'red', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'akh-hou-sealed-residuals-v1',
  maximumTurns: 3,
};

function ordinaryMove(decision: PendingDecision) {
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

async function scenarioBackend(seats: readonly [object, object]) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(
    { schemaVersion: 1, active: 0, phase: 'MAIN1', seats },
    compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
  );
  if (backend === null) throw new Error('Installed Forge required');
  return backend;
}

describe.skipIf(!required)('AKH/HOU sealed residual scenarios', () => {
  it('casts Authority from the graveyard and selects two distinct opposing creatures', async () => {
    const backend = await scenarioBackend([
      {
        life: 20,
        hand: [],
        battlefield: ['Plains', 'Plains'],
        library: ['Plains'],
        graveyard: ['Appeal // Authority'],
      },
      {
        life: 20,
        hand: [],
        battlefield: ['Grizzly Bears', 'Runeclaw Bear'],
        library: ['Mountain'],
        graveyard: [],
      },
    ]);
    let session: ObservedSession | undefined;
    const selected = new Set<string>();
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const source = session.view.seats[0].graveyard[0];
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Authority decision');
        if (session.view.seats[0].exile.some((card) => card.oid === source?.oid)) break;
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'priority')
          move = decision.options.find((option) =>
            option.text.includes('Tap up to two target creatures'),
          )?.id;
        else if (decision.kind === 'mana-payment')
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        else if (decision.kind === 'target-selection') {
          const option = decision.options.find(
            (candidate) => candidate.targets[0] !== undefined && !selected.has(candidate.targets[0].oid),
          );
          if (option?.targets[0] !== undefined) selected.add(option.targets[0].oid);
          move = option?.id ?? decision.options.find((option) => option.id === 'target-none')?.id;
        }
        move ??= ordinaryMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Authority decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(selected.size, evidence).toBe(2);
      expect(
        session.view.seats[1].battlefield.every((card) => card.tapped),
        evidence,
      ).toBe(true);
      expect(
        session.view.seats[0].exile.some((card) => card.oid === source?.oid),
        evidence,
      ).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it('returns exactly one controlled land after Kefnet draws', async () => {
    const backend = await scenarioBackend([
      {
        life: 20,
        hand: [],
        battlefield: ['Kefnet the Mindful', 'Island', 'Island', 'Island', 'Island'],
        library: ['Plains', 'Island'],
        graveyard: [],
      },
      { life: 20, hand: [], battlefield: [], library: ['Mountain'], graveyard: [] },
    ]);
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let activated = false;
    let selected: string | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Kefnet decision');
        if (activated && selected !== undefined && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const ability = decision.options.find(
            (option) => option.text.startsWith('Kefnet the Mindful:') && option.text.includes('Draw a card'),
          );
          move = activated ? ordinaryMove(decision) : ability?.id;
          activated ||= move === ability?.id;
        } else if (decision.kind === 'mana-payment')
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        else if (decision.kind === 'zone-card-selection') {
          const option = decision.options.find((candidate) => candidate.targets[0]?.name === 'Island');
          selected = option?.targets[0]?.oid;
          move = option?.id;
        }
        move ??= ordinaryMove(decision);
        if (move === undefined) throw new Error(`Unhandled Kefnet decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(activated, evidence).toBe(true);
      expect(selected, evidence).toBeDefined();
      expect(
        session.view.seats[0].hand?.some((card) => card.oid === selected),
        evidence,
      ).toBe(true);
      expect(
        session.view.seats[0].battlefield.some((card) => card.oid === selected),
        evidence,
      ).toBe(false);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it('pays Unwavering Initiate’s complete embalm cost and creates its exact token', async () => {
    const backend = await scenarioBackend([
      {
        life: 20,
        hand: [],
        battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'],
        library: ['Plains'],
        graveyard: ['Unwavering Initiate'],
      },
      { life: 20, hand: [], battlefield: [], library: ['Mountain'], graveyard: [] },
    ]);
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let activated = false;
    let confirmed = false;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const source = session.view.seats[0].graveyard[0];
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Initiate decision');
        if (session.view.seats[0].battlefield.some((card) => card.name === 'Unwavering Initiate')) break;
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const ability = decision.options.find((option) => option.text.includes('Embalm'));
          move = activated ? ordinaryMove(decision) : ability?.id;
          activated ||= move === ability?.id;
        } else if (decision.kind === 'mana-payment')
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        else if (decision.kind === 'cost-exile-confirm') {
          expect(decision.options[0]?.targets[0]?.oid).toBe(source?.oid);
          move = 'cost-exile-confirm-yes';
          confirmed = true;
        }
        move ??= ordinaryMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Initiate decision\n${trace.slice(-12).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        session = advanced.session;
      }
      const token = session.view.seats[0].battlefield.find((card) => card.name === 'Unwavering Initiate');
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect({ activated, confirmed }, evidence).toEqual({ activated: true, confirmed: true });
      expect(token, evidence).toMatchObject({
        power: 3,
        toughness: 2,
        characteristics: { colors: ['W'], manaCost: null, token: true },
      });
      expect(token?.typeLine, evidence).toContain('Zombie');
      expect(
        session.view.seats[0].exile.some((card) => card.oid === source?.oid),
        evidence,
      ).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
