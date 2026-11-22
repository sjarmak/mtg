/**
 * Real-Forge scenario witnesses that a Starter Commander Decks general seated
 * in the scenario's command zone reaches the command-zone contracts: cast from
 * the zone, the tax on the recast, and both answers to the zone-change choice.
 *
 * The scenario route could not seat a commander until #208: Forge's puzzle
 * `GameState.setupPlayerState` empties the Command zone and clears
 * `Player.getCommanders()`, and the bridge's `ScenarioState` wrote no command
 * zone back. A seat's `command` list is now dealt as `command=<name>|IsCommander`,
 * which Forge registers as the seat's commander with its commander effect, so
 * these run as scenario probes rather than whole games and carry receipts.
 * Every `it` here is a probe assertion; extra gameplay goes in
 * `observed-scd-commander-witness.integration.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { COMMANDER_RULES } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
const EMMARA = 'Emmara, Soul of the Accord';
const KARDUR = 'Kardur, Doomscourge';
const REMOVAL = 'Beast Within';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

beforeAll(() => {
  if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    compiled = compileInstalledForgeBridge();
});
afterAll(() => compiled?.dispose());

type Decision = NonNullable<ObservedSession['decision']>;
type Seat = ObservedSession['view']['seats'][number];

function table(seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'scd' },
    rules: COMMANDER_RULES,
    seats: [
      {
        name: 'Local general',
        controller: 'local',
        deck: {
          name: 'emmara',
          cards: [{ name: 'Forest', count: 60 }],
          commanders: [{ name: EMMARA, count: 1 }],
        },
      },
      {
        name: 'Native general',
        controller: 'engine',
        deck: {
          name: 'kardur',
          cards: [{ name: 'Swamp', count: 60 }],
          commanders: [{ name: KARDUR, count: 1 }],
        },
      },
    ],
    seed,
    maximumTurns: 3,
  };
}

/** Nine untapped lands: Emmara ({G}{W}), Beast Within ({2}{G}), and the taxed recast ({2}{G}{W}). */
const STATE = {
  schemaVersion: 1,
  active: 0,
  phase: 'MAIN1',
  seats: [
    {
      life: 40,
      hand: [REMOVAL],
      library: ['Forest', 'Forest', 'Forest'],
      battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Plains', 'Plains', 'Plains', 'Plains'],
      graveyard: [],
      command: [EMMARA],
    },
    {
      life: 40,
      hand: [],
      library: ['Swamp', 'Swamp', 'Swamp'],
      battlefield: [],
      graveyard: [],
      command: [KARDUR],
    },
  ],
} as const;

async function openScenario(seed: string) {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const backend = await snapshotForgeScenarioBackend(STATE, {
    ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
    diagnosticCardNames: [EMMARA, KARDUR, REMOVAL, 'Forest', 'Plains', 'Swamp'],
  });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(table(seed));
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  return { backend, session: opened.session };
}

function inZone(seat: Seat, zone: 'battlefield' | 'graveyard' | 'commandZone', name: string) {
  return (seat[zone] ?? []).find((card) => card.name === name);
}

function routineMove(decision: Decision): string | undefined {
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

interface Outcome {
  readonly session: ObservedSession;
  readonly payments: readonly string[];
  readonly zoneChange: { readonly prompt: string; readonly options: readonly string[] } | undefined;
  readonly evidence: string;
}

/**
 * Casts Emmara from the command zone, kills her with Beast Within, answers the
 * zone-change choice with `answer`, and on `yes` casts her again.
 */
async function play(seed: string, answer: 'yes' | 'no'): Promise<Outcome> {
  const running = await openScenario(seed);
  let session = running.session;
  expect(inZone(session.view.seats[0], 'commandZone', EMMARA)).toBeDefined();
  const payments: string[] = [];
  let zoneChange: Outcome['zoneChange'];
  let stage: 'cast' | 'kill' | 'recast' | 'done' = 'cast';
  const trace: string[] = [];
  try {
    for (let index = 0; index < 120 && session.status === 'awaiting' && stage !== 'done'; index += 1) {
      const decision = session.decision;
      if (decision === null) break;
      const me = session.view.seats[0];
      const general = inZone(me, 'battlefield', EMMARA);
      trace.push(
        `${stage} ${decision.kind}: ${decision.prompt} [${decision.options.map((o) => o.text).join(' | ')}]`,
      );
      if (stage === 'cast' && general !== undefined) stage = 'kill';
      if (stage === 'recast' && general !== undefined) stage = 'done';
      if (stage === 'done') break;
      let move: string | undefined;
      if (decision.kind === 'priority' && decision.seat === 0) {
        const commanderCast = decision.options.find((option) => option.text.startsWith(`${EMMARA}:`));
        const removal = decision.options.find((option) => option.text.startsWith(`${REMOVAL}:`));
        if ((stage === 'cast' || stage === 'recast') && commanderCast !== undefined) move = commanderCast.id;
        else if (stage === 'kill' && removal !== undefined && general !== undefined) move = removal.id;
        else move = routineMove(decision);
      } else if (decision.kind === 'mana-payment') {
        payments.push(decision.prompt);
        move = routineMove(decision);
      } else if (decision.kind === 'target-selection' && stage === 'kill' && general !== undefined) {
        move = decision.options.find((option) =>
          option.targets.some((target) => target.oid === general.oid),
        )?.id;
      } else if (decision.kind === 'confirm-replacement' && decision.prompt.startsWith(`${EMMARA}:`)) {
        // CR 903.9a: she is already in the graveyard while her owner chooses.
        expect(inZone(me, 'graveyard', EMMARA), trace.join('\n')).toBeDefined();
        zoneChange = { prompt: decision.prompt, options: decision.options.map((option) => option.text) };
        move = decision.options.find((option) => option.id === `confirm-replacement-${answer}`)?.id;
        stage = answer === 'yes' ? 'recast' : 'done';
      } else move = routineMove(decision);
      if (move === undefined)
        throw new Error(`Unhandled ${decision.kind} at ${stage}\n${trace.slice(-12).join('\n')}`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
      session = advanced.session;
    }
    return { session, payments, zoneChange, evidence: trace.join('\n') };
  } finally {
    await session.close();
    await running.backend.shutdown?.();
  }
}

describe.skipIf(!required)('SCD command-zone scenario witnesses', () => {
  it('casts the scenario general from the command zone and taxes the recast after she returns there', async () => {
    const outcome = await play('scd-command-zone-return-v1', 'yes');
    expect(outcome.zoneChange?.prompt, outcome.evidence).toContain('may put it into the command zone');
    expect(outcome.zoneChange?.options, outcome.evidence).toEqual([
      `Put ${EMMARA} into the command zone`,
      `Leave ${EMMARA} in the graveyard`,
    ]);
    // Each cast's first payment prompt states the whole cost: untaxed, then taxed by {2}.
    const casts = outcome.payments.filter((prompt) =>
      /^Pay for Emmara, Soul of the Accord: (?:\{\d\})?\{W\}\{G\}$/u.test(prompt),
    );
    expect(casts, outcome.evidence).toEqual([`Pay for ${EMMARA}: {W}{G}`, `Pay for ${EMMARA}: {2}{W}{G}`]);
    expect(inZone(outcome.session.view.seats[0], 'battlefield', EMMARA), outcome.evidence).toBeDefined();
    expect(Object.values(outcome.session.view.seats[0].commanderCasts ?? {}), outcome.evidence).toEqual([2]);
  }, 180_000);

  it('leaves the scenario general in the graveyard when her owner declines the command zone', async () => {
    const outcome = await play('scd-command-zone-decline-v1', 'no');
    expect(outcome.zoneChange, outcome.evidence).toBeDefined();
    const seat = outcome.session.view.seats[0];
    expect(inZone(seat, 'graveyard', EMMARA), outcome.evidence).toBeDefined();
    expect(inZone(seat, 'commandZone', EMMARA), outcome.evidence).toBeUndefined();
  }, 180_000);
});
