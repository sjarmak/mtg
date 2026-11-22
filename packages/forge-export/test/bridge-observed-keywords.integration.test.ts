/**
 * `mtg-pt9dp`: `ObjectView.keywords`, the Forge arm.
 *
 * Snare the Skies gives one creature reach until end of turn. Neither creature
 * prints reach, so before this field the board had no source for it anywhere;
 * the witness asserts the keyword appears on the creature that received the
 * grant, not on the one beside it, and is gone once the turn has ended.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObjectView, ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const TARGET = 'Nettle Swine';
const BYSTANDER = 'Vorstclaw';
const SPELL = 'Snare the Skies';

const table: SessionSpec = {
  content: { kind: 'printed', format: 'avr' },
  seats: [
    {
      name: 'Seat zero',
      controller: 'local',
      deck: { name: 'zero', cards: [{ name: 'Forest', count: 60 }] },
    },
    { name: 'Seat one', controller: 'engine', deck: { name: 'one', cards: [{ name: 'Forest', count: 60 }] } },
  ],
  seed: 'observed-keywords-mtg-pt9dp',
  maximumTurns: 3,
};

function battlefieldObject(session: ObservedSession, name: string): ObjectView {
  const found = session.view.seats[0].battlefield.find((card) => card.name === name);
  if (found === undefined) throw new Error(`${name} is not on seat zero's battlefield`);
  return found;
}

describe.skipIf(!required)('Forge projects the keywords a permanent has right now', () => {
  it('shows a granted keyword on the creature that received it and clears it when the turn ends', async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const empty = {
      life: 20,
      hand: [] as string[],
      library: Array<string>(20).fill('Forest'),
      battlefield: [] as string[],
      graveyard: [] as string[],
    };
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1 as const,
        active: 0 as const,
        phase: 'MAIN1' as const,
        seats: [{ ...empty, hand: [SPELL], battlefield: ['Forest', TARGET, BYSTANDER] }, empty],
      },
      compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
    );
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      const scenarioTurn = session.view.turn.number;

      // Reporting backends write the field on every permanent, empty when none.
      expect(battlefieldObject(session, TARGET).keywords).toEqual([]);
      expect(battlefieldObject(session, BYSTANDER).keywords).toEqual([]);

      let cast = false;
      let sawSpellOnStack = false;
      let grantedWhileActive: readonly string[] | undefined;
      let bystanderWhileGranted: readonly string[] | undefined;
      let clearedNextTurn = false;
      for (let index = 0; index < 160 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        const swine = battlefieldObject(session, TARGET);
        if (session.view.stack.length > 0) sawSpellOnStack = true;
        // The spell has been on the stack and has resolved: the grant is live.
        if (sawSpellOnStack && grantedWhileActive === undefined && session.view.stack.length === 0) {
          grantedWhileActive = swine.keywords;
          bystanderWhileGranted = battlefieldObject(session, BYSTANDER).keywords;
        }
        if (grantedWhileActive !== undefined && session.view.turn.number > scenarioTurn) {
          expect(swine.keywords, trace.join('\n')).toEqual([]);
          clearedNextTurn = true;
          break;
        }
        trace.push(`${session.view.turn.number}/${session.view.turn.step} ${decision.kind}`);
        let move: string | undefined;
        if (decision.kind === 'priority') {
          move =
            (!cast
              ? decision.options.find((option) => option.text.startsWith(`${SPELL}:`))?.id
              : undefined) ?? decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (
            move !== undefined &&
            decision.options.find((option) => option.id === move)?.text.startsWith(`${SPELL}:`)
          )
            cast = true;
        } else if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = 'combat-attackers-commit';
        } else if (decision.kind === 'combat-blockers') {
          move = 'combat-blockers-commit';
        } else {
          move = (
            decision.options.find((option) => option.targets.some((target) => target.oid === swine.oid)) ??
            decision.options[0]
          )?.id;
        }
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }

      expect(grantedWhileActive, trace.join('\n')).toEqual(['reach']);
      expect(bystanderWhileGranted, trace.join('\n')).toEqual([]);
      expect(clearedNextTurn, trace.join('\n')).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 120_000);
});
