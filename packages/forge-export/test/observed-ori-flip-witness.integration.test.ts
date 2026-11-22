/**
 * Real-Forge witness that Magic Origins' flip planeswalkers survive the bridge: each is a double-faced creature that
 * exiles itself and returns transformed as a planeswalker (`ChangeZone | Transformed$ True`), reached here by an
 * activated ability (Jace) and by a land trigger (Nissa). Kept apart from the scenario probe file on purpose.
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

function describeDecision(decision: Decision): string {
  return `${decision.kind}: ${decision.prompt} [${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}]`;
}

function table(seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'ori' },
    seats: [
      {
        name: 'Seat zero',
        controller: 'local',
        deck: { name: 'setup-zero', cards: [{ name: 'Forest', count: 60 }] },
      },
      {
        name: 'Seat one',
        controller: 'engine',
        deck: { name: 'setup-one', cards: [{ name: 'Plains', count: 60 }] },
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
      'Forest',
      'Island',
      'Plains',
      "Jace, Vryn's Prodigy",
      'Jace, Telepath Unbound',
      'Nissa, Vastwood Seer',
      'Nissa, Sage Animist',
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

describe.skipIf(!required)('ORI flip planeswalker witnesses', () => {
  it("flips Jace, Vryn's Prodigy into a planeswalker after a loot fills the graveyard", async () => {
    const running = await openScenario(table('ori-jace-flip-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: [],
          battlefield: ["Jace, Vryn's Prodigy"],
          library: ['Island', 'Island', 'Island'],
          graveyard: ['Forest', 'Forest', 'Forest', 'Forest'],
        },
        { life: 20, hand: [], battlefield: [], library: ['Plains', 'Plains', 'Plains'], graveyard: [] },
      ],
    });
    let session = running.session;
    const trace: string[] = [];
    let activated = false;
    let flipped = false;
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Jace decision');
        trace.push(describeDecision(decision));
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const ability = decision.options.find((option) => option.text.startsWith("Jace, Vryn's Prodigy:"));
          move = !activated
            ? ability?.id
            : decision.options.find((option) => option.text === 'Pass priority')?.id;
          activated ||= move !== undefined && move === ability?.id;
        } else if (
          decision.kind === 'entity-selection' ||
          decision.kind === 'confirm-action' ||
          decision.kind === 'hand-card-selection'
        ) {
          move = decision.options[0]?.id;
        }
        if (move === undefined) throw new Error(`Unhandled Jace decision\n${trace.join('\n')}`);
        trace.push(`  -> ${move}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
        if (
          activated &&
          session.view.seats[0].battlefield.some((card) => card.name.startsWith('Jace, Telepath'))
        ) {
          flipped = true;
          break;
        }
      }
      expect(activated, trace.join('\n')).toBe(true);
      expect(flipped, trace.join('\n')).toBe(true);
      const back = session.view.seats[0].battlefield.find((card) => card.name.startsWith('Jace, Telepath'));
      expect(back?.typeLine, trace.join('\n')).toContain('Planeswalker');
      expect(
        session.view.seats[0].battlefield.some((card) => card.name === "Jace, Vryn's Prodigy"),
        trace.join('\n'),
      ).toBe(false);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('flips Nissa, Vastwood Seer into a planeswalker when the seventh land enters', async () => {
    const running = await openScenario(table('ori-nissa-flip-local-contract-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: ['Forest'],
          battlefield: ['Nissa, Vastwood Seer', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'],
          library: ['Forest', 'Forest', 'Forest'],
          graveyard: [],
        },
        { life: 20, hand: [], battlefield: [], library: ['Plains', 'Plains', 'Plains'], graveyard: [] },
      ],
    });
    let session = running.session;
    const trace: string[] = [];
    let played = false;
    let flipped = false;
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Nissa decision');
        trace.push(describeDecision(decision));
        let move: string | undefined;
        if (decision.kind === 'priority') {
          const land = decision.options.find((option) => option.text === 'Play Forest');
          move = !played ? land?.id : decision.options.find((option) => option.text === 'Pass priority')?.id;
          played ||= move !== undefined && move === land?.id;
        } else if (decision.kind === 'entity-selection' || decision.kind === 'confirm-action') {
          move = decision.options[0]?.id;
        }
        if (move === undefined) throw new Error(`Unhandled Nissa decision\n${trace.join('\n')}`);
        trace.push(`  -> ${move}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
        if (played && session.view.seats[0].battlefield.some((card) => card.name.startsWith('Nissa, Sage'))) {
          flipped = true;
          break;
        }
      }
      expect(played, trace.join('\n')).toBe(true);
      expect(flipped, trace.join('\n')).toBe(true);
      const back = session.view.seats[0].battlefield.find((card) => card.name.startsWith('Nissa, Sage'));
      expect(back?.typeLine, trace.join('\n')).toContain('Planeswalker');
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
