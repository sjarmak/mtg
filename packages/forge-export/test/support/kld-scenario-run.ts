/** Runs one printed-format scenario (kld-aer unless told otherwise) through installed Forge one submitted move at a time. */
import { afterAll, beforeAll } from 'vitest';
import type { ObservedSession, SessionSpec, TableView } from '@mtg/engine';
import { compileInstalledForgeBridge } from '../../src/observed/installed';
import { snapshotForgeScenarioBackend } from './snapshot-backend';

export const required = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
let compiled: ReturnType<typeof compileInstalledForgeBridge>;

export type ObservedDecision = NonNullable<ObservedSession['decision']>;

/** Compiles the bridge once for the calling test file and disposes of it afterwards. */
export function useInstalledBridge(): void {
  beforeAll(() => {
    if (required && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
      compiled = compileInstalledForgeBridge();
  });
  afterAll(() => compiled?.dispose());
}

export interface Table {
  readonly hand: readonly string[];
  readonly battlefield: readonly string[];
  readonly opponent?: readonly string[];
  readonly opponentHand?: readonly string[];
  /** The local library, top first; two Swamps when omitted. */
  readonly library?: readonly string[];
  readonly graveyard?: readonly string[];
}

function spec(title: string, format: string): SessionSpec {
  return {
    content: { kind: 'printed', format },
    seats: [
      {
        name: 'Scenario captain',
        controller: 'local',
        deck: { name: `${format}-${title}`, cards: [{ name: 'Swamp', count: 60 }] },
      },
      {
        name: 'Scenario observer',
        controller: 'engine',
        deck: { name: `${format}-observer`, cards: [{ name: 'Forest', count: 60 }] },
      },
    ],
    seed: `${format}-${title}-v1`,
    maximumTurns: 3,
  };
}

/** What a witness sees at each decision; returning null stops the run with the position reached. */
export type Choose = (decision: ObservedDecision, view: TableView) => string | null | undefined;

/** Plays the scenario one submitted move at a time and returns the last position and the decision trace. */
export async function run(
  title: string,
  local: Table,
  choose: Choose,
  format = 'kld-aer',
): Promise<{ view: TableView; trace: readonly string[] }> {
  if (!compiled && process.env['MTG_FORGE_TEST_SNAPSHOT'] === undefined)
    throw new Error('Installed Forge required');
  const names = [
    ...local.hand,
    ...local.battlefield,
    ...(local.opponent ?? []),
    ...(local.opponentHand ?? []),
    ...(local.library ?? []),
    ...(local.graveyard ?? []),
    'Forest',
    'Swamp',
    'Mountain',
  ];
  const backend = await snapshotForgeScenarioBackend(
    {
      schemaVersion: 1,
      active: 0,
      phase: 'MAIN1',
      seats: [
        {
          life: 20,
          hand: [...local.hand],
          battlefield: [...local.battlefield],
          library: [...(local.library ?? ['Swamp', 'Swamp'])],
          graveyard: [...(local.graveyard ?? [])],
        },
        {
          life: 20,
          hand: [...(local.opponentHand ?? [])],
          battlefield: [...(local.opponent ?? [])],
          library: ['Forest', 'Forest'],
          graveyard: [],
        },
      ],
    },
    {
      ...(compiled ? { compiledBridgeClasses: compiled.classDirectory } : {}),
      diagnosticCardNames: [...new Set(names)],
    },
  );
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(spec(title, format));
  if (!opened.ok) {
    await backend.shutdown?.();
    throw new Error(opened.error.message);
  }
  let session: ObservedSession = opened.session;
  const trace: string[] = [];
  try {
    for (let index = 0; index < 80 && session.status === 'awaiting'; index += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error(`Forge offered no ${title} decision`);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      const move = choose(decision, session.view);
      if (move === null) break;
      if (move === undefined) throw new Error(`Unhandled ${title} decision\n${trace.slice(-6).join('\n')}`);
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-6).join('\n')}`);
      session = advanced.session;
    }
    return { view: session.view, trace };
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

export const pass = (decision: ObservedDecision): string | undefined =>
  decision.options.find((option) => option.text === 'Pass priority')?.id;

/** Pays a mana cost from the named land first, then any source Forge offers. */
export function paySource(decision: ObservedDecision, prefer: string): string | undefined {
  const sources = decision.options.filter((option) => option.id.startsWith('mana-source-'));
  return (sources.find((option) => option.text.includes(prefer)) ?? sources[0])?.id;
}
