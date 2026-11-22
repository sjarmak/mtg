/**
 * mtg-72fjo: a live LAN Commander game wedged when the host played Fortified
 * Village with a Forest in hand. `observed-scd-contract-witness.integration.test.ts`
 * already witnesses the same reveal-cost shape on Foreboding Ruins, but every
 * case there passes `diagnosticCardNames`, which routes through
 * `installedForgeDiagnosticScenarioBackend` (`validationPurpose:
 * 'catalog-discovery'`) — a scoped test/diagnostic route real LAN play never
 * takes. This file omits `diagnosticCardNames`, which dispatches to
 * `installedForgeScenarioBackend` instead: no `validationPurpose` at all, the
 * same unscoped condition a real observed table opens under. Before the fix
 * (`ForgeBridge.java`'s `reviewedHandRevealCost`), Fortified Village's
 * `UnlessCost Reveal<1/Forest,Plains>` fell through to
 * `payReviewedPreventEffectCost`'s throw on the Forge game thread, and this
 * suite is what proves it.
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

/**
 * Deliberately passes no `diagnosticCardNames`: this is the unscoped route a
 * real LAN table opens (no `validationPurpose`), where `supportsScopedContracts`
 * is always false in `ForgeBridge.java`.
 */
async function openLiveScenario(
  spec: SessionSpec,
  state: Parameters<typeof snapshotForgeScenarioBackend>[0],
) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(
    state,
    compiled ? { compiledBridgeClasses: compiled.classDirectory } : {},
  );
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec);
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

describe.skipIf(!required)('check-land reveal cost on the live (unscoped) route', () => {
  it('lets the host reveal a Forest so Fortified Village enters untapped, with no validationPurpose scoping', async () => {
    const running = await openLiveScenario(table('live-fortified-village-reveal-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 40,
          hand: ['Fortified Village', 'Forest'],
          battlefield: [],
          library: ['Swamp'],
          graveyard: [],
        },
        { life: 40, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
      ],
    });
    let session = running.session;
    const forest = session.view.seats[0].hand?.find((card) => card.name === 'Forest')?.oid;
    let played = false;
    let confirmed = false;
    let revealed = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Fortified Village decision');
        if (session.view.seats[0].battlefield.some((card) => card.name === 'Fortified Village')) break;
        trace.push(`${decision.kind}: ${decision.prompt} [${decision.options.map((o) => o.id).join(', ')}]`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !played) {
          move = decision.options.find((option) => option.text.startsWith('Play Fortified Village'))?.id;
          played = move !== undefined;
        } else if (decision.kind === 'confirm-payment') {
          expect(decision.prompt).toMatch(/Reveal a Forest or Plains card from your hand/u);
          move = decision.options.find((option) => option.id === 'confirm-payment-yes')?.id;
          confirmed = move !== undefined;
        } else if (decision.kind === 'cost-card-selection') {
          const cards = decision.options.filter((option) =>
            option.id.startsWith('cost-card-selection-card-'),
          );
          if (!revealed) {
            expect(cards.map((option) => option.targets[0]?.oid)).toEqual([forest]);
            move = cards[0]?.id;
            revealed = move !== undefined;
          } else move = decision.options.find((option) => option.id === 'cost-card-selection-done')?.id;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Fortified Village decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(played, trace.join('\n')).toBe(true);
      expect(confirmed, trace.join('\n')).toBe(true);
      expect(revealed, trace.join('\n')).toBe(true);
      const village = session.view.seats[0].battlefield.find((card) => card.name === 'Fortified Village');
      expect(village?.tapped, trace.join('\n')).toBe(false);
      expect(session.view.seats[0].hand?.map((card) => card.name)).toEqual(['Forest']);
      expect(session.view.seats[1].battlefield.some((card) => card.name === 'Fortified Village')).toBe(false);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);

  it('lets the host decline the reveal so Fortified Village enters tapped, with no validationPurpose scoping', async () => {
    const running = await openLiveScenario(table('live-fortified-village-decline-v1'), {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 40,
          hand: ['Fortified Village', 'Forest'],
          battlefield: [],
          library: ['Swamp'],
          graveyard: [],
        },
        { life: 40, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
      ],
    });
    let session = running.session;
    let played = false;
    let declined = false;
    const trace: string[] = [];
    try {
      for (let index = 0; index < 60 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Fortified Village decision');
        if (session.view.seats[0].battlefield.some((card) => card.name === 'Fortified Village')) break;
        trace.push(`${decision.kind}: ${decision.prompt} [${decision.options.map((o) => o.id).join(', ')}]`);
        let move: string | undefined;
        if (decision.kind === 'priority' && !played) {
          move = decision.options.find((option) => option.text.startsWith('Play Fortified Village'))?.id;
          played = move !== undefined;
        } else if (decision.kind === 'confirm-payment') {
          expect(decision.prompt).toMatch(/Reveal a Forest or Plains card from your hand/u);
          move = decision.options.find((option) => option.id === 'confirm-payment-no')?.id;
          declined = move !== undefined;
        } else move = routineMove(decision);
        if (move === undefined)
          throw new Error(`Unhandled Fortified Village decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(played, trace.join('\n')).toBe(true);
      expect(declined, trace.join('\n')).toBe(true);
      const village = session.view.seats[0].battlefield.find((card) => card.name === 'Fortified Village');
      expect(village?.tapped, trace.join('\n')).toBe(true);
      expect(session.view.seats[0].hand?.map((card) => card.name)).toEqual(['Forest']);
      expect(session.view.seats[1].battlefield.some((card) => card.name === 'Fortified Village')).toBe(false);
    } finally {
      await session.close();
      await running.backend.shutdown?.();
    }
  }, 180_000);
});
