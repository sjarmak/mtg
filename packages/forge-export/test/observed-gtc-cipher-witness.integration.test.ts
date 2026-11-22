/** Real-Forge witness that Gatecrash's cipher reaches the controller contracts: encode, connect, cast the copy. */
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

const table: SessionSpec = {
  content: { kind: 'printed', format: 'gtc' },
  seats: [
    {
      name: 'Seat zero',
      controller: 'local',
      deck: { name: 'setup-zero', cards: [{ name: 'Island', count: 60 }] },
    },
    {
      name: 'Seat one',
      controller: 'engine',
      deck: { name: 'setup-one', cards: [{ name: 'Plains', count: 60 }] },
    },
  ],
  seed: 'gtc-last-thoughts-cipher-local-contract-v1',
  maximumTurns: 3,
};

describe.skipIf(!required)('GTC cipher witness', () => {
  it('lets the local seat encode Last Thoughts, connect with the encoded creature and cast the copy', async () => {
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
            hand: ['Last Thoughts'],
            battlefield: ['Island', 'Island', 'Island', 'Island', 'Gutter Skulk', 'Gutter Skulk'],
            library: ['Island', 'Island', 'Island', 'Island'],
            graveyard: [],
          },
          { life: 20, hand: [], battlefield: [], library: ['Plains', 'Plains', 'Plains'], graveyard: [] },
        ],
      },
      {
        ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
        diagnosticCardNames: ['Island', 'Plains', 'Last Thoughts', 'Gutter Skulk'],
      },
    );
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open(table);
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session = opened.session;
    let cast = false;
    let encodeOffered = false;
    let encoded = false;
    let attacked = false;
    let copyOffered = false;
    let copyAccepted = false;
    let copyOnStack = false;
    let copyResolved = false;
    let handBeforeCopy = -1;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 120 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing cipher decision');
        trace.push(describeDecision(decision));
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move =
            decision.options.find((option) => option.text.startsWith('Last Thoughts:'))?.id ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= move !== undefined && move.startsWith('ability-');
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'confirm-action') {
          expect(decision.prompt, trace.join('\n')).toContain('exile Last Thoughts and encode it');
          encodeOffered = true;
          move = 'confirm-action-yes';
        } else if (decision.kind === 'entity-selection') {
          expect(decision.prompt, trace.join('\n')).toContain('Choose a creature you control to encode');
          move =
            decision.options.find((option) => option.targets[0] !== undefined)?.id ?? decision.options[0]?.id;
          encoded ||= move !== undefined;
        } else if (decision.kind === 'combat-attackers') {
          move =
            decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id ??
            'combat-attackers-commit';
          attacked ||= move === 'combat-attackers-commit' && decision.options.length === 1;
        } else if (decision.kind === 'combat-blockers') move = 'combat-blockers-commit';
        else if (decision.kind === 'confirm-trigger') {
          expect(decision.prompt, trace.join('\n')).toContain('cast a copy of Last Thoughts');
          copyOffered = true;
          move = 'confirm-trigger-yes';
          copyAccepted = true;
          handBeforeCopy = session.view.seats[0].hand?.length ?? -1;
        }
        if (move === undefined) throw new Error(`Unhandled cipher decision\n${trace.join('\n')}`);
        trace.push(`  -> ${move}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
        attacked ||= session.view.seats[1].life < 20;
        if (copyAccepted) {
          copyOnStack ||= session.view.stack.some((card) => card.name === 'Last Thoughts');
          if (copyOnStack && session.view.stack.length === 0) {
            copyResolved = true;
            break;
          }
        }
      }
      expect(cast, trace.join('\n')).toBe(true);
      expect(encodeOffered, trace.join('\n')).toBe(true);
      expect(encoded, trace.join('\n')).toBe(true);
      expect(attacked, trace.join('\n')).toBe(true);
      expect(copyOffered, trace.join('\n')).toBe(true);
      expect(copyAccepted, trace.join('\n')).toBe(true);
      expect(copyResolved, trace.join('\n')).toBe(true);
      expect(session.view.seats[1].life, trace.join('\n')).toBeLessThan(20);
      expect(handBeforeCopy, trace.join('\n')).toBeGreaterThanOrEqual(0);
      expect(session.view.seats[0].hand?.length, trace.join('\n')).toBe(handBeforeCopy + 1);
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
