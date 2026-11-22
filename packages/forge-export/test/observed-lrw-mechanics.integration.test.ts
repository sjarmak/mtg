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
  content: { kind: 'printed', format: 'lrw' },
  seats: [
    { name: 'Caster', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Plains', count: 60 }] } },
    {
      name: 'Opponent',
      controller: 'local',
      deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] },
    },
  ],
  seed: 'lrw-reveal-cost-v1',
  maximumTurns: 2,
};

describe.skipIf(!required)('Lorwyn mechanics', () => {
  it('casts Goldmeadow Stalwart by revealing the exact Kithkin card', async () => {
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
            hand: ['Goldmeadow Stalwart', 'Goldmeadow Dodger'],
            battlefield: ['Plains'],
            library: ['Plains'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
        ],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    let cast = false;
    let revealed = false;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Goldmeadow Stalwart decision');
        const resolved = session.view.seats[0].battlefield.some(
          (card) => card.name === 'Goldmeadow Stalwart',
        );
        if (resolved) break;
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Goldmeadow Stalwart:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'cost-card-selection') {
          expect(
            decision.options.flatMap((option) => option.targets).map((target) => target.name),
          ).not.toContain('Goldmeadow Stalwart');
          move = !revealed
            ? decision.options.find((option) => option.targets[0]?.name === 'Goldmeadow Dodger')?.id
            : decision.options.find((option) => option.id === 'cost-card-selection-done')?.id;
          revealed ||= move !== undefined && move !== 'cost-card-selection-done';
        } else if (decision.kind === 'ability-selection') {
          move = decision.options.find((option) => option.text.includes('Additional cost: Reveal'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        }
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(revealed, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].battlefield.map((card) => card.name)).toContain('Goldmeadow Stalwart');
      expect(session.view.seats[0].hand?.map((card) => card.name)).toEqual(['Goldmeadow Dodger']);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it('resolves Thoughtseize through a targeted revealed-hand choice', async () => {
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
            hand: ['Thoughtseize', 'Grizzly Bears', 'Forest'],
            battlefield: ['Swamp'],
            library: ['Swamp'],
            graveyard: [],
          },
          {
            life: 20,
            hand: ['Grizzly Bears', 'Forest'],
            battlefield: [],
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
    const trace: string[] = [];
    try {
      const opened = await backend.open({ ...table, seed: 'lrw-thoughtseize-v1' });
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
        if (session.view.seats[0].graveyard.some((card) => card.name === 'Grizzly Bears')) break;
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Thoughtseize decision');
        trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move = !cast
            ? decision.options.find((option) => option.text.startsWith('Thoughtseize:'))?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move !== 'priority-pass';
        } else if (decision.kind === 'target-selection') {
          move = decision.options.find((option) => option.text.startsWith('Target Caster'))?.id;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'revealed-hand-discard-selection') {
          expect(decision.seat).toBe(0);
          expect(decision.options.map((option) => option.targets[0]?.name)).toEqual(['Grizzly Bears']);
          move = decision.options.find((option) => option.targets[0]?.name === 'Grizzly Bears')?.id;
        }
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(
        session.view.seats[0].graveyard.map((card) => card.name),
        trace.join('\n'),
      ).toContain('Grizzly Bears');
      expect(session.view.seats[0].life).toBe(18);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);

  it.each([
    ['Goldmeadow Dodger', true],
    ['decline', false],
  ] as const)(
    'resolves Thoughtweft Trio Champion by choosing %s',
    async (selection, retained) => {
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
              hand: ['Thoughtweft Trio'],
              battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Goldmeadow Dodger'],
              library: ['Plains'],
              graveyard: [],
            },
            { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
          ],
        },
        compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
      );
      if (backend === null) throw new Error('Installed Forge required');
      let session: ObservedSession | undefined;
      let cast = false;
      let championResolved = false;
      const trace: string[] = [];
      try {
        const opened = await backend.open({ ...table, seed: `lrw-champion-${selection}-v1` });
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
          const battlefield = session.view.seats[0].battlefield.map((card) => card.name);
          const resolved =
            championResolved &&
            (retained
              ? battlefield.includes('Thoughtweft Trio') && !battlefield.includes('Goldmeadow Dodger')
              : !battlefield.includes('Thoughtweft Trio'));
          if (resolved) break;
          const decision = session.decision;
          if (decision === null) throw new Error('Missing Champion decision');
          trace.push(`${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`);
          let move: string | undefined;
          if (decision.kind === 'priority') {
            move = !cast
              ? decision.options.find((option) => option.text.startsWith('Thoughtweft Trio:'))?.id
              : decision.options.find((option) => option.text === 'Pass priority')?.id;
            cast ||= move !== undefined && move !== 'priority-pass';
          } else if (decision.kind === 'mana-payment') {
            move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
          } else if (decision.kind === 'confirm-action') {
            move = decision.options.find((option) => option.text === 'Yes')?.id;
          } else if (decision.kind === 'zone-card-selection') {
            expect(decision.options.some((option) => option.id === 'zone-decline')).toBe(true);
            expect(decision.options.flatMap((option) => option.targets.map((target) => target.name))).toEqual(
              ['Goldmeadow Dodger'],
            );
            move = decision.options.find((option) =>
              selection === 'decline' ? option.id === 'zone-decline' : option.targets[0]?.name === selection,
            )?.id;
          }
          if (move === undefined) throw new Error(`Unhandled decision\n${trace.slice(-8).join('\n')}`);
          const advanced = await session.submit(move);
          if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
          session = advanced.session;
          championResolved ||= decision.kind === 'zone-card-selection';
        }
        const local = session.view.seats[0];
        const battlefield = local.battlefield.map((card) => card.name);
        const exile = local.exile.map((card) => card.name);
        const graveyard = local.graveyard.map((card) => card.name);
        if (retained) {
          expect(battlefield, trace.join('\n')).toContain('Thoughtweft Trio');
          expect(battlefield, trace.join('\n')).not.toContain('Goldmeadow Dodger');
          expect(exile, trace.join('\n')).toContain('Goldmeadow Dodger');
          expect(graveyard, trace.join('\n')).not.toContain('Thoughtweft Trio');
        } else {
          expect(battlefield, trace.join('\n')).not.toContain('Thoughtweft Trio');
          expect(battlefield, trace.join('\n')).toContain('Goldmeadow Dodger');
          expect(exile, trace.join('\n')).not.toContain('Goldmeadow Dodger');
          expect(graveyard, trace.join('\n')).toContain('Thoughtweft Trio');
        }
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    },
    180_000,
  );
});
