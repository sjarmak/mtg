/** Doomfall reveals only the targeted hand and exiles the exact chosen nonland card. */
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

const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    { name: 'Caster', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] } },
    { name: 'Target', controller: 'engine', deck: { name: 'setup', cards: [{ name: 'Forest', count: 60 }] } },
  ],
  seed: 'hou-doomfall-revealed-hand-v1',
  maximumTurns: 3,
};

describe.skipIf(!required)('Doomfall revealed-hand selection', () => {
  it('offers the caster the revealed nonland objects but not the land', async () => {
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
            hand: ['Doomfall'],
            battlefield: ['Swamp', 'Swamp', 'Swamp'],
            library: [],
            graveyard: [],
          },
          {
            life: 20,
            hand: ['Lightning Bolt', 'Forest'],
            battlefield: [],
            library: ['Island'],
            graveyard: [],
          },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    let cast = false;
    let selected: string | undefined;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.view.seats[1].hand).toBeNull();
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Doomfall decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        if (
          selected !== undefined &&
          session.view.seats[1].exile.some((card) => card.oid === selected) &&
          session.view.stack.length === 0
        )
          break;
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const option = decision.options.find((entry) => entry.text.startsWith('Doomfall:'));
          move = !cast ? option?.id : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move === option?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'mode-selection') {
          move = decision.options.find((option) => option.text.includes('reveals their hand'))?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'zone-card-selection') {
          expect(decision.seat).toBe(0);
          expect(decision.options.map((option) => option.targets[0]?.name)).toEqual(['Lightning Bolt']);
          selected = decision.options[0]?.targets[0]?.oid;
          move = decision.options[0]?.id;
        }
        if (move === undefined)
          throw new Error(`Unhandled Doomfall decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      const evidence = `${trace.join('\n')}\n${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(selected, evidence).toMatch(/^forge-card-/u);
      expect(
        session.view.seats[1].exile.some((card) => card.oid === selected),
        evidence,
      ).toBe(true);
      expect(session.view.seats[1].hand, evidence).toBeNull();
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it('lets Forge choose and resolve a Doomfall mode without exposing its hidden hand', async () => {
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
            battlefield: ['Grizzly Bears'],
            library: ['Island'],
            graveyard: [],
          },
          {
            life: 20,
            hand: ['Doomfall'],
            battlefield: ['Swamp', 'Swamp', 'Swamp'],
            library: ['Forest'],
            graveyard: [],
          },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cast = false;
    let resolved = false;
    try {
      const opened = await backend.open({
        ...table,
        seats: [
          { ...table.seats[1]!, controller: 'local' },
          { ...table.seats[0]!, controller: 'engine' },
        ],
        seed: 'hou-doomfall-engine-mode-v1',
      });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 100 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Doomfall engine decision');
        expect(decision.seat).toBe(0);
        expect(session.view.seats[1].hand).toBeNull();
        cast ||= session.view.stack.some((card) => card.name === 'Doomfall');
        if (cast && session.view.stack.length === 0) {
          const target = session.view.seats[0];
          const affected =
            target.exile.some((card) => card.name === 'Grizzly Bears') ||
            target.exile.some((card) => card.name === 'Lightning Bolt');
          if (affected) {
            resolved = true;
            break;
          }
        }
        trace.push(`${decision.kind}: ${decision.prompt}`);
        const move =
          (decision.kind === 'zone-card-selection'
            ? decision.options.find((option) =>
                option.targets.some((target) => target.name === 'Grizzly Bears'),
              )?.id
            : undefined) ??
          decision.options.find((option) => option.text === 'Pass priority')?.id ??
          decision.options.find((option) => option.id === 'combat-attackers-commit')?.id ??
          decision.options.find((option) => option.id === 'combat-blockers-commit')?.id ??
          decision.options.find((option) => option.text === 'Keep this hand')?.id ??
          decision.options.find((option) => option.text === 'Play first')?.id;
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.slice(-12).join('\n')).toBe(true);
      expect(resolved, trace.slice(-12).join('\n')).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
