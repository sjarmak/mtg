/** Bilateral real-Forge witnesses for the last AKH/HOU controller families. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { textSubmission } from '@mtg/engine';
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
    content: { kind: 'printed', format: 'akh-hou' },
    seats: [
      {
        name: 'Seat zero',
        controller: controllers[0],
        deck: { name: 'setup-zero', cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: controllers[1],
        deck: { name: 'setup-one', cards: [{ name: 'Island', count: 60 }] },
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
      'Dispossess',
      'Binding Mummy',
      'Desert of the Indomitable',
      'Forest',
      'Hostile Desert',
      'Island',
      'Lightning Bolt',
      'Manalith',
      'Mountain',
      'Naga Oracle',
      'Plains',
      'Sacred Cat',
      'Shefet Monitor',
      'Swamp',
      'Unesh, Criosphinx Sovereign',
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

describe.skipIf(!required)('AKH/HOU remaining controller contracts', () => {
  it('lets the local Dispossess caster name and exile every matching artifact', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-dispossess-local-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Dispossess'],
          battlefield: ['Swamp', 'Swamp', 'Swamp'],
          library: ['Forest'],
          graveyard: [],
        },
        {
          life: 20,
          hand: ['Manalith', 'Lightning Bolt'],
          battlefield: [],
          library: ['Manalith', 'Island'],
          graveyard: ['Manalith'],
        },
      ],
    });
    let session = running.session;
    let cast = false;
    let named = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Dispossess decision');
        trace.push(`${decision.kind}: ${decision.prompt}`);
        if (
          cast &&
          session.view.stack.length === 0 &&
          session.view.seats[1].exile.filter((card) => card.name === 'Manalith').length === 3
        ) {
          resolved = true;
          break;
        }
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Dispossess:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'card-name') {
          if (decision.input === undefined) throw new Error('Dispossess omitted its name input');
          const invalid = await session.submit(textSubmission(decision.input, 'Forest'));
          expect(invalid).toMatchObject({ ok: false });
          move = textSubmission(decision.input, 'Manalith');
          named = true;
        } else if (decision.kind === 'zone-card-selection') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Manalith')?.id;
        } else {
          move = routineMove(decision);
        }
        if (move === undefined)
          throw new Error(`Unhandled Dispossess decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(named, trace.join('\n')).toBe(true);
      expect(resolved, `${trace.join('\n')}\n${JSON.stringify(session.view)}`).toBe(true);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Binding Mummy pilot target and accept its optional trigger', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-binding-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Binding Mummy'],
          battlefield: ['Plains', 'Plains', 'Binding Mummy'],
          library: ['Plains'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: ['Sacred Cat'], library: ['Plains'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let confirmed = false;
    const target = session.view.seats[1].battlefield[0]?.oid;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Binding Mummy decision');
        if (confirmed && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Binding Mummy:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.targets[0]?.oid === target)?.id;
        } else if (decision.kind === 'confirm-trigger') {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
          confirmed = true;
        } else move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled Binding decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(confirmed, trace.join('\n')).toBe(true);
      expect(session.view.seats[1].battlefield[0]).toMatchObject({ oid: target, tapped: true });
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge use Binding Mummy without exposing its trigger choices', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-binding-engine-contract-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: ['Sacred Cat'], library: ['Plains'], graveyard: [] },
        {
          life: 20,
          hand: ['Binding Mummy'],
          battlefield: ['Plains', 'Plains', 'Binding Mummy'],
          library: ['Plains'],
          graveyard: [],
        },
      ],
    });
    let session = running.session;
    let cast = false;
    let resolved = false;
    const target = session.view.seats[0].battlefield[0]?.oid;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Binding decision');
        expect(decision.seat).toBe(0);
        cast ||= session.view.stack.some((card) => card.name === 'Binding Mummy');
        if (cast && session.view.stack.length === 0 && session.view.seats[0].battlefield[0]?.tapped) {
          resolved = true;
          break;
        }
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(resolved, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].battlefield[0]).toMatchObject({ oid: target, tapped: true });
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Shefet Monitor pilot cycle and select a searched land', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-shefet-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Shefet Monitor'],
          battlefield: ['Forest', 'Forest', 'Forest', 'Forest'],
          library: ['Forest', 'Mountain'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Plains'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cycled = false;
    let searched = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Shefet decision');
        if (searched && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cycled
            ? decision.options.find((option) => option.text.includes('Cycling'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cycled ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'zone-card-selection') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Forest')?.id;
          searched = true;
        } else if (decision.kind === 'confirm-trigger') {
          move = decision.options.find((option) => option.id === 'confirm-trigger-yes')?.id;
        } else move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled Shefet decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cycled, trace.join('\n')).toBe(true);
      expect(searched, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].graveyard.map((card) => card.name)).toContain('Shefet Monitor');
      expect(session.view.seats[0].battlefield.map((card) => card.name)).toContain('Forest');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge cycle Shefet Monitor and search without leaking its library choice', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-shefet-engine-contract-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Plains'], graveyard: [] },
        {
          life: 20,
          hand: ['Shefet Monitor'],
          battlefield: ['Forest', 'Forest', 'Forest', 'Forest'],
          library: ['Forest', 'Mountain'],
          graveyard: [],
        },
      ],
    });
    let session = running.session;
    let cycled = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Shefet decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        cycled ||= session.view.stack.some((card) => card.name === 'Shefet Monitor');
        if (
          cycled &&
          session.view.stack.length === 0 &&
          bot.graveyard.some((card) => card.name === 'Shefet Monitor')
        ) {
          resolved = true;
          break;
        }
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cycled, trace.join('\n')).toBe(true);
      expect(resolved, trace.join('\n')).toBe(true);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Naga Oracle pilot split and order the exact top cards', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-naga-oracle-local-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Naga Oracle'],
          battlefield: ['Island', 'Island', 'Island', 'Island'],
          library: ['Forest', 'Mountain', 'Plains'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let moved = false;
    let ordered = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Naga Oracle decision');
        trace.push(`${decision.kind}: ${decision.prompt}`);
        if (ordered && session.view.stack.length === 0) break;
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Naga Oracle:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'surveil-move') {
          move = !moved
            ? decision.options.find((option) => option.targets[0]?.name === 'Forest')?.id
            : decision.options.find((option) => option.id === 'surveil-move-done')?.id;
          moved = true;
        } else if (decision.kind === 'surveil-keep') {
          move = decision.options.find((option) => option.targets[0]?.name === 'Mountain')?.id;
          ordered = true;
        } else {
          move = routineMove(decision);
        }
        if (move === undefined) throw new Error(`Unhandled Naga decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(moved, evidence).toBe(true);
      expect(ordered, evidence).toBe(true);
      expect(
        session.view.seats[0].graveyard.map((card) => card.name),
        evidence,
      ).toContain('Forest');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge cast and resolve Naga Oracle without leaking its library choices', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-naga-oracle-engine-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
        {
          life: 20,
          hand: ['Naga Oracle'],
          battlefield: ['Island', 'Island', 'Island', 'Island'],
          library: ['Forest', 'Mountain', 'Plains'],
          graveyard: [],
        },
      ],
    });
    let session = running.session;
    let cast = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Naga Oracle decision');
        expect(decision.seat).toBe(0);
        cast ||= session.view.stack.some((card) => card.name === 'Naga Oracle');
        if (
          cast &&
          session.view.stack.length === 0 &&
          session.view.seats[1].battlefield.some((card) => card.name === 'Naga Oracle')
        ) {
          resolved = true;
          break;
        }
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(resolved, `${trace.join('\n')}\n${JSON.stringify(session.view)}`).toBe(true);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Unesh caster choose between the piles Forge split', async () => {
    const running = await openScenario(table(['local', 'engine'], 'hou-unesh-local-choice-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Unesh, Criosphinx Sovereign'],
          battlefield: Array<string>(6).fill('Island'),
          library: ['Forest', 'Mountain', 'Plains', 'Swamp'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let pileChoice = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Unesh decision');
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        if (pileChoice && session.view.stack.length === 0) break;
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Unesh, Criosphinx Sovereign:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'choose-pile') {
          expect(decision.seat).toBe(0);
          expect(decision.options).toHaveLength(2);
          expect(decision.options.every((option) => option.text.includes('card'))).toBe(true);
          move = decision.options[0]?.id;
          pileChoice = true;
        } else {
          move = routineMove(decision);
        }
        if (move === undefined) throw new Error(`Unhandled Unesh decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(pileChoice, evidence).toBe(true);
      expect(session.view.seats[0].handSize + session.view.seats[0].graveyard.length, evidence).toBe(4);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local opponent split Unesh piles before Forge chooses one', async () => {
    const running = await openScenario(table(['local', 'engine'], 'hou-unesh-local-split-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
        {
          life: 20,
          hand: ['Unesh, Criosphinx Sovereign'],
          battlefield: Array<string>(6).fill('Island'),
          library: ['Forest', 'Mountain', 'Plains', 'Swamp'],
          graveyard: [],
        },
      ],
    });
    let session = running.session;
    let cast = false;
    let split = false;
    let resolved = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing engine Unesh decision');
        expect(decision.seat).toBe(0);
        cast ||= session.view.stack.some((card) => card.name === 'Unesh, Criosphinx Sovereign');
        if (
          split &&
          session.view.stack.length === 0 &&
          session.view.seats[1].battlefield.some((card) => card.name === 'Unesh, Criosphinx Sovereign')
        ) {
          resolved = true;
          break;
        }
        trace.push(
          `${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'card-selection') {
          const card = decision.options.find((option) => option.targets[0]?.name === 'Forest');
          const done = decision.options.find((option) => option.targets.length === 0);
          move = split ? done?.id : card?.id;
          split = true;
        } else {
          move = routineMove(decision);
        }
        if (move === undefined)
          throw new Error(`Unhandled local Unesh decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(split, evidence).toBe(true);
      expect(resolved, evidence).toBe(true);
      expect(session.view.seats[1].hand).toBeNull();
      const playedRevealedCards = session.view.seats[1].battlefield.filter((card) =>
        ['Forest', 'Mountain', 'Plains', 'Swamp'].includes(card.name),
      ).length;
      expect(
        session.view.seats[1].handSize + session.view.seats[1].graveyard.length + playedRevealedCards,
        evidence,
      ).toBe(4);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local Hostile Desert pilot choose the land card exiled to animate it', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-hostile-desert-local-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: [],
          battlefield: ['Hostile Desert', 'Swamp', 'Swamp'],
          library: ['Swamp'],
          graveyard: ['Swamp'],
        },
        { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
      ],
    });
    let session = running.session;
    let activated = false;
    let paid = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Hostile Desert decision');
        if (paid && session.view.seats[0].graveyard.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !activated) {
          move = decision.options.find(
            (option) => option.text.startsWith('Hostile Desert:') && option.text.includes('Exile'),
          )?.id;
          activated = move !== undefined;
        } else if (decision.kind === 'cost-card-selection') {
          move = decision.options.find((option) => option.text.includes('Swamp'))?.id;
          paid = move !== undefined;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Hostile Desert decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(activated, trace.join('\n')).toBe(true);
      expect(paid, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].graveyard).toHaveLength(0);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge choose the land card Hostile Desert exiles to animate itself', async () => {
    const running = await openScenario(table(['local', 'engine'], 'akh-hostile-desert-engine-v1'), {
      schemaVersion: 1,
      active: 1,
      phase: 'MAIN1',
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
        {
          life: 20,
          hand: [],
          battlefield: ['Hostile Desert', 'Island', 'Island'],
          library: ['Island'],
          graveyard: ['Island'],
        },
      ],
    });
    let session = running.session;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        if (session.view.seats[1].graveyard.length === 0) break;
        const decision = session.decision;
        if (decision === null) throw new Error('Missing local decision during engine Hostile Desert witness');
        expect(decision.seat).toBe(0);
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(session.view.seats[1].graveyard, trace.join('\n')).toHaveLength(0);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
