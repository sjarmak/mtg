/** Night Terrors exposes one reviewed choice from the targeted revealed hand. */
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
  content: { kind: 'printed', format: 'isd' },
  seats: [
    {
      name: 'Caster',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Swamp', count: 60 }] },
    },
    {
      name: 'Target',
      controller: 'engine',
      deck: { name: 'setup', cards: [{ name: 'Forest', count: 60 }] },
    },
  ],
  seed: 'isd-night-terrors-revealed-hand-v1',
  maximumTurns: 3,
};

describe.skipIf(!required)('Night Terrors revealed-hand selection', () => {
  it('offers and exiles the nonland card while keeping the rest of the hand hidden', async () => {
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
            hand: ['Night Terrors'],
            battlefield: ['Swamp', 'Swamp', 'Swamp'],
            library: [],
            graveyard: [],
          },
          {
            life: 20,
            hand: ['Geistflame', 'Forest'],
            battlefield: [],
            library: ['Forest'],
            graveyard: [],
          },
        ],
      },
      {
        ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
        diagnosticCardNames: ['Forest', 'Geistflame', 'Night Terrors', 'Swamp'],
      },
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
        if (decision === null) throw new Error('Missing Night Terrors decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        if (
          selected !== undefined &&
          session.view.seats[1].exile.some((card) => card.oid === selected) &&
          session.view.stack.length === 0
        )
          break;
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const option = decision.options.find((entry) => entry.text.startsWith('Night Terrors:'));
          move = !cast ? option?.id : decision.options.find((entry) => entry.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move === option?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.id === 'target-player-1')?.id;
        } else if (decision.kind === 'zone-card-selection') {
          expect(decision.seat).toBe(0);
          expect(decision.prompt).toContain('Geistflame');
          expect(decision.prompt).toContain('Forest');
          expect(decision.options.map((option) => option.targets[0]?.name)).toEqual(['Geistflame']);
          selected = decision.options[0]?.targets[0]?.oid;
          move = decision.options[0]?.id;
        }
        if (move === undefined)
          throw new Error(`Unhandled Night Terrors decision\n${trace.slice(-10).join('\n')}`);
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
});
