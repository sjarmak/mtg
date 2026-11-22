import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { parsePrintedCardCatalog, serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import {
  buildPrintedControllerContractReceipt,
  buildPrintedScriptCoveragePlan,
  buildPrintedScriptCoverageReport,
} from '@mtg/printed-card/node';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const script = 'Name:Example\nManaCost:1 W\nS:Mode$ OptionalAttackCost\nOracle:Example\n';
const sourceScript = { path: 'e/example.txt', sha256: hash(script) };
const runtime = {
  forgeVersion: 'fixture',
  forgeJarSha256: hash('jar'),
  scriptArchiveSha256: hash('archive'),
  resourcesSha256: hash('resources'),
  bridgeSha256: hash('bridge'),
  adapterSha256: hash('adapter'),
  protocolVersion: 1,
};
const original = parsePrintedCardCatalog(
  JSON.parse(readFileSync(new URL('../data/akh-hou/akh-printed-catalog-v1.json', import.meta.url), 'utf8')),
);
const unsealed = {
  ...original,
  cards: original.cards
    .slice(0, 2)
    .map((card) => ({ ...card, forgeScript: sourceScript.path, forgeScriptSha256: sourceScript.sha256 })),
};
const catalog = { ...unsealed, contentSha256: hash(serializedPrintedCardCatalogContent(unsealed)) };
const claim = (controller: 'local' | 'engine') => ({
  controller,
  receiptId: controller,
  assertions: [`${controller} exert`],
  decisionFamilies: ['exert'],
});
const obligation = {
  id: 'exert',
  description: 'Exert choice and skipped untap',
  lines: [3],
  dependsOn: [],
  proof: 'scenario',
  requiredControllers: ['local', 'engine'],
  claims: [claim('local'), claim('engine')],
};
const cast = {
  id: 'cast',
  description: 'Ordinary casting and characteristics',
  lines: [1, 2],
  dependsOn: [],
  proof: 'source',
};
const review = { sourceScript, review: 'complete', obligations: [cast, obligation], dependencies: [] };
const plan = { schemaVersion: 1, kind: 'printed-script-coverage-plan', scripts: [review] };
function receipt(controller: 'local' | 'engine') {
  const source = { path: 'test/exert.test.ts', sha256: hash('test') };
  return {
    schemaVersion: 1,
    kind: 'printed-scenario-probe-receipt',
    runtime,
    sourceScript,
    result: {
      id: controller,
      scope: 'scenario',
      controller,
      sourceSeat: controller === 'local' ? 0 : 1,
      sourceName: 'Example',
      decisionFamilies: ['exert'],
      assertions: [`${controller} exert`],
      status: 'passed',
    },
    sources: [source],
    cases: [
      {
        testFile: source.path,
        testIdentity: { id: controller, ancestorTitles: [], title: `${controller} exert` },
        formatId: 'example-format',
        stateSha256: hash('state'),
        seed: 'seed',
        maximumTurns: 8,
      },
    ],
    evidence: {
      report: { path: 'vitest.json', sha256: hash('report') },
      usage: { path: 'snapshot-usage.jsonl', sha256: hash('usage') },
    },
  };
}
function input() {
  return {
    catalogs: [catalog],
    plan,
    receipts: [receipt('local'), receipt('engine')],
    measuredRuntime: runtime,
    readScript: (_path: string) => script,
    readResource: (_path: string) => 'token',
  };
}
function controllerContract() {
  const contractRuntime = {
    forgeVersion: runtime.forgeVersion,
    forgeJarSha256: runtime.forgeJarSha256,
    scriptArchiveSha256: runtime.scriptArchiveSha256,
    resourcesSha256: runtime.resourcesSha256,
    protocolVersion: runtime.protocolVersion,
  };
  return buildPrintedControllerContractReceipt({
    id: 'exert-choice-v1',
    decisionFamilies: ['exert'],
    engineRuntime: contractRuntime,
    sourceRegions: [
      {
        path: 'packages/forge-export/bridge/ForgeBridge.java',
        beginMarker: '// contract:exert:begin',
        endMarker: '// contract:exert:end',
      },
    ],
    scenarioReceipts: (['local', 'engine'] as const).map((controller) => ({
      path: `probes/${controller}.json`,
      bytes: `${JSON.stringify(receipt(controller))}\n`,
    })),
    readSource: () => '// contract:exert:begin\nchooseExert();\n// contract:exert:end',
  });
}
it('mechanically accounts for every exact source declaration without claiming behavior', () => {
  const generated = buildPrintedScriptCoveragePlan([catalog], (_path) => script, []);
  expect(generated.scripts).toEqual([
    {
      sourceScript,
      review: 'partial',
      obligations: [
        {
          id: 'exact-source-declarations',
          description:
            'Exact non-comment Forge declarations are present and checksum-bound; behavior is not claimed.',
          lines: [1, 2, 3],
          dependsOn: [],
          proof: 'source',
        },
      ],
      dependencies: [],
    },
  ]);
  const report = buildPrintedScriptCoverageReport({ ...input(), plan: generated, receipts: [] });
  expect(report.summary).toMatchObject({ scripts: 1, partial: 1, missingReview: 0 });
  expect(report.scripts[0]?.obligations[0]).toMatchObject({
    proof: 'source',
    covered: { local: true, engine: true },
  });
});
it('preserves reviewed semantic overlays while rejecting stale or foreign reviews', () => {
  expect(buildPrintedScriptCoveragePlan([catalog], () => script, [review]).scripts).toEqual([review]);
  expect(() =>
    buildPrintedScriptCoveragePlan([catalog], () => script, [
      { ...review, sourceScript: { ...sourceScript, sha256: hash('stale') } },
    ]),
  ).toThrow(/stale script review/i);
  expect(() =>
    buildPrintedScriptCoveragePlan([catalog], () => script, [
      { ...review, sourceScript: { path: 'x/foreign.txt', sha256: hash('foreign') } },
    ]),
  ).toThrow(/foreign script review/i);
});
it('shares exact-script evidence across reprints but retains residual requirements and physical identities', () => {
  const report = buildPrintedScriptCoverageReport(input());
  expect(report.cards.map((card) => card.physicalId)).toEqual(catalog.cards.map((card) => card.physicalId));
  expect(report.scripts).toHaveLength(1);
  expect(report.scripts[0]).toMatchObject({
    sourceScript,
    status: 'requirements-covered',
    unmappedLines: [],
    obligations: [
      { id: 'cast', covered: { local: true, engine: true } },
      { id: 'exert', covered: { local: true, engine: true } },
    ],
  });
  expect(report).toMatchObject({
    admitted: false,
    evidenceVerification: 'not-performed',
    summary: { printings: 2, scripts: 1, requirementsCovered: 1, partial: 0, missingReview: 0 },
  });
});
it('does not infer support from a mechanic label, an unmapped line or a partial review', () => {
  const base = input();
  for (const scripts of [
    [],
    [{ ...review, obligations: [obligation] }],
    [{ ...review, review: 'partial', obligations: [{ ...obligation, lines: [1, 2, 3] }] }],
  ]) {
    const report = buildPrintedScriptCoverageReport({ ...base, plan: { ...plan, scripts } });
    expect(report.summary.requirementsCovered).toBe(0);
  }
});
it('requires every declared controller with exact script, assertion and family bindings', () => {
  for (const changed of [
    { ...receipt('engine'), sourceScript: { ...sourceScript, sha256: hash('other') } },
    { ...receipt('engine'), result: { ...receipt('engine').result, decisionFamilies: ['other'] } },
    { ...receipt('engine'), result: { ...receipt('engine').result, id: 'unlinked' } },
  ]) {
    const report = buildPrintedScriptCoverageReport({ ...input(), receipts: [receipt('local'), changed] });
    expect(report.scripts[0]?.obligations.find((row) => row.id === 'exert')?.covered).toEqual({
      local: true,
      engine: false,
    });
  }
});
it('reuses an atomic cross-script contract without requiring unrelated representative obligations', () => {
  const representativeScript = { path: 'r/representative.txt', sha256: hash(script) };
  const representativeReceipt = (controller: 'local' | 'engine') => ({
    ...receipt(controller),
    sourceScript: representativeScript,
  });
  const profiledClaims = (['local', 'engine'] as const).map((controller) => ({
    ...claim(controller),
    capabilityProfile: 'optional-attack-v1',
  }));
  const targetReview = {
    ...review,
    obligations: [
      { ...cast, lines: [1, 2, 3] },
      { ...obligation, capabilityProfile: 'optional-attack-v1', claims: profiledClaims },
    ],
  };
  const representativeReview = {
    ...review,
    sourceScript: representativeScript,
    obligations: [{ ...cast }, { ...obligation, capabilityProfile: 'optional-attack-v1' }],
  };
  const covered = buildPrintedScriptCoverageReport({
    ...input(),
    plan: { ...plan, scripts: [targetReview, representativeReview] },
    receipts: [representativeReceipt('local'), representativeReceipt('engine')],
  });
  expect(covered.scripts[0]?.status).toBe('requirements-covered');

  const mismatched = buildPrintedScriptCoverageReport({
    ...input(),
    plan: {
      ...plan,
      scripts: [
        targetReview,
        {
          ...representativeReview,
          obligations: representativeReview.obligations.map((entry) =>
            entry.proof === 'scenario' ? { ...entry, capabilityProfile: 'different-profile-v1' } : entry,
          ),
        },
      ],
    },
    receipts: [representativeReceipt('local'), representativeReceipt('engine')],
  });
  expect(mismatched.scripts[0]?.status).toBe('partial');

  const residualRepresentative = buildPrintedScriptCoverageReport({
    ...input(),
    plan: {
      ...plan,
      scripts: [
        targetReview,
        {
          ...representativeReview,
          obligations: [
            ...representativeReview.obligations,
            { ...obligation, id: 'unproved-edge', claims: [] },
          ],
        },
      ],
    },
    receipts: [representativeReceipt('local'), representativeReceipt('engine')],
  });
  expect(residualRepresentative.scripts[0]?.status).toBe('requirements-covered');
});
it('covers a reviewed atomic decision through a verified bilateral controller contract', () => {
  const contractObligation = {
    ...obligation,
    controllerContractId: 'exert-choice-v1',
    decisionFamilies: ['exert'],
    claims: [],
  };
  const contractPlan = {
    ...plan,
    scripts: [{ ...review, obligations: [cast, contractObligation] }],
  };
  const covered = buildPrintedScriptCoverageReport({
    ...input(),
    plan: contractPlan,
    receipts: [],
    verifiedControllerContracts: [controllerContract()],
  });
  expect(covered.scripts[0]?.status).toBe('requirements-covered');
  expect(covered.scripts[0]?.obligations[1]).toMatchObject({
    controllerContractId: 'exert-choice-v1',
    covered: { local: true, engine: true },
  });

  const missing = buildPrintedScriptCoverageReport({
    ...input(),
    plan: contractPlan,
    receipts: [],
    verifiedControllerContracts: [],
  });
  expect(missing.scripts[0]?.status).toBe('partial');
});
it('does not manufacture a second controller requirement for a controller-specific behavior', () => {
  const engineOnly = {
    ...obligation,
    id: 'native-choice',
    requiredControllers: ['engine'],
    claims: [claim('engine')],
  };
  const complete = { ...review, obligations: [cast, engineOnly] };
  const report = buildPrintedScriptCoverageReport({
    ...input(),
    plan: { ...plan, scripts: [complete] },
    receipts: [receipt('engine')],
  });
  expect(report.scripts[0]?.status).toBe('requirements-covered');
  expect(report.scripts[0]?.obligations.find((row) => row.id === 'native-choice')).toMatchObject({
    requiredControllers: ['engine'],
    covered: { local: false, engine: true },
  });
});
it('rejects source accounting that smuggles in behavioral claims', () => {
  expect(() =>
    buildPrintedScriptCoverageReport({
      ...input(),
      plan: {
        ...plan,
        scripts: [{ ...review, obligations: [{ ...cast, claims: [claim('local')] }] }],
      },
    }),
  ).toThrow();
});
it('marks reviewed requirements covered only after every mapped obligation is covered, without admitting play', () => {
  const complete = { ...review, obligations: [cast, obligation] };
  const report = buildPrintedScriptCoverageReport({ ...input(), plan: { ...plan, scripts: [complete] } });
  expect(report.scripts[0]?.status).toBe('requirements-covered');
  expect(report.admitted).toBe(false);
  expect(report.evidenceVerification).toBe('not-performed');
});
it('retains composition dependencies even when the composition assertion itself passes', () => {
  const composite = { ...obligation, id: 'combined', dependsOn: ['cast', 'exert'] };
  const report = buildPrintedScriptCoverageReport({
    ...input(),
    plan: { ...plan, scripts: [{ ...review, obligations: [...review.obligations, composite] }] },
  });
  expect(report.scripts[0]?.obligations.find((row) => row.id === 'combined')).toMatchObject({
    covered: { local: true, engine: true },
    missingDependencies: { local: [], engine: [] },
  });
});
it('binds generated resources and their required behavior instead of treating token creation as a whole token proof', () => {
  const dependency = {
    resource: { path: 'tokenscripts/example.txt', sha256: hash('token') },
    obligations: ['cast'],
  };
  const expected = { ...input(), plan: { ...plan, scripts: [{ ...review, dependencies: [dependency] }] } };
  expect(buildPrintedScriptCoverageReport(expected).scripts[0]?.dependencies).toEqual([dependency]);
  expect(() =>
    buildPrintedScriptCoverageReport({ ...expected, readResource: () => 'changed token' }),
  ).toThrow(/resource checksum/i);
});
it.each([
  'stale-review',
  'unknown-line',
  'unknown-obligation',
  'cycle',
  'duplicate-review',
  'unsafe-resource',
  'stale-runtime',
])('refuses invalid %s rather than flattening it into coverage', (failure) => {
  const badReview =
    failure === 'stale-review'
      ? { ...review, sourceScript: { ...sourceScript, sha256: hash('old') } }
      : failure === 'unknown-line'
        ? { ...review, obligations: [{ ...obligation, lines: [999] }] }
        : failure === 'unknown-obligation'
          ? { ...review, obligations: [{ ...obligation, dependsOn: ['missing'] }] }
          : failure === 'cycle'
            ? { ...review, obligations: [{ ...obligation, dependsOn: ['exert'] }] }
            : failure === 'unsafe-resource'
              ? {
                  ...review,
                  dependencies: [
                    { resource: { path: '../escape', sha256: hash('token') }, obligations: ['exert'] },
                  ],
                }
              : review;
  const readResource = vi.fn(() => 'token');
  expect(() =>
    buildPrintedScriptCoverageReport({
      ...input(),
      readResource,
      plan: { ...plan, scripts: failure === 'duplicate-review' ? [review, review] : [badReview] },
      measuredRuntime: failure === 'stale-runtime' ? { ...runtime, bridgeSha256: hash('new') } : runtime,
    }),
  ).toThrow();
  if (failure === 'unsafe-resource') expect(readResource).not.toHaveBeenCalled();
});
it('preserves deterministic order and inputs across printing, review and receipt order', () => {
  const original = input();
  const before = JSON.stringify(original);
  const reversed = {
    ...original,
    receipts: [...original.receipts].reverse(),
    plan: { ...plan, scripts: [{ ...review, obligations: [...review.obligations].reverse() }] },
  };
  expect(buildPrintedScriptCoverageReport(reversed)).toEqual(buildPrintedScriptCoverageReport(original));
  expect(JSON.stringify(original)).toBe(before);
});
