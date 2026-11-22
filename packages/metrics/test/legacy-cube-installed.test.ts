import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { BotRunInput, InstalledBotResult } from '@mtg/forge-export';
import { createInstalledGameplay } from '../src/legacy-cube-calibration/installed';
import {
  parseLegacyCubeCalibrationArgs,
  planLegacyCubeCampaign,
} from '../src/legacy-cube-calibration/campaign';
import { parsePrintedCardCatalog } from '@mtg/printed-card';

it.each(['unproven', 'passed', 'failed', 'incomplete', 'wrong-bot'] as const)(
  'runs fresh two-seed probes and retains %s outcomes',
  async (probeOutcome) => {
    const out = await mkdtemp(join(tmpdir(), 'mtg-installed-calibration-test-'));
    const calls: BotRunInput[] = [];
    let disposed = false;
    try {
      const catalog = parsePrintedCardCatalog(
        JSON.parse(
          await readFile(
            new URL('../../data/data/legacy-cube-2021-card-catalog-v1.json', import.meta.url),
            'utf8',
          ),
        ) as unknown,
      );
      const options = parseLegacyCubeCalibrationArgs([
        '--out',
        out,
        '--seed',
        'installed',
        '--split',
        'tuning',
        '--policies',
        'power',
      ]);
      const plan = planLegacyCubeCampaign(catalog, options);
      const gameplay = await createInstalledGameplay(options, plan, () => ({
        botFingerprint: 'fixture-exact-binary',
        forgeVersion: 'fixture',
        dispose: () => {
          disposed = true;
        },
        run: async (input: BotRunInput): Promise<InstalledBotResult> => {
          calls.push(input);
          return {
            status: probeOutcome === 'incomplete' ? 'incomplete' : 'completed',
            botFingerprint: probeOutcome === 'wrong-bot' ? 'different-binary' : 'fixture-exact-binary',
            forgeVersion: 'fixture',
            stdout: '',
            stderr: '',
            error: null,
            report: {
              protocolVersion: 2,
              seed: input.seed,
              forgeVersion: 'fixture',
              botFingerprint: 'Default/hybrid-simulation',
              games: input.interaction
                ? []
                : [{ index: 0, winner: 'Beta', turns: 12, outcome: 'win', log: [] }],
              challenges: input.interaction
                ? [
                    {
                      id: input.interaction,
                      variant: input.probeVariant ?? 'default',
                      status:
                        probeOutcome === 'failed'
                          ? 'failed'
                          : input.seed === 43 && probeOutcome === 'unproven'
                            ? 'unproven'
                            : 'passed',
                      evidence: ['actual events'],
                      scriptedChoices: false,
                    },
                  ]
                : [],
            },
          };
        },
      }));
      expect(calls.filter((c) => c.interaction === 'fundamentals').map((c) => c.seed)).toEqual([42, 43]);
      expect(
        calls.filter((c) => c.interaction === 'cheat-threat').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['show-and-tell', 42],
        ['show-and-tell', 43],
        ['sneak-attack', 42],
        ['sneak-attack', 43],
      ]);
      expect(
        calls.filter((c) => c.interaction === 'spells-density').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['young-pyromancer', 42],
        ['young-pyromancer', 43],
        ['monastery-mentor', 42],
        ['monastery-mentor', 43],
      ]);
      expect(
        calls.filter((c) => c.interaction === 'graveyard-value').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['uro-escape', 42],
        ['uro-escape', 43],
        ['bloodghast-landfall', 42],
        ['bloodghast-landfall', 43],
      ]);
      expect(
        calls.filter((c) => c.interaction === 'tokens-wide').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['honor-souls', 42],
        ['honor-souls', 43],
        ['spear-procession', 42],
        ['spear-procession', 43],
      ]);
      expect(
        calls.filter((c) => c.interaction === 'opposition-tokens').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['opposition-bitterblossom', 42],
        ['opposition-bitterblossom', 43],
        ['glare-ophiomancer', 42],
        ['glare-ophiomancer', 43],
      ]);
      expect(calls.filter((c) => c.interaction === 'equipment').map((c) => [c.probeVariant, c.seed])).toEqual(
        [
          ['wargear-elf', 42],
          ['wargear-elf', 43],
          ['fire-ice-wall', 42],
          ['fire-ice-wall', 43],
        ],
      );
      expect(
        calls.filter((c) => c.interaction === 'creature-toolbox').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['primal-command', 42],
        ['primal-command', 43],
        ['birthing-pod', 42],
        ['birthing-pod', 43],
      ]);
      expect(
        calls.filter((c) => c.interaction === 'land-recursion').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['wasteland-replay', 42],
        ['wasteland-replay', 43],
        ['fetchland-replay', 42],
        ['fetchland-replay', 43],
      ]);
      expect(
        calls.filter((c) => c.interaction === 'upheaval-mana').map((c) => [c.probeVariant, c.seed]),
      ).toEqual([
        ['monolith-rebuild', 42],
        ['monolith-rebuild', 43],
        ['powerstone-rebuild', 42],
        ['powerstone-rebuild', 43],
      ]);
      expect(new Set(calls.flatMap((c) => (c.interaction ? [c.interaction] : []))).size).toBe(18);
      const fundamentals = gameplay.evidence.find((e) => e.interaction === 'fundamentals');
      const reanimation = gameplay.evidence.find((e) => e.interaction === 'reanimate');
      expect(reanimation?.coverage).toEqual(['Reanimate', 'Griselbrand']);
      expect(JSON.parse(await readFile(reanimation!.artifact, 'utf8'))).toHaveProperty('coverage', [
        'Reanimate',
        'Griselbrand',
      ]);
      expect(fundamentals?.status).toBe(
        probeOutcome === 'passed' ? 'passed' : probeOutcome === 'failed' ? 'failed' : 'unproven',
      );
      expect(gameplay.evidence.some((e) => e.seeds.length === 0 && e.status === 'unproven')).toBe(false);
      const result = await gameplay.play(plan.games[0]!);
      expect(result).toMatchObject({
        status: probeOutcome === 'incomplete' ? 'incomplete' : 'completed',
        winner: 1,
      });
      expect(JSON.parse(await readFile(result.artifact, 'utf8'))).toHaveProperty(
        'result.botFingerprint',
        probeOutcome === 'wrong-bot' ? 'different-binary' : 'fixture-exact-binary',
      );
      expect(await readFile(calls.at(-1)!.deckA, 'utf8')).toContain('[main]');
      await gameplay.dispose();
      expect(disposed).toBe(true);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  },
);
