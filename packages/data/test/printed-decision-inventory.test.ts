import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPrintedDecisionInventory } from '../src/printed-card/printed-decision-inventory';
import { buildPrintedCompleteCoveragePlan } from '../src/printed-card/printed-coverage-plan';
import reviewedProfiles from '../data/akh-hou/akh-hou-reviewed-profiles-v1.json';
import priorPlan from './fixtures/akh-hou-coverage-plan-prior-v1.json';
import reviewedOverrides from '../data/akh-hou/akh-hou-script-coverage-plan-v1.json';

const catalogInputs = ['akh', 'hou', 'mp2'].map(
  (code) =>
    JSON.parse(
      readFileSync(new URL(`../data/akh-hou/${code}-printed-catalog-v1.json`, import.meta.url), 'utf8'),
    ) as unknown,
);
const archive = new URL('../../../tools/forge/dist/res/cardsfolder/cardsfolder.zip', import.meta.url);
const tokenRoot = new URL('../../../tools/forge/dist/res/tokenscripts/', import.meta.url);

describe('AKH/HOU controller-decision inventory', () => {
  let extractionRoot = '';

  beforeAll(() => {
    extractionRoot = mkdtempSync(join(tmpdir(), 'akh-hou-decisions-'));
    execFileSync('unzip', ['-q', archive.pathname, '-d', extractionRoot], { timeout: 30_000 });
  });

  afterAll(() => {
    rmSync(extractionRoot, { recursive: true, force: true });
  });

  it('accounts for every exact root script and its generated-object closure without qualifying it', () => {
    const inventory = buildPrintedDecisionInventory(
      catalogInputs,
      (path) => readFileSync(join(extractionRoot, path)),
      (name) => {
        try {
          return readFileSync(new URL(`${name}.txt`, tokenRoot));
        } catch {
          return undefined;
        }
      },
    );

    expect(inventory.scripts).toHaveLength(509);
    expect(inventory.scripts.flatMap((script) => script.physicalIds)).toHaveLength(550);
    expect(inventory.residual).toEqual({
      unknownRootSyntax: [],
      unknownDependencySyntax: [],
      missingGeneratedDependencies: [],
    });
    expect(inventory.scripts.every((script) => script.reviewState === 'candidate')).toBe(true);
    expect(new Set(inventory.scripts.map((script) => script.candidateProfile)).size).toBeGreaterThan(1);
    const profileFor = (name: string) =>
      inventory.scripts.find((script) => script.names.includes(name))?.candidateProfile;
    expect(profileFor('Ambuscade')).not.toBe(profileFor('Counterspell'));
    expect(profileFor('Lethal Sting')).not.toBe(profileFor('Ambuscade'));
    expect(inventory.summary).toEqual({
      physicalCards: 550,
      rootScripts: 509,
      candidateProfiles: 344,
      generatedDependencies: 12,
      qualifiedScripts: 0,
    });
    const ancientCrab = inventory.scripts.find((script) => script.names.includes('Ancient Crab'))!;
    expect(ancientCrab).toMatchObject({
      sourceScript: { path: 'a/ancient_crab.txt' },
      families: ['priority', 'combat'],
      candidateProfile: 'candidate-56bcc14213d1b59e',
    });
    expect(
      inventory.scripts.filter((script) => script.candidateProfile === ancientCrab.candidateProfile),
    ).toHaveLength(45);
  });

  it('classifies fixed graveyard-exile payments as cost-card selection', () => {
    const isdCatalog = JSON.parse(
      readFileSync(new URL('../data/isd/isd-printed-catalog-v1.json', import.meta.url), 'utf8'),
    ) as unknown;
    const inventory = buildPrintedDecisionInventory(
      [isdCatalog],
      (path) => readFileSync(join(extractionRoot, path)),
      (name) => {
        try {
          return readFileSync(new URL(`${name}.txt`, tokenRoot));
        } catch {
          return undefined;
        }
      },
    );

    for (const name of ['Stitched Drake', 'Skaab Goliath', 'Skaab Ruinator']) {
      expect(inventory.scripts.find((script) => script.names.includes(name))?.families).toContain(
        'cost-card-selection',
      );
    }
    expect(
      inventory.scripts.find((script) => script.names.includes('Deranged Assistant'))?.families,
    ).not.toContain('cost-card-selection');
  });

  it('classifies reveal-or-pay additional costs as cost-card selection', () => {
    const lrwCatalog = JSON.parse(
      readFileSync(new URL('../data/lrw/lrw-printed-catalog-v1.json', import.meta.url), 'utf8'),
    ) as unknown;
    const inventory = buildPrintedDecisionInventory(
      [lrwCatalog],
      (path) => readFileSync(join(extractionRoot, path)),
      (name) => {
        try {
          return readFileSync(new URL(`${name}.txt`, tokenRoot));
        } catch {
          return undefined;
        }
      },
    );

    for (const name of [
      'Flamekin Bladewhirl',
      'Goldmeadow Stalwart',
      'Silvergill Adept',
      'Squeaking Pie Sneak',
      "Wren's Run Vanquisher",
    ]) {
      expect(inventory.scripts.find((script) => script.names.includes(name))?.families).toContain(
        'cost-card-selection',
      );
    }
  });

  it('adds closed controller profiles without promoting source-only reviews', () => {
    const inventory = buildPrintedDecisionInventory(
      catalogInputs,
      (path) => readFileSync(join(extractionRoot, path)),
      (name) => {
        try {
          return readFileSync(new URL(`${name}.txt`, tokenRoot));
        } catch {
          return undefined;
        }
      },
    );
    const plan = buildPrintedCompleteCoveragePlan(inventory.scripts, priorPlan, { reviewedProfiles });

    expect(plan.scripts).toHaveLength(509);
    expect(
      plan.scripts.filter((script) => script.review === 'complete').map((script) => script.sourceScript.path),
    ).toEqual(['a/ahn_crop_crasher.txt', 'a/ancient_crab.txt', 'g/glorybringer.txt', 'g/gust_walker.txt']);
    expect(
      plan.scripts.find((script) => script.sourceScript.path === 'a/approach_of_the_second_sun.txt')?.review,
    ).toBe('partial');
    expect(plan.scripts.every((script) => script.capabilityProfile?.startsWith('candidate-'))).toBe(true);
    expect(
      plan.scripts
        .filter((script) =>
          script.obligations.every(
            (obligation) => obligation.proof !== 'scenario' || obligation.claims.length === 0,
          ),
        )
        .every((script) =>
          script.obligations.some(
            (obligation) =>
              obligation.id === 'controller-capability-profile' &&
              obligation.proof === 'scenario' &&
              obligation.claims.length === 0,
          ),
        ),
    ).toBe(true);
    const gustProfile = inventory.scripts.find((script) =>
      script.names.includes('Gust Walker'),
    )!.candidateProfile;
    const gustProfileScripts = plan.scripts.filter((script) => script.capabilityProfile === gustProfile);
    expect(gustProfileScripts).toHaveLength(10);
    for (const script of gustProfileScripts) {
      const profile = script.obligations.find(
        (obligation) => obligation.id === 'controller-capability-profile',
      );
      expect(profile).toMatchObject({
        proof: 'scenario',
        claims: [
          { controller: 'local', capabilityProfile: gustProfile },
          { controller: 'engine', capabilityProfile: gustProfile },
        ],
      });
    }
    const crab = plan.scripts.find((script) => script.sourceScript.path === 'a/ancient_crab.txt')!;
    expect(
      crab.obligations.find((obligation) => obligation.id === 'controller-capability-profile'),
    ).toMatchObject({
      proof: 'scenario',
      claims: [
        {
          controller: 'local',
          receiptId: 'ancient-crab-local-controller-profile-v1',
          capabilityProfile: crab.capabilityProfile,
        },
        {
          controller: 'engine',
          receiptId: 'ancient-crab-engine-controller-profile-v1',
          capabilityProfile: crab.capabilityProfile,
        },
      ],
    });
    const sarcophagus = plan.scripts.find(
      (script) => script.sourceScript.path === 'a/abandoned_sarcophagus.txt',
    )!;
    expect(
      plan.scripts.filter((script) => script.capabilityProfile === sarcophagus.capabilityProfile),
    ).toHaveLength(1);
    expect(
      sarcophagus.obligations.find((obligation) => obligation.id === 'controller-capability-profile'),
    ).toMatchObject({
      proof: 'scenario',
      claims: [
        {
          controller: 'local',
          receiptId: 'abandoned-sarcophagus-local-controller-profile-v1',
          capabilityProfile: sarcophagus.capabilityProfile,
        },
        {
          controller: 'engine',
          receiptId: 'abandoned-sarcophagus-engine-controller-profile-v1',
          capabilityProfile: sarcophagus.capabilityProfile,
        },
      ],
    });
    expect(plan.scripts.flatMap((script) => script.dependencies).length).toBeGreaterThan(0);
  });

  it('replaces whole-script candidates with reviewed atomic controller contracts', () => {
    const inventory = buildPrintedDecisionInventory(
      catalogInputs,
      (path) => readFileSync(join(extractionRoot, path)),
      (name) => {
        try {
          return readFileSync(new URL(`${name}.txt`, tokenRoot));
        } catch {
          return undefined;
        }
      },
    );
    const families = [...new Set(inventory.scripts.flatMap((script) => script.families))];
    const contracts = Object.fromEntries(families.map((family) => [family, `${family}-contract-v1`]));
    const plan = buildPrintedCompleteCoveragePlan(inventory.scripts, priorPlan, {
      controllerContracts: contracts,
    });

    expect(plan.scripts).toHaveLength(509);
    expect(plan.scripts.every((script) => script.review === 'complete')).toBe(true);
    expect(plan.scripts.every((script) => script.capabilityProfile === undefined)).toBe(true);
    for (const script of plan.scripts) {
      const contractObligations = script.obligations.flatMap((obligation) =>
        obligation.proof === 'scenario' && obligation.controllerContractId ? [obligation] : [],
      );
      expect(contractObligations.map((obligation) => obligation.decisionFamilies?.[0]).sort()).toEqual(
        [
          ...inventory.scripts.find((entry) => entry.sourceScript.path === script.sourceScript.path)!
            .families,
        ].sort(),
      );
      expect(contractObligations.every((obligation) => obligation.claims.length === 0)).toBe(true);
    }
    const crasher = plan.scripts.find((script) => script.sourceScript.path === 'a/ahn_crop_crasher.txt')!;
    expect(crasher.obligations.find((obligation) => obligation.id === 'attack-exert')).toMatchObject({
      lines: [6],
      proof: 'scenario',
    });
    expect(crasher.obligations.find((obligation) => obligation.id === 'blocking-restriction')).toMatchObject({
      lines: [7, 8],
      proof: 'scenario',
    });
    expect(
      buildPrintedCompleteCoveragePlan(inventory.scripts, plan, { controllerContracts: contracts }),
    ).toEqual(plan);
  });

  it('layers exact reviewed card obligations over the reusable complete-plan baseline', () => {
    const inventory = buildPrintedDecisionInventory(
      catalogInputs,
      (path) => readFileSync(join(extractionRoot, path)),
      (name) => {
        try {
          return readFileSync(new URL(`${name}.txt`, tokenRoot));
        } catch {
          return undefined;
        }
      },
    );
    const families = [...new Set(inventory.scripts.flatMap((script) => script.families))];
    const contracts = Object.fromEntries(families.map((family) => [family, `${family}-contract-v1`]));
    const plan = buildPrintedCompleteCoveragePlan(inventory.scripts, priorPlan, {
      controllerContracts: contracts,
      reviewedOverrides,
    });
    const crasher = plan.scripts.find((script) => script.sourceScript.path === 'a/ahn_crop_crasher.txt')!;
    expect(
      crasher.obligations.find((obligation) => obligation.id === 'target-validity-and-zone-change-cleanup'),
    ).toMatchObject({
      claims: [{ controller: 'local' }, { controller: 'engine' }],
    });
    expect(plan.scripts).toHaveLength(509);
  });
});
