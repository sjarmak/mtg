/** Test-only launch seam. An explicit snapshot can never fall back to workspace inputs. */
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { expect } from 'vitest';
import { getCurrentTest } from '@vitest/runner';
import type { ObservedBackend } from '@mtg/engine';
import {
  installedForgeBackend,
  installedForgeDiagnosticScenarioBackend,
  installedForgeScenarioBackend,
} from '../../src/observed/installed';
import { measureForgeRuntime } from '../../src/observed/runtime-identity';
import { ForgeScenarioStateSchema } from '../../src/observed/scenario-state';
import type { ForgeScenarioState } from '../../src/observed/scenario-state';

const Path = z.string().min(1).refine(isAbsolute, 'absolute snapshot path required');
const Manifest = z.strictObject({
  schemaVersion: z.literal(1),
  inputs: z.strictObject({
    forgeHome: Path,
    bridge: z.strictObject({ kind: z.literal('compiled'), path: Path }),
    adapterBundlePath: Path,
  }),
  identity: z.unknown(),
});
const Options = z.strictObject({ timeoutMs: z.number().int().positive().optional() });
const ScenarioOptions = Options.extend({
  compiledBridgeClasses: Path.optional(),
  diagnosticCardNames: z.array(z.string().min(1)).min(1).optional(),
});

function scenarioTestIdentity() {
  const task = getCurrentTest();
  if (task === undefined) throw new Error('Scenario usage requires an active test');
  const ancestors = [];
  for (let suite = task.suite; suite !== undefined && !('filepath' in suite); suite = suite.suite)
    ancestors.push(suite.name);
  return { id: task.id, ancestorTitles: ancestors.reverse(), title: task.name };
}

/** Name-only scenarios stay distinguishable from whole-game probe evidence. */
export async function snapshotForgeScenarioBackend(
  input: unknown,
  options: z.infer<typeof ScenarioOptions> = {},
  manifestPath = process.env['MTG_FORGE_TEST_SNAPSHOT'],
): Promise<ObservedBackend | null> {
  const state = ForgeScenarioStateSchema.parse(input);
  const checked = ScenarioOptions.parse(options);
  if (manifestPath === undefined) {
    const launchOptions = {
      ...(checked.timeoutMs === undefined ? {} : { timeoutMs: checked.timeoutMs }),
      ...(checked.compiledBridgeClasses === undefined
        ? {}
        : { compiledBridgeClasses: checked.compiledBridgeClasses }),
    };
    return checked.diagnosticCardNames === undefined
      ? installedForgeScenarioBackend(state, launchOptions)
      : installedForgeDiagnosticScenarioBackend(state, new Set(checked.diagnosticCardNames), launchOptions);
  }
  if (checked.compiledBridgeClasses !== undefined)
    throw new Error('Snapshot scenario cannot override compiled bridge classes');
  return measuredBackend(manifestPath, checked, state);
}

export async function snapshotForgeBackend(
  options: z.infer<typeof Options> = {},
  manifestPath = process.env['MTG_FORGE_TEST_SNAPSHOT'],
): Promise<ObservedBackend | null> {
  const checked = Options.parse(options);
  if (manifestPath === undefined)
    return installedForgeBackend(checked.timeoutMs === undefined ? {} : { timeoutMs: checked.timeoutMs });
  return measuredBackend(manifestPath, checked);
}

async function measuredBackend(
  manifestPath: string,
  options: z.infer<typeof ScenarioOptions>,
  scenario?: ForgeScenarioState,
): Promise<ObservedBackend> {
  const { inputs, identity } = Manifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (!isDeepStrictEqual(measureForgeRuntime(inputs), identity))
    throw new Error('Probe runtime identity mismatch');
  const adapter = await import(/* @vite-ignore */ pathToFileURL(inputs.adapterBundlePath).href);
  const constructor =
    scenario === undefined
      ? 'installedForgeBackend'
      : 'diagnosticCardNames' in options && options.diagnosticCardNames !== undefined
        ? 'installedForgeDiagnosticScenarioBackend'
        : 'installedForgeScenarioBackend';
  if (typeof adapter[constructor] !== 'function')
    throw new Error(`Snapshot adapter does not export ${constructor}`);
  const launchOptions = {
    ...options,
    forgeHome: inputs.forgeHome,
    compiledBridgeClasses: inputs.bridge.path,
  };
  const backend: ObservedBackend | null =
    scenario === undefined
      ? adapter[constructor](launchOptions)
      : constructor === 'installedForgeDiagnosticScenarioBackend'
        ? adapter[constructor](scenario, new Set(options.diagnosticCardNames), launchOptions)
        : adapter[constructor](scenario, launchOptions);
  if (backend === null) throw new Error('Snapshot Forge is absent');
  const journal = process.env['MTG_FORGE_TEST_SNAPSHOT_USAGE'];
  if (journal === undefined) return backend;
  return {
    ...backend,
    open: async (table) => {
      const opened = await backend.open(table);
      if (opened.ok) {
        try {
          const state = expect.getState();
          appendFileSync(
            journal,
            `${JSON.stringify({
              testFile: state.testPath,
              testName: state.currentTestName,
              runtime: identity,
              formatId: table.content.kind === 'printed' ? table.content.format : null,
              controllers: table.seats.map((seat) => seat.controller),
              ...(scenario === undefined
                ? {}
                : {
                    testIdentity: scenarioTestIdentity(),
                    scenario: {
                      state: scenario,
                      sha256: createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),
                      seed: table.seed,
                      maximumTurns: table.maximumTurns,
                    },
                  }),
            })}\n`,
          );
        } catch (cause) {
          await opened.session.close();
          throw cause;
        }
      }
      return opened;
    },
  };
}
