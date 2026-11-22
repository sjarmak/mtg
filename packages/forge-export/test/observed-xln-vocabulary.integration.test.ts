/**
 * Real-Forge evidence for the Ixalan vocabulary the lane brief names: a permanent that transforms into a land,
 * Explore's two branches, and Ascend's city's blessing. Not a qualification probe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PendingDecision, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const REVEAL_LAND = 'Forest';
const REVEAL_NONLAND = 'Rampaging Ferocidon';

function table(seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'xln' },
    seats: [
      {
        name: 'Seat zero',
        controller: 'local',
        deck: { name: 'setup-zero', cards: [{ name: 'Forest', count: 60 }] },
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

const repeat = (name: string, count: number): string[] => Array.from({ length: count }, () => name);

async function openScenario(
  seed: string,
  seat: { hand: string[]; battlefield: string[]; library: string[] },
  diagnosticCardNames: string[],
) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(
    {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        { life: 20, graveyard: [], ...seat },
        { life: 20, hand: [], battlefield: [], library: ['Swamp'], graveyard: [] },
      ],
    },
    { ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}), diagnosticCardNames },
  );
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(table(seed));
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

type Running = Awaited<ReturnType<typeof openScenario>>;
type Session = Running['session'];

const pass = (decision: PendingDecision): string | undefined =>
  decision.options.find((option) => option.text === 'Pass priority')?.id;

/** Drive the session one decision at a time; `choose` returns a move, or undefined to fall back to passing. */
async function drive(
  running: Running,
  choose: (decision: PendingDecision, session: Session) => string | undefined | 'stop',
  steps: number,
): Promise<{ session: Session; trace: string[] }> {
  let session = running.session;
  const trace: string[] = [];
  for (let index = 0; index < steps && session.status === 'awaiting'; index += 1) {
    const decision = session.decision;
    if (decision === null) throw new Error('Missing decision');
    const picked = choose(decision, session);
    if (picked === 'stop') break;
    const move = picked ?? pass(decision);
    trace.push(`${decision.kind}: ${decision.prompt} -> ${move}`);
    if (move === undefined) throw new Error(`Unhandled decision\n${trace.join('\n')}`);
    const advanced = await session.submit(move);
    if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.join('\n')}`);
    session = advanced.session;
  }
  return { session, trace };
}

async function finish(running: Running, session: Session): Promise<void> {
  await session.close();
  await running.backend.shutdown?.();
}

describe.skipIf(!required)('XLN vocabulary', () => {
  it('transforms Thaumatic Compass into the land Spires of Orazca at the end step', async () => {
    const running = await openScenario(
      'xln-transform-land-v1',
      { hand: [], battlefield: ['Thaumatic Compass', ...repeat('Forest', 7)], library: repeat('Forest', 5) },
      ['Thaumatic Compass', 'Spires of Orazca', 'Forest', 'Swamp'],
    );
    let last: Session = running.session;
    try {
      const compassSlot = (session: Session) =>
        session.view.seats[0].battlefield.filter(
          (card) => card.name === 'Thaumatic Compass' || card.name === 'Spires of Orazca',
        );
      expect(compassSlot(last).map((card) => card.name)).toEqual(['Thaumatic Compass']);
      const { session, trace } = await drive(
        running,
        (_decision, current) =>
          compassSlot(current).some((card) => card.name === 'Spires of Orazca') ? 'stop' : undefined,
        40,
      );
      last = session;
      const flipped = compassSlot(session);
      expect(flipped, trace.join('\n')).toHaveLength(1);
      expect(flipped[0]).toMatchObject({ name: 'Spires of Orazca' });
      expect(flipped[0]?.typeLine.startsWith('Land')).toBe(true);
      expect(flipped[0]?.typeLine.includes('Artifact')).toBe(false);
      // Eight lands now: the seven Forests and the flipped permanent, which is a land the seat owns and controls.
      expect(session.view.seats[0].battlefield.filter((card) => card.typeLine.includes('Land'))).toHaveLength(
        8,
      );
    } finally {
      await finish(running, last);
    }
  }, 240_000);

  it.each([
    {
      title: 'a land reveal goes to hand and leaves the creature 2/1',
      top: REVEAL_LAND,
      power: 2,
      toughness: 1,
    },
    {
      title: 'a nonland reveal puts a +1/+1 counter on the creature',
      top: REVEAL_NONLAND,
      power: 3,
      toughness: 2,
    },
  ])(
    'Explore: $title',
    async ({ top, power, toughness }) => {
      const running = await openScenario(
        `xln-explore-${top === REVEAL_LAND ? 'land' : 'nonland'}-v1`,
        { hand: ['Merfolk Branchwalker'], battlefield: repeat('Forest', 2), library: repeat(top, 4) },
        ['Merfolk Branchwalker', REVEAL_LAND, REVEAL_NONLAND, 'Swamp'],
      );
      let last: Session = running.session;
      try {
        let cast = false;
        const { session, trace } = await drive(
          running,
          (decision, current) => {
            const creature = current.view.seats[0].battlefield.find(
              (card) => card.name === 'Merfolk Branchwalker',
            );
            if (decision.kind === 'mana-payment')
              return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
            if (creature !== undefined) {
              if (decision.kind === 'priority') {
                // Keep passing until the trigger has resolved: the land branch fills the hand, the nonland branch counters.
                const resolved =
                  top === REVEAL_LAND
                    ? (current.view.seats[0].hand ?? []).some((card) => card.name === REVEAL_LAND)
                    : (creature.counters['P1P1'] ?? 0) >= 1;
                return resolved ? 'stop' : undefined;
              }
              // Any other decision here is the nonland branch's "graveyard or top of library" choice.
              return (
                decision.options.find((option) => option.text.toLowerCase().includes('graveyard'))?.id ??
                decision.options[0]?.id
              );
            }
            if (decision.kind === 'priority' && !cast) {
              const move = decision.options.find((option) =>
                option.text.includes('Merfolk Branchwalker'),
              )?.id;
              if (move !== undefined) cast = true;
              return move;
            }
            return undefined;
          },
          30,
        );
        last = session;
        const creature = session.view.seats[0].battlefield.find(
          (card) => card.name === 'Merfolk Branchwalker',
        );
        expect(creature, trace.join('\n')).toBeDefined();
        expect({ power: creature?.power, toughness: creature?.toughness }, trace.join('\n')).toEqual({
          power,
          toughness,
        });
        const hand = session.view.seats[0].hand ?? [];
        if (top === REVEAL_LAND)
          expect(
            hand.map((card) => card.name),
            trace.join('\n'),
          ).toContain(REVEAL_LAND);
        else expect(creature?.counters, trace.join('\n')).toMatchObject({ P1P1: 1 });
      } finally {
        await finish(running, last);
      }
    },
    240_000,
  );

  it.each([
    { title: 'ten permanents give the blessing, so the draw ability is offered', forests: 9, offered: true },
    { title: 'six permanents do not, so the draw ability is withheld', forests: 5, offered: false },
  ])(
    'Ascend: $title',
    async ({ forests, offered }) => {
      const running = await openScenario(
        `xln-ascend-${offered ? 'blessed' : 'unblessed'}-v1`,
        {
          hand: [],
          battlefield: ['Arch of Orazca', ...repeat('Forest', forests)],
          library: repeat('Forest', 5),
        },
        ['Arch of Orazca', 'Forest', 'Swamp'],
      );
      let last: Session = running.session;
      try {
        const decision = running.session.decision;
        if (decision === null) throw new Error('Missing ascend decision');
        const texts = decision.options.map((option) => option.text);
        last = running.session;
        const draw = texts.filter((text) => text.includes('Draw a card'));
        expect(draw.length > 0, texts.join('\n')).toBe(offered);
      } finally {
        await finish(running, last);
      }
    },
    240_000,
  );
});
