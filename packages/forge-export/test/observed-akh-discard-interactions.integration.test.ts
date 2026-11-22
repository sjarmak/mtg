/** Exact AKH discard choices for an each-player ETB and revealed opponent hand. */
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

async function backendFor(card: string, opponentHand: readonly string[]) {
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
          hand: [card, 'Grizzly Bears'],
          battlefield: ['Swamp', 'Swamp'],
          library: ['Forest'],
          graveyard: [],
        },
        { life: 20, hand: opponentHand, battlefield: [], library: ['Island'], graveyard: [] },
      ],
    },
    compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
  );
  if (backend === null) throw new Error('Installed Forge required');
  return backend;
}

const table = (seed: string): SessionSpec => ({
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    { name: 'Caster', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] } },
    { name: 'Target', controller: 'engine', deck: { name: 'setup', cards: [{ name: 'Forest', count: 60 }] } },
  ],
  seed,
  maximumTurns: 3,
});

describe.skipIf(!required)('AKH exact discard interactions', () => {
  it('lets the local player choose its Miasmic Mummy discard', async () => {
    const backend = await backendFor('Miasmic Mummy', []);
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table('akh-miasmic-mummy-discard-v1'));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      let cast = false;
      let discarded: string | undefined;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Miasmic Mummy decision');
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const option = decision.options.find((entry) => entry.text.startsWith('Miasmic Mummy:'));
          move = !cast ? option?.id : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
          cast ||= move === option?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'hand-card-selection') {
          expect(decision.seat).toBe(0);
          const option = decision.options.find((entry) => entry.targets[0]?.name === 'Grizzly Bears');
          discarded = option?.targets[0]?.oid;
          move = option?.id;
        }
        if (move === undefined) throw new Error(`Unhandled Miasmic Mummy decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (discarded !== undefined && session.view.stack.length === 0) break;
      }
      expect(discarded).toMatch(/^forge-card-/u);
      expect(session.view.seats[0].graveyard.some((card) => card.oid === discarded)).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it('shows only legal Lay Bare the Heart cards to the caster', async () => {
    const backend = await backendFor('Lay Bare the Heart', [
      'Lightning Bolt',
      'Forest',
      'Kari Zev, Skyship Raider',
    ]);
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table('akh-lay-bare-the-heart-v1'));
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      let cast = false;
      let discarded: string | undefined;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Lay Bare the Heart decision');
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const option = decision.options.find((entry) => entry.text.startsWith('Lay Bare the Heart:'));
          move = !cast ? option?.id : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
          cast ||= move === option?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'revealed-hand-discard-selection') {
          expect(decision.seat).toBe(0);
          expect(
            decision.options.every((option) => /^revealed-hand-discard-card-[0-9]+$/u.test(option.id)),
          ).toBe(true);
          expect(decision.options.map((option) => option.targets[0]?.name)).toEqual(['Lightning Bolt']);
          discarded = decision.options[0]?.targets[0]?.oid;
          move = decision.options[0]?.id;
        }
        if (move === undefined) throw new Error(`Unhandled Lay Bare the Heart decision: ${decision.kind}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (discarded !== undefined && session.view.stack.length === 0) break;
      }
      expect(discarded).toMatch(/^forge-card-/u);
      expect(session.view.seats[1].graveyard.some((card) => card.oid === discarded)).toBe(true);
      expect(session.view.seats[1].hand).toBeNull();
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
