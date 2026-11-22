/** Installed-Forge proof for Satyr Wayfinder's exact optional four-card Dig. */
import { expect, it } from 'vitest';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

interface Scenario {
  readonly name: string;
  readonly seed: string;
  readonly cards: SessionSpec['seats'][number]['deck']['cards'];
  readonly chooseLand: boolean;
  readonly expectedRevealed: number;
  readonly requireNonlandRemainder: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'choose',
    seed: 'z5q4-satyr-wayfinder-choose-exact-land',
    cards: [
      { name: 'Forest', count: 40 },
      { name: 'Satyr Wayfinder', count: 20 },
    ],
    chooseLand: true,
    expectedRevealed: 4,
    requireNonlandRemainder: true,
  },
  {
    name: 'decline',
    seed: 'z5q4-satyr-wayfinder-decline-exact-land',
    cards: [
      { name: 'Forest', count: 40 },
      { name: 'Satyr Wayfinder', count: 20 },
    ],
    chooseLand: false,
    expectedRevealed: 4,
    requireNonlandRemainder: false,
  },
  {
    name: 'short library',
    seed: 'z5q4-satyr-wayfinder-short-library',
    cards: [
      { name: 'Forest', count: 6 },
      { name: 'Satyr Wayfinder', count: 4 },
    ],
    chooseLand: false,
    expectedRevealed: 1,
    requireNonlandRemainder: false,
  },
] as const;

function tableFor(scenario: Scenario): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Wayfinder ${scenario.name}`,
        controller: 'local',
        deck: { name: `satyr-wayfinder-${scenario.name}`, cards: scenario.cards },
      },
      {
        name: 'Passive opponent',
        controller: 'local',
        deck: { name: 'passive-mountains', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: scenario.seed,
    maximumTurns: 12,
  };
}

async function runScenario(backend: ObservedBackend, scenario: Scenario): Promise<void> {
  const table = tableFor(scenario);
  expect(await backend.supports(table)).toEqual([]);
  const opened = await backend.open(table);
  if (!opened.ok) throw new Error(opened.error.message);
  let session: ObservedSession = opened.session;
  const trace: string[] = [];
  let cast = false;
  let libraryBeforeDig: number | null = null;
  let graveyardBefore = new Set<string>();
  let selectedLand: string | null = null;
  let sawChoice = false;
  let inventedRejected = false;
  let staleRejected = false;
  let resolved = false;
  try {
    for (let submitted = 0; session.status === 'awaiting' && submitted < 700; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Satyr Wayfinder decision');
      const pilot = session.view.seats[0];
      const newGraveyard = pilot.graveyard.filter((card) => !graveyardBefore.has(card.oid));
      const expectedGraveyard = scenario.chooseLand
        ? scenario.expectedRevealed - 1
        : scenario.expectedRevealed;
      resolved ||=
        sawChoice &&
        !session.view.stack.some((card) => card.name === 'Satyr Wayfinder') &&
        pilot.battlefield.some((card) => card.name === 'Satyr Wayfinder') &&
        newGraveyard.length === expectedGraveyard &&
        (selectedLand === null || pilot.hand?.some((card) => card.oid === selectedLand) === true);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move = decision.options.find(
        (option) =>
          option.text === 'Play first' ||
          option.text === 'Keep this hand' ||
          (decision.kind === 'priority' && option.text === 'Pass priority') ||
          option.id === 'combat-attackers-commit' ||
          option.id === 'combat-blockers-commit',
      )?.id;
      let staleMove: string | null = null;
      const staleSession = session;

      if (decision.kind === 'mana-payment') {
        move = decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
      } else if (decision.kind === 'entity-selection') {
        expect(decision.seat).toBe(0);
        const candidates = decision.options.filter((option) => option.targets.length === 1);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates.length).toBeLessThanOrEqual(scenario.expectedRevealed);
        expect(candidates.every((option) => option.targets[0]?.name === 'Forest')).toBe(true);
        expect(decision.options.some((option) => option.id === 'entity-selection-done')).toBe(true);
        if (!inventedRejected) {
          await expect(session.submit('entity-selection-forge-card-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        const chosen = candidates[0];
        const done = decision.options.find((option) => option.id === 'entity-selection-done');
        if (chosen === undefined || done === undefined) throw new Error('Missing exact Wayfinder choice');
        selectedLand = scenario.chooseLand ? (chosen.targets[0]?.oid ?? null) : null;
        move = scenario.chooseLand ? chosen.id : done.id;
        staleMove = move;
        sawChoice = true;
      } else if (decision.kind === 'priority') {
        if (resolved) {
          move = decision.options.find((option) => option.text === 'Concede')?.id;
        } else if (decision.seat === 0) {
          move = decision.options.find((option) => option.text === 'Play Forest')?.id ?? move;
          const castOption = decision.options.find((option) => option.text.startsWith('Satyr Wayfinder:'));
          if (
            !cast &&
            castOption !== undefined &&
            pilot.battlefield.filter((card) => card.name === 'Forest').length >= 2
          ) {
            cast = true;
            libraryBeforeDig = pilot.librarySize;
            graveyardBefore = new Set(pilot.graveyard.map((card) => card.oid));
            move = castOption.id;
          }
        } else {
          move = decision.options.find((option) => option.text === 'Play Mountain')?.id ?? move;
        }
      }
      if (move === undefined) throw new Error(`Unhandled decision: ${decision.kind}`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(advanced.error.message);
      session = advanced.session;
      if (staleMove !== null) {
        await expect(staleSession.submit(staleMove)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
      }
    }

    const pilot = session.view.seats[0];
    const newGraveyard = pilot.graveyard.filter((card) => !graveyardBefore.has(card.oid));
    expect(cast).toBe(true);
    expect(libraryBeforeDig).not.toBeNull();
    expect(Math.min(4, libraryBeforeDig ?? 0)).toBe(scenario.expectedRevealed);
    expect(sawChoice).toBe(true);
    expect(inventedRejected).toBe(true);
    expect(staleRejected).toBe(true);
    expect(resolved).toBe(true);
    expect(new Set(newGraveyard.map((card) => card.oid)).size).toBe(newGraveyard.length);
    expect(newGraveyard).toHaveLength(
      scenario.chooseLand ? scenario.expectedRevealed - 1 : scenario.expectedRevealed,
    );
    if (scenario.requireNonlandRemainder) {
      expect(newGraveyard.some((card) => card.name === 'Satyr Wayfinder')).toBe(true);
    }
  } catch (cause) {
    throw new Error(`${scenario.name}: ${String(cause)}\n${trace.slice(-120).join('\n')}`, { cause });
  } finally {
    await session.close();
  }
}

forgeIt(
  'selects or declines an exact land and handles fewer than four library cards',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    try {
      for (const scenario of SCENARIOS) await runScenario(backend, scenario);
    } finally {
      await backend.shutdown?.();
    }
  },
  420_000,
);
