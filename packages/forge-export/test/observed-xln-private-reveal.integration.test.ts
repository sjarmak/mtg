import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { textSubmission, type ObservedSession, type SessionSpec } from '@mtg/engine';
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

function table(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'xln' },
    seats: [
      {
        name: 'Seat zero',
        controller: 'local',
        deck: { name: 'setup-zero', cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: 'engine',
        deck: { name: 'setup-one', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'xln-spyglass-private-reveal-v1',
    maximumTurns: 3,
  };
}

describe.skipIf(!required)('XLN private reveal witness', () => {
  it("shows Sorcerous Spyglass's controller the opponent hand", async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'MAIN1',
        seats: [
          {
            life: 20,
            hand: ['Sorcerous Spyglass'],
            battlefield: ['Swamp', 'Swamp'],
            library: ['Swamp'],
            graveyard: [],
          },
          {
            life: 20,
            hand: ['Forest', 'Giant Growth'],
            battlefield: [],
            library: ['Mountain'],
            graveyard: [],
          },
        ],
      },
      {
        ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
        diagnosticCardNames: ['Swamp', 'Mountain', 'Forest', 'Giant Growth', 'Sorcerous Spyglass'],
      },
    );
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open(table());
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    let cast = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const handLook = session.events.find((event) => event.type === 'Private reveal');
        if (handLook !== undefined) break;
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Sorcerous Spyglass decision');
        trace.push(`${decision.kind}: ${decision.prompt}`);
        let move: string | ReturnType<typeof textSubmission> | undefined;
        if (decision.kind === 'priority') {
          const option = decision.options.find((entry) => entry.text.startsWith('Sorcerous Spyglass:'));
          move = !cast ? option?.id : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move === option?.id;
        } else if (decision.kind === 'card-name' && decision.input !== undefined) {
          move = textSubmission(decision.input, 'Giant Growth');
        } else if (decision.kind.includes('player')) {
          move = decision.options.find((entry) => entry.text.includes('Seat one'))?.id;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Sorcerous Spyglass decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      const handLook = session.events.find((event) => event.type === 'Private reveal');
      expect(cast, trace.join('\n')).toBe(true);
      expect(handLook, trace.join('\n')).toBeDefined();
      expect(handLook!.text).toContain('Forest, Giant Growth');
      expect(handLook!.reveals.map((reveal) => reveal.seats)).toEqual([[0], [0]]);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
