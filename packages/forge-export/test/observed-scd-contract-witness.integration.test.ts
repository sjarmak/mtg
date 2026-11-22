/**
 * Real-Forge witness that a Starter Commander Decks script reaches the
 * reusable controller contracts on the scenario route at forty life. The
 * command-zone contracts are witnessed in whole games instead
 * (`observed-scd-commander-witness.integration.test.ts`), because the puzzle
 * route empties the command zone before it deals the fixture.
 */
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

function table(seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'scd' },
    seats: [
      {
        name: 'Seat zero',
        controller: 'local',
        deck: { name: 'setup-zero', cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: 'engine',
        deck: { name: 'setup-one', cards: [{ name: 'Swamp', count: 60 }] },
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
    diagnosticCardNames: ['Gray Merchant of Asphodel', 'Murder', 'Swamp', 'Foreboding Ruins', 'Mountain'],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('SCD controller contract witnesses', () => {
  it('lets the local Murder caster choose and destroy the only legal creature at forty life', async () => {
    const running = await openScenario(table('scd-murder-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 40,
          hand: ['Murder'],
          battlefield: ['Swamp', 'Swamp', 'Swamp'],
          library: ['Swamp'],
          graveyard: [],
        },
        { life: 40, hand: [], battlefield: ['Gray Merchant of Asphodel'], library: ['Swamp'], graveyard: [] },
      ],
    });
    let session = running.session;
    let cast = false;
    let targeted = false;
    let stacked = false;
    const target = session.view.seats[1].battlefield[0]?.oid;
    const trace: string[] = [];
    try {
      expect(session.view.seats.map((seat) => seat.life)).toEqual([40, 40]);
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Murder decision');
        stacked ||= session.view.stack.some((card) => card.name === 'Murder');
        if (stacked && session.view.stack.length === 0) break;
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Murder:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'target-selection') {
          const legal = decision.options.filter((option) => option.targets.length > 0);
          expect(legal.map((option) => option.targets[0]?.oid)).toEqual([target]);
          move = legal[0]?.id;
          targeted = true;
        } else move = routineMove(decision);
        if (move === undefined) throw new Error(`Unhandled Murder decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(targeted, trace.join('\n')).toBe(true);
      expect(stacked, trace.join('\n')).toBe(true);
      expect(session.view.seats[1].battlefield).toEqual([]);
      expect(session.view.seats[1].graveyard.map((card) => card.name)).toEqual(['Gray Merchant of Asphodel']);
      expect(session.view.seats[0].graveyard.map((card) => card.name)).toEqual(['Murder']);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the local player reveal a Mountain so Foreboding Ruins enters untapped', async () => {
    const running = await openScenario(table('scd-foreboding-ruins-reveal-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 40,
          hand: ['Foreboding Ruins', 'Mountain'],
          battlefield: [],
          library: ['Swamp'],
          graveyard: [],
        },
        { life: 40, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
      ],
    });
    let session = running.session;
    const mountain = session.view.seats[0].hand?.find((card) => card.name === 'Mountain')?.oid;
    let played = false;
    let confirmed = false;
    let revealed = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Foreboding Ruins decision');
        if (session.view.seats[0].battlefield.some((card) => card.name === 'Foreboding Ruins')) break;
        trace.push(`${decision.kind}: ${decision.prompt} [${decision.options.map((o) => o.id).join(', ')}]`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !played) {
          move = decision.options.find((option) => option.text.startsWith('Play Foreboding Ruins'))?.id;
          played = move !== undefined;
        } else if (decision.kind === 'confirm-payment') {
          expect(decision.prompt).toMatch(/Reveal a Swamp or Mountain card from your hand/u);
          move = decision.options.find((option) => option.id === 'confirm-payment-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'cost-card-selection') {
          const cards = decision.options.filter((option) =>
            option.id.startsWith('cost-card-selection-card-'),
          );
          if (!revealed) {
            expect(cards.map((option) => option.targets[0]?.oid)).toEqual([mountain]);
            move = cards[0]?.id;
            revealed = move !== undefined;
          } else move = decision.options.find((option) => option.id === 'cost-card-selection-done')?.id;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Foreboding Ruins decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(played, trace.join('\n')).toBe(true);
      expect(confirmed, trace.join('\n')).toBe(true);
      expect(revealed, trace.join('\n')).toBe(true);
      const ruins = session.view.seats[0].battlefield.find((card) => card.name === 'Foreboding Ruins');
      expect(ruins?.tapped, trace.join('\n')).toBe(false);
      expect(session.view.seats[0].hand?.map((card) => card.name)).toEqual(['Mountain']);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
