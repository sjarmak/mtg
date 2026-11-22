/**
 * `mtg-in4k9`: `ObjectView.pairedWith`, the Forge arm.
 *
 * Soulbond pairs two creatures and the board had no way to say which. The
 * witness pairs Silverblade Paladin with Thraben Valiant through the real
 * soulbond offer, asserts both creatures name each other in the projected view,
 * then destroys the Valiant and asserts the Paladin is unpaired again. Silverblade
 * Paladin grants double strike to the pair, so it is also the case `keywords`
 * exists for (`mtg-pt9dp`): the granted keyword is on both creatures while they
 * are bonded and gone from the survivor when they are not.
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

const SOULBOND = 'Silverblade Paladin';
const PARTNER = 'Thraben Valiant';
const REMOVAL = 'Human Frailty';

const table: SessionSpec = {
  content: { kind: 'printed', format: 'avr' },
  seats: [
    {
      name: 'Seat zero',
      controller: 'local',
      deck: { name: 'zero', cards: [{ name: 'Plains', count: 60 }] },
    },
    { name: 'Seat one', controller: 'engine', deck: { name: 'one', cards: [{ name: 'Plains', count: 60 }] } },
  ],
  seed: 'observed-pairing-mtg-in4k9',
  maximumTurns: 3,
};

function onBattlefield(session: ObservedSession, name: string): ObjectView | undefined {
  return session.view.seats[0].battlefield.find((card) => card.name === name);
}

function mustFind(session: ObservedSession, name: string): ObjectView {
  const found = onBattlefield(session, name);
  if (found === undefined) throw new Error(`${name} is not on seat zero's battlefield`);
  return found;
}

describe.skipIf(!required)('Forge projects which two creatures a soulbond pair holds', () => {
  it('names each creature on the other, and clears the survivor when its partner leaves', async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const empty = {
      life: 20,
      hand: [] as string[],
      library: Array<string>(20).fill('Plains'),
      battlefield: [] as string[],
      graveyard: [] as string[],
    };
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1 as const,
        active: 0 as const,
        phase: 'MAIN1' as const,
        seats: [
          {
            ...empty,
            hand: [SOULBOND, REMOVAL],
            battlefield: ['Plains', 'Plains', 'Plains', 'Swamp', PARTNER],
          },
          empty,
        ],
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

      expect(mustFind(session, PARTNER).pairedWith).toBeUndefined();

      let castSoulbond = false;
      let paired = false;
      let castRemoval = false;
      let sawRemovalOnStack = false;
      let cleared = false;
      for (let index = 0; index < 200 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        trace.push(
          `${session.view.turn.step} ${decision.kind}: ${decision.options.map((o) => o.text).join(' | ')}`,
        );

        const soulbond = onBattlefield(session, SOULBOND);
        const partner = onBattlefield(session, PARTNER);
        if (soulbond !== undefined && partner !== undefined && !paired && soulbond.pairedWith !== undefined) {
          expect(soulbond.pairedWith, trace.join('\n')).toBe(partner.oid);
          expect(partner.pairedWith, trace.join('\n')).toBe(soulbond.oid);
          // Silverblade Paladin gives the pair double strike: the keyword is on
          // both creatures for as long as they are bonded.
          expect(soulbond.keywords, trace.join('\n')).toContain('double strike');
          expect(partner.keywords, trace.join('\n')).toContain('double strike');
          paired = true;
        }
        if (session.view.stack.length > 0 && castRemoval) sawRemovalOnStack = true;
        if (sawRemovalOnStack && session.view.stack.length === 0 && soulbond !== undefined) {
          expect(partner, trace.join('\n')).toBeUndefined();
          expect(soulbond.pairedWith, trace.join('\n')).toBeUndefined();
          expect(soulbond.keywords, trace.join('\n')).not.toContain('double strike');
          cleared = true;
          break;
        }

        let move: string | undefined;
        if (decision.kind === 'priority') {
          const wanted = !castSoulbond ? SOULBOND : paired && !castRemoval ? REMOVAL : undefined;
          const cast =
            wanted === undefined ? undefined : decision.options.find((o) => o.text.startsWith(`${wanted}:`));
          if (cast !== undefined) {
            move = cast.id;
            if (wanted === SOULBOND) castSoulbond = true;
            else castRemoval = true;
          } else move = decision.options.find((option) => option.text === 'Pass priority')?.id;
        } else if (decision.kind === 'mana-payment') {
          // The Swamp is the only black source, so the Paladin's generic mana is
          // paid from Plains and the removal spell keeps the {B} it needs.
          const sources = decision.options.filter((option) => option.id.startsWith('mana-source-'));
          move = (castRemoval ? sources[0] : (sources.find((o) => !o.text.includes('Swamp')) ?? sources[0]))
            ?.id;
        } else if (decision.kind === 'combat-attackers') {
          move = 'combat-attackers-commit';
        } else if (decision.kind === 'combat-blockers') {
          move = 'combat-blockers-commit';
        } else {
          // The soulbond offer and the removal target both name the Valiant.
          move = (
            decision.options.find((option) => option.targets.some((target) => target.oid === partner?.oid)) ??
            decision.options[0]
          )?.id;
        }
        if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
        session = advanced.session;
      }

      expect(paired, trace.join('\n')).toBe(true);
      expect(cleared, trace.join('\n')).toBe(true);
    } finally {
      await session?.close();
      await backend.shutdown?.();
    }
  }, 180_000);
});
