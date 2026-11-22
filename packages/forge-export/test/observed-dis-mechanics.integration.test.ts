import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';
import {
  pass,
  paySource,
  required,
  run,
  useInstalledBridge,
  type ObservedDecision,
} from './support/kld-scenario-run';

let compiled: ReturnType<typeof compileInstalledForgeBridge>;

useInstalledBridge();

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

const named = (decision: ObservedDecision, text: string): string | undefined =>
  decision.options.find((option) => option.text.includes(text))?.id;

const table: SessionSpec = {
  content: { kind: 'printed', format: 'dis' },
  seats: [
    {
      name: 'Forecast pilot',
      controller: 'local',
      deck: { name: 'forecast', cards: [{ name: 'Plains', count: 60 }] },
    },
    {
      name: 'Observer',
      controller: 'engine',
      deck: { name: 'observer', cards: [{ name: 'Forest', count: 60 }] },
    },
  ],
  seed: 'dis-forecast-v1',
  maximumTurns: 4,
};

describe.skipIf(!required)('DIS mechanic witnesses', () => {
  it.each([
    { hand: [] as string[], power: 4, toughness: 3 },
    { hand: ['Forest'], power: 2, toughness: 2 },
  ])(
    'applies Hellbent characteristics only with an empty hand',
    async ({ hand, power, toughness }) => {
      const { view, trace } = await run(
        `hellbent-${hand.length === 0 ? 'active' : 'inactive'}`,
        { hand, battlefield: ["Demon's Jester"] },
        () => null,
        'dis',
      );
      expect(
        view.seats[0].battlefield.find((card) => card.name === "Demon's Jester"),
        trace.join('\n'),
      ).toMatchObject({
        power,
        toughness,
      });
    },
    240_000,
  );

  it('moves a Graft counter onto the next creature that enters', async () => {
    let initiateCast = false;
    let recruitCast = false;
    let graftChosen = false;
    const { view, trace } = await run(
      'graft',
      {
        hand: ['Simic Initiate', 'Boros Recruit'],
        battlefield: ['Forest', 'Plains'],
      },
      (decision, state) => {
        if (decision.kind === 'priority') {
          if (!initiateCast) {
            const move = named(decision, 'Simic Initiate');
            initiateCast = move !== undefined;
            return move;
          }
          if (state.stack.length === 0 && !recruitCast) {
            const move = named(decision, 'Boros Recruit');
            recruitCast = move !== undefined;
            return move;
          }
          const recruit = state.seats[0].battlefield.find((card) => card.name === 'Boros Recruit');
          return recruit?.counters['P1P1'] === 1 ? null : pass(decision);
        }
        if (decision.kind === 'mana-payment')
          return paySource(decision, initiateCast && !recruitCast ? 'Forest' : 'Plains');
        if (
          decision.kind === 'replacement-trigger-choices' ||
          decision.kind === 'confirm-action' ||
          decision.kind === 'confirm-trigger'
        ) {
          const move =
            decision.options.find((option) => /yes|move|simic initiate/iu.test(option.text))?.id ??
            decision.options[0]?.id;
          graftChosen = move !== undefined;
          return move;
        }
        return decision.options[0]?.id;
      },
      'dis',
    );
    const evidence = trace.slice(-32).join('\n');
    expect({ initiateCast, recruitCast, graftChosen }, evidence).toEqual({
      initiateCast: true,
      recruitCast: true,
      graftChosen: true,
    });
    expect(
      view.seats[0].graveyard.map((card) => card.name),
      evidence,
    ).toContain('Simic Initiate');
    expect(
      view.seats[0].battlefield.find((card) => card.name === 'Boros Recruit'),
      evidence,
    ).toMatchObject({
      counters: { P1P1: 1 },
    });
  }, 240_000);

  it('activates Forecast during upkeep and pumps its target', async () => {
    if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      throw new Error('Installed Forge required');
    const backend = await snapshotForgeScenarioBackend(
      {
        schemaVersion: 1,
        active: 0,
        phase: 'OPENING_HAND',
        seats: [
          {
            life: 20,
            hand: ['Steeling Stance', 'Boros Recruit', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'],
            battlefield: [],
            library: ['Plains', 'Plains', 'Plains'],
            graveyard: [],
          },
          {
            life: 20,
            hand: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'],
            battlefield: [],
            library: ['Forest', 'Forest', 'Forest'],
            graveyard: [],
          },
        ],
      },
      {
        ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
        diagnosticCardNames: ['Steeling Stance', 'Boros Recruit', 'Plains', 'Forest'],
      },
    );
    if (backend === null) throw new Error('Installed Forge required');
    const opened = await backend.open(table);
    if (!opened.ok) {
      await backend.shutdown?.();
      throw new Error(opened.error.message);
    }
    let session: ObservedSession = opened.session;
    const trace: string[] = [];
    let landPlayed = false;
    let recruitCast = false;
    let forecastActivated = false;
    try {
      for (let index = 0; index < 240 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing Forecast decision');
        const recruit = session.view.seats[0].battlefield.find((card) => card.name === 'Boros Recruit');
        if (forecastActivated && recruit?.power === 2) break;
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        let move: string | undefined;
        if (decision.kind === 'opening-hand-action') {
          move = decision.options.find(
            (option) => option.text === 'Choose none' || option.text === 'Done choosing',
          )?.id;
        } else if (decision.kind === 'starting-player') {
          move = decision.options.find((option) => option.id === 'pregame-start-seat-0')?.id;
        } else if (decision.kind === 'mulligan') {
          move = decision.options.find((option) => option.id === 'pregame-keep')?.id;
        } else if (decision.kind === 'priority') {
          const forecast = decision.options.find(
            (option) => option.text.includes('Steeling Stance') && option.text.includes('Forecast'),
          );
          if (forecast !== undefined) {
            forecastActivated = true;
            move = forecast.id;
          } else if (!landPlayed) {
            move = decision.options.find((option) => option.text.includes('Plains'))?.id;
            landPlayed = move !== undefined;
            move ??= pass(decision);
          } else if (!recruitCast) {
            move = decision.options.find((option) => option.text.includes('Boros Recruit'))?.id;
            recruitCast = move !== undefined;
            move ??= pass(decision);
          } else move = pass(decision);
        } else if (decision.kind === 'mana-payment') {
          move = paySource(decision, 'Plains');
        } else if (decision.kind.endsWith('target-selection')) {
          move = decision.options.find((option) =>
            option.targets.some((target) => target.name === 'Boros Recruit'),
          )?.id;
        } else move = decision.options[0]?.id;
        if (move === undefined)
          throw new Error(`Unhandled Forecast decision\n${trace.slice(-10).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-10).join('\n')}`);
        session = advanced.session;
      }
      const evidence = trace.slice(-40).join('\n');
      expect({ landPlayed, recruitCast, forecastActivated }, evidence).toEqual({
        landPlayed: true,
        recruitCast: true,
        forecastActivated: true,
      });
      expect(
        session.view.seats[0].battlefield.find((card) => card.name === 'Boros Recruit'),
        evidence,
      ).toMatchObject({
        power: 2,
        toughness: 2,
      });
    } finally {
      await session.close();
      await backend.shutdown?.();
    }
  }, 300_000);
});
