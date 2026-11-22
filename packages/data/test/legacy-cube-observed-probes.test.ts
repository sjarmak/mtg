/**
 * Real observed-backend support probes for every recorded high-risk family signature.
 *
 * The observed backend is delivered by mtg-bc2.151.4 and its universal match
 * choices by mtg-bc2.151.11 on a separate branch, so the module path is explicit
 * during integration rather than copied here.
 */
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  legacyCubeBridgeCardFamilySafeNames,
  loadLegacyCubeDecisionLedger,
  officialLegacyCubeDecisionEntries,
} from '@mtg/data';

interface SupportsBackend {
  readonly supports: (table: unknown) => Promise<readonly string[]>;
}

interface ObservedModule {
  readonly forgeObservedBackend: (options: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
  }) => SupportsBackend;
}

const observedModulePath = process.env['MTG_FORGE_OBSERVED_MODULE'];
const probeIt = observedModulePath === undefined ? it.skip : it;

function tableFor(names: readonly string[]): unknown {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Human',
        controller: 'local',
        deck: { name: 'probe', cards: names.map((name) => ({ name, count: 60 })) },
      },
      {
        name: 'Forge AI',
        controller: 'engine',
        deck: { name: 'baseline', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'legacy-cube-decision-probe',
    maximumTurns: 1,
  };
}

describe('Legacy Cube observed-backend decision probes', () => {
  probeIt(
    'queries every recorded family-signature refusal and baseline acceptance through supports',
    async () => {
      if (observedModulePath === undefined) return;
      const module = (await import(
        /* @vite-ignore */ pathToFileURL(observedModulePath).href
      )) as ObservedModule;
      const backend = module.forgeObservedBackend({
        command: process.execPath,
        args: ['-e', 'process.exit(99)'],
        cwd: process.cwd(),
      });
      const ledger = loadLegacyCubeDecisionLedger();
      const entries = officialLegacyCubeDecisionEntries(ledger);

      expect(await backend.supports(tableFor(legacyCubeBridgeCardFamilySafeNames(ledger)))).toEqual([]);
      for (const probe of ledger.runtimeProbes.filter(
        (candidate) => candidate.kind === 'observed-backend-containment',
      )) {
        const representative = entries.find((entry) => entry.runtimeProbeId === probe.id);
        if (representative === undefined)
          throw new Error(`probe ${probe.id} has no family-signature representative`);
        expect(probe).toMatchObject({
          position: representative.position,
          correctedName: representative.correctedName,
          cardNames: [representative.correctedName],
          families: representative.families,
        });
        expect(await backend.supports(tableFor([representative.correctedName]))).toEqual([
          `printed card "${representative.correctedName}" is outside the audited Forge decision-family slice`,
        ]);
      }
    },
  );
});
