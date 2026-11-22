import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  PrintedScriptQualificationReceiptSchema,
  evaluatePrintedPlayAdmission,
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedLimitedFormatContent,
} from '../src/index';
import {
  PrintedAdmissionRuntimeMismatchError,
  buildPrintedControllerContractReceipt,
  buildPrintedPlayAdmissionFromScriptQualifications,
  buildPrintedScriptQualificationReceipt,
  verifyPrintedLimitedPlayAdmission,
  verifyPrintedScriptQualificationReceipt,
} from '../src/node/index';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const runtime = {
  forgeVersion: 'fixture',
  forgeJarSha256: hash('jar'),
  scriptArchiveSha256: hash('archive'),
  resourcesSha256: hash('resources'),
  bridgeSha256: hash('bridge'),
  adapterSha256: hash('adapter'),
  protocolVersion: 1,
};
const sourceScript = { path: 'e/example.txt', sha256: hash('script') };
const scenario = (
  controller: 'local' | 'engine',
  script: { readonly path: string; readonly sha256: string } = sourceScript,
) => ({
  schemaVersion: 1 as const,
  kind: 'printed-scenario-probe-receipt' as const,
  runtime,
  sourceScript: script,
  result: {
    id: `${controller}-example`,
    scope: 'scenario' as const,
    controller,
    sourceName: 'Example',
    sourceSeat: controller === 'local' ? (0 as const) : (1 as const),
    decisionFamilies: ['targets'],
    assertions: [`${controller} targets`],
    status: 'passed' as const,
  },
  sources: [{ path: 'test/example.test.ts', sha256: hash('test') }],
  cases: [
    {
      testFile: 'test/example.test.ts',
      testIdentity: { id: controller, ancestorTitles: [], title: `${controller} targets` },
      formatId: 'fixture',
      stateSha256: hash('state'),
      seed: '1',
      maximumTurns: 4,
    },
  ],
  evidence: {
    report: { path: 'vitest.json', sha256: hash('report') },
    usage: { path: 'usage.jsonl', sha256: hash('usage') },
  },
});
const plan = {
  schemaVersion: 1 as const,
  kind: 'printed-script-coverage-plan' as const,
  scripts: [
    {
      sourceScript,
      review: 'complete' as const,
      obligations: [
        {
          id: 'target-choice',
          description: 'Choose the exact target exposed by this script.',
          lines: [1],
          dependsOn: [],
          proof: 'scenario' as const,
          requiredControllers: ['local', 'engine'] as const,
          claims: [
            {
              controller: 'local' as const,
              receiptId: 'local-example',
              assertions: ['local targets'],
              decisionFamilies: ['targets'],
            },
            {
              controller: 'engine' as const,
              receiptId: 'engine-example',
              assertions: ['engine targets'],
              decisionFamilies: ['targets'],
            },
          ],
        },
      ],
      dependencies: [
        {
          resource: { path: 'tokenscripts/example.txt', sha256: hash('token') },
          obligations: ['target-choice'],
        },
      ],
    },
  ],
};
const coverage = {
  schemaVersion: 1,
  kind: 'printed-script-coverage-report',
  evidenceVerification: 'scenario-receipts-verified',
  runtime,
  plan: { path: 'coverage-plan.json', sha256: hash(`${JSON.stringify(plan, null, 2)}\n`) },
  scripts: [
    {
      sourceScript,
      status: 'requirements-covered',
      obligations: [
        {
          ...plan.scripts[0]!.obligations[0],
          covered: { local: true, engine: true },
          missingDependencies: { local: [], engine: [] },
        },
      ],
      dependencies: plan.scripts[0]!.dependencies,
    },
  ],
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

it('retains and verifies atomic controller contracts in exact-script qualifications', () => {
  const contractRuntime = {
    forgeVersion: runtime.forgeVersion,
    forgeJarSha256: runtime.forgeJarSha256,
    scriptArchiveSha256: runtime.scriptArchiveSha256,
    resourcesSha256: runtime.resourcesSha256,
    protocolVersion: runtime.protocolVersion,
  };
  const contractSource = '// contract:targets:begin\nchooseTarget();\n// contract:targets:end';
  const scenarioFiles = (['local', 'engine'] as const).map((controller) => ({
    path: `contracts/probes/${controller}.json`,
    bytes: json(scenario(controller)),
  }));
  const contract = buildPrintedControllerContractReceipt({
    id: 'bounded-target-choice-v1',
    decisionFamilies: ['targets'],
    engineRuntime: contractRuntime,
    sourceRegions: [
      {
        path: 'contracts/source/ForgeBridge.java',
        beginMarker: '// contract:targets:begin',
        endMarker: '// contract:targets:end',
      },
    ],
    scenarioReceipts: scenarioFiles,
    readSource: () => contractSource,
  });
  const contractPlan = {
    ...plan,
    scripts: [
      {
        ...plan.scripts[0]!,
        obligations: [
          {
            ...plan.scripts[0]!.obligations[0]!,
            controllerContractId: contract.id,
            decisionFamilies: ['targets'],
            claims: [],
          },
        ],
      },
    ],
  };
  const contractCoverage = {
    ...coverage,
    plan: { path: 'coverage-plan.json', sha256: hash(json(contractPlan)) },
    scripts: [
      {
        ...coverage.scripts[0]!,
        obligations: [
          {
            ...contractPlan.scripts[0]!.obligations[0]!,
            covered: { local: true, engine: true },
          },
        ],
      },
    ],
  };
  const files = new Map<string, string>([
    ['script-coverage.json', json(contractCoverage)],
    ['coverage-plan.json', json(contractPlan)],
    ['contracts/bounded-target-choice-v1.json', json(contract)],
    ['contracts/source/ForgeBridge.java', contractSource],
    ...scenarioFiles.map(({ path, bytes }) => [path, bytes] as const),
  ]);
  const qualification = buildPrintedScriptQualificationReceipt({
    coverageReport: { path: 'script-coverage.json', bytes: files.get('script-coverage.json')! },
    coveragePlan: { path: 'coverage-plan.json', bytes: files.get('coverage-plan.json')! },
    scenarioReceipts: [],
    controllerContracts: [
      {
        path: 'contracts/bounded-target-choice-v1.json',
        bytes: files.get('contracts/bounded-target-choice-v1.json')!,
      },
    ],
    sourceScript,
    decisionFamilies: ['targets'],
  });
  expect(qualification.controllerClaims).toEqual([
    {
      controller: 'local',
      decisionFamilies: ['targets'],
      scenarioReceiptIds: [],
      capabilityProfiles: [],
      controllerContractIds: ['bounded-target-choice-v1'],
    },
    {
      controller: 'engine',
      decisionFamilies: ['targets'],
      scenarioReceiptIds: [],
      capabilityProfiles: [],
      controllerContractIds: ['bounded-target-choice-v1'],
    },
  ]);
  expect(verifyPrintedScriptQualificationReceipt(json(qualification), (path) => files.get(path)!)).toEqual(
    qualification,
  );
});

function qualificationBundle() {
  const files = new Map([
    ['script-coverage.json', json(coverage)],
    ['coverage-plan.json', json(plan)],
    ['probes/local-example.json', json(scenario('local'))],
    ['probes/engine-example.json', json(scenario('engine'))],
  ]);
  const receipt = buildPrintedScriptQualificationReceipt({
    coverageReport: { path: 'script-coverage.json', bytes: files.get('script-coverage.json')! },
    coveragePlan: { path: 'coverage-plan.json', bytes: files.get('coverage-plan.json')! },
    scenarioReceipts: [
      { path: 'probes/local-example.json', bytes: files.get('probes/local-example.json')! },
      { path: 'probes/engine-example.json', bytes: files.get('probes/engine-example.json')! },
    ],
    sourceScript,
    decisionFamilies: ['targets'],
  });
  return {
    receipt,
    readEvidence: (path: string) => {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error(`Unexpected evidence path: ${path}`);
      return bytes;
    },
  };
}

const qualification = () => qualificationBundle().receipt;

function crossScriptQualification(capabilityProfile: string | undefined) {
  const representative = { path: 'r/representative.txt', sha256: hash('representative') };
  const claims = plan.scripts[0]!.obligations[0]!.claims.map((claim) => ({
    ...claim,
    ...(capabilityProfile === undefined ? {} : { capabilityProfile }),
  }));
  const crossPlan = {
    ...plan,
    scripts: [
      {
        ...plan.scripts[0]!,
        obligations: [
          {
            ...plan.scripts[0]!.obligations[0]!,
            ...(capabilityProfile === undefined ? {} : { capabilityProfile }),
            claims,
          },
        ],
      },
      {
        ...plan.scripts[0]!,
        sourceScript: representative,
        obligations: [
          {
            ...plan.scripts[0]!.obligations[0]!,
            ...(capabilityProfile === undefined ? {} : { capabilityProfile }),
          },
        ],
      },
    ],
  };
  const crossCoverage = {
    ...coverage,
    plan: { path: 'coverage-plan.json', sha256: hash(json(crossPlan)) },
    scripts: [...coverage.scripts, { ...coverage.scripts[0]!, sourceScript: representative }],
  };
  return () =>
    buildPrintedScriptQualificationReceipt({
      coverageReport: { path: 'script-coverage.json', bytes: json(crossCoverage) },
      coveragePlan: { path: 'coverage-plan.json', bytes: json(crossPlan) },
      scenarioReceipts: [
        { path: 'probes/local-example.json', bytes: json(scenario('local', representative)) },
        { path: 'probes/engine-example.json', bytes: json(scenario('engine', representative)) },
      ],
      sourceScript,
      decisionFamilies: ['targets'],
    });
}

it('builds an immutable exact-script qualification from covered local and engine scenarios', () => {
  expect(qualification()).toMatchObject({
    kind: 'printed-script-qualification-receipt',
    runtime,
    sourceScript,
    decisionFamilies: ['targets'],
    obligations: ['target-choice'],
    residualObligations: [],
    controllerClaims: [
      {
        controller: 'local',
        decisionFamilies: ['targets'],
        scenarioReceiptIds: ['local-example'],
        capabilityProfiles: [],
      },
      {
        controller: 'engine',
        decisionFamilies: ['targets'],
        scenarioReceiptIds: ['engine-example'],
        capabilityProfiles: [],
      },
    ],
    dependencies: [{ path: 'tokenscripts/example.txt', sha256: hash('token') }],
  });
  expect(() => PrintedScriptQualificationReceiptSchema.parse(qualification())).not.toThrow();
  const bundle = qualificationBundle();
  expect(verifyPrintedScriptQualificationReceipt(json(bundle.receipt), bundle.readEvidence)).toEqual(
    bundle.receipt,
  );
});

it('reuses a bilateral named capability profile across exact scripts', () => {
  const receipt = crossScriptQualification('mandatory-single-target-v1')();
  expect(receipt.controllerClaims).toEqual([
    {
      controller: 'local',
      decisionFamilies: ['targets'],
      scenarioReceiptIds: ['local-example'],
      capabilityProfiles: ['mandatory-single-target-v1'],
    },
    {
      controller: 'engine',
      decisionFamilies: ['targets'],
      scenarioReceiptIds: ['engine-example'],
      capabilityProfiles: ['mandatory-single-target-v1'],
    },
  ]);
});

it('refuses cross-script evidence without an explicit reusable capability profile', () => {
  expect(crossScriptQualification(undefined)).toThrow(/lacks capability profile/i);
});

it('refuses a capability label that is not bound to both reviewed exact scripts', () => {
  const build = crossScriptQualification('mandatory-single-target-v1');
  const representative = { path: 'r/representative.txt', sha256: hash('representative') };
  const claims = plan.scripts[0]!.obligations[0]!.claims.map((claim) => ({
    ...claim,
    capabilityProfile: 'mandatory-single-target-v1',
  }));
  const mismatchedPlan = {
    ...plan,
    scripts: [
      {
        ...plan.scripts[0]!,
        obligations: [
          {
            ...plan.scripts[0]!.obligations[0]!,
            capabilityProfile: 'mandatory-single-target-v1',
            claims,
          },
        ],
      },
      {
        ...plan.scripts[0]!,
        sourceScript: representative,
        obligations: [{ ...plan.scripts[0]!.obligations[0]!, capabilityProfile: 'different-profile-v1' }],
      },
    ],
  };
  const mismatchedCoverage = {
    ...coverage,
    plan: { path: 'coverage-plan.json', sha256: hash(json(mismatchedPlan)) },
    scripts: [...coverage.scripts, { ...coverage.scripts[0]!, sourceScript: representative }],
  };
  expect(() =>
    buildPrintedScriptQualificationReceipt({
      coverageReport: { path: 'script-coverage.json', bytes: json(mismatchedCoverage) },
      coveragePlan: { path: 'coverage-plan.json', bytes: json(mismatchedPlan) },
      scenarioReceipts: [
        { path: 'probes/local-example.json', bytes: json(scenario('local', representative)) },
        { path: 'probes/engine-example.json', bytes: json(scenario('engine', representative)) },
      ],
      sourceScript,
      decisionFamilies: ['targets'],
    }),
  ).toThrow(/capability profile/i);
  expect(build).not.toThrow();
});

it.each([
  ['partial script', { ...coverage, scripts: [{ ...coverage.scripts[0]!, status: 'partial' }] }],
  ['unverified evidence', { ...coverage, evidenceVerification: 'not-performed' }],
  [
    'uncovered controller',
    {
      ...coverage,
      scripts: [
        {
          ...coverage.scripts[0]!,
          obligations: [{ ...coverage.scripts[0]!.obligations[0]!, covered: { local: true, engine: false } }],
        },
      ],
    },
  ],
])('refuses %s rather than producing reusable evidence', (_label, changed) => {
  expect(() =>
    buildPrintedScriptQualificationReceipt({
      coverageReport: { path: 'script-coverage.json', bytes: json(changed) },
      coveragePlan: { path: 'coverage-plan.json', bytes: json(plan) },
      scenarioReceipts: [
        { path: 'probes/local-example.json', bytes: json(scenario('local')) },
        { path: 'probes/engine-example.json', bytes: json(scenario('engine')) },
      ],
      sourceScript,
      decisionFamilies: ['targets'],
    }),
  ).toThrow();
});

it.each(['runtime', 'script', 'dependency'])(
  'rejects rehashed %s drift against retained evidence',
  (field) => {
    const bundle = qualificationBundle();
    const changed =
      field === 'runtime'
        ? { ...bundle.receipt, runtime: { ...bundle.receipt.runtime, bridgeSha256: hash('changed') } }
        : field === 'script'
          ? { ...bundle.receipt, sourceScript: { ...sourceScript, sha256: hash('changed') } }
          : {
              ...bundle.receipt,
              dependencies: [{ path: 'tokenscripts/example.txt', sha256: hash('changed') }],
            };
    expect(() => verifyPrintedScriptQualificationReceipt(json(changed), bundle.readEvidence)).toThrow(
      /qualification/i,
    );
  },
);

it('rejects a coverage report whose dependency account differs from the reviewed plan', () => {
  const changed = {
    ...coverage,
    scripts: [{ ...coverage.scripts[0]!, dependencies: [] }],
  };
  expect(() =>
    buildPrintedScriptQualificationReceipt({
      coverageReport: { path: 'script-coverage.json', bytes: json(changed) },
      coveragePlan: { path: 'coverage-plan.json', bytes: json(plan) },
      scenarioReceipts: [
        { path: 'probes/local-example.json', bytes: json(scenario('local')) },
        { path: 'probes/engine-example.json', bytes: json(scenario('engine')) },
      ],
      sourceScript,
      decisionFamilies: ['targets'],
    }),
  ).toThrow(/dependency account mismatch/i);
});

function catalog(format: string) {
  const original = parsePrintedCardCatalog(
    JSON.parse(
      readFileSync(new URL('../../data/data/akh-hou/akh-printed-catalog-v1.json', import.meta.url), 'utf8'),
    ),
  );
  const draft = {
    ...original,
    format,
    cards: [
      {
        ...original.cards[0]!,
        physicalId: `${format}:0001:${original.cards[0]!.scryfallId}`,
        name: 'Example',
        forgeScript: sourceScript.path,
        forgeScriptSha256: sourceScript.sha256,
      },
    ],
  };
  return parsePrintedCardCatalog({
    ...draft,
    contentSha256: hash(serializedPrintedCardCatalogContent(draft)),
  });
}

it('reuses exact-script qualification across formats while retaining physical identities', () => {
  const qualified = qualificationBundle();
  const evidence = {
    path: 'qualification.json',
    bytes: json(qualified.receipt),
    readEvidence: qualified.readEvidence,
  };
  const one = catalog('one');
  const two = catalog('two');
  const matchProbes = () =>
    (['local', 'engine'] as const).map((controller) => ({
      id: `match-${controller}`,
      scope: 'match' as const,
      controller,
      cardIds: [],
      decisionFamilies: ['starting-player', 'mulligan', 'priority'],
      status: 'passed' as const,
      assertions: [`${controller} match`],
      evidence: { path: `match-${controller}.json`, sha256: hash(`match-${controller}`) },
    }));
  const admit = (entry: ReturnType<typeof catalog>) => {
    const subject = {
      ...runtime,
      formatId: entry.format,
      formatSha256: hash(`format-${entry.format}`),
      catalogs: { [entry.format]: entry.contentSha256 },
    };
    const admission = buildPrintedPlayAdmissionFromScriptQualifications({
      subject,
      catalogs: [entry],
      qualifications: [evidence],
      matchProbes: matchProbes(),
    });
    return {
      admission,
      verdict: evaluatePrintedPlayAdmission(admission, subject, [entry.cards[0]!.physicalId]),
    };
  };
  const first = admit(one);
  const second = admit(two);
  expect(first.verdict.admitted).toBe(true);
  expect(second.verdict.admitted).toBe(true);
  expect(first.admission.cards.map((card) => card.id)).toEqual([one.cards[0]!.physicalId]);
  expect(second.admission.cards.map((card) => card.id)).toEqual([two.cards[0]!.physicalId]);
});

it('accepts a catalog subject whose record keys have a different insertion order', () => {
  const qualified = qualificationBundle();
  const evidence = {
    path: 'qualification.json',
    bytes: json(qualified.receipt),
    readEvidence: qualified.readEvidence,
  };
  const one = catalog('one');
  const two = catalog('two');
  const subject = {
    ...runtime,
    formatId: 'combined',
    formatSha256: hash('combined'),
    catalogs: { two: two.contentSha256, one: one.contentSha256 },
  };
  const matchProbes = (['local', 'engine'] as const).map((controller) => ({
    id: `match-${controller}`,
    scope: 'match' as const,
    controller,
    cardIds: [],
    decisionFamilies: ['starting-player', 'mulligan', 'priority'],
    status: 'passed' as const,
    assertions: [`${controller} match`],
    evidence: { path: `match-${controller}.json`, sha256: hash(`match-${controller}`) },
  }));
  const admission = buildPrintedPlayAdmissionFromScriptQualifications({
    subject,
    catalogs: [one, two],
    qualifications: [evidence],
    matchProbes,
  });
  expect(admission.cards).toHaveLength(2);
});

it('independently verifies qualification-backed admission evidence against the format catalogs', () => {
  const qualified = qualificationBundle();
  const entry = catalog('one');
  const formatDraft = {
    schemaVersion: 1 as const,
    kind: 'printed-limited-format' as const,
    id: 'one-limited',
    name: 'One Limited',
    sources: [
      {
        code: 'one',
        catalogFormat: entry.format,
        catalogSha256: entry.contentSha256,
        mtgjson: { url: 'https://example.test/one.json', sha256: hash('source'), version: '1' },
      },
    ],
    products: [
      {
        id: 'one-draft',
        setCode: 'one',
        sourceSetCodes: ['one'],
        collation: {
          sheets: [{ name: 'cards', weights: { [entry.cards[0]!.physicalId]: 1 }, foil: false }],
          boosters: [{ contents: { cards: 1 }, weight: 1 }],
        },
      },
    ],
    draft: { seats: 2, rounds: ['one-draft'], botPolicy: 'fixture' },
    sealed: { boosters: ['one-draft'] },
    basicLandPolicy: 'remove' as const,
  };
  const format = parsePrintedLimitedFormat({
    ...formatDraft,
    contentSha256: hash(
      serializedPrintedLimitedFormatContent({
        ...formatDraft,
        contentSha256: hash('placeholder'),
      }),
    ),
  });
  const subject = {
    ...runtime,
    formatId: format.id,
    formatSha256: format.contentSha256,
    catalogs: { one: entry.contentSha256 },
  };
  const matchReceipts = new Map(
    (['local', 'engine'] as const).map((controller) => {
      const result = {
        id: `match-${controller}`,
        scope: 'match' as const,
        controller,
        cardIds: [],
        decisionFamilies: ['starting-player', 'mulligan', 'priority'],
        status: 'passed' as const,
        assertions: [`${controller} match`],
      };
      return [
        `probes/match-${controller}.json`,
        json({ schemaVersion: 1, kind: 'printed-play-probe-receipt', subject, result }),
      ];
    }),
  );
  const qualificationPath = 'qualifications/example.json';
  const qualificationBytes = json(qualified.receipt);
  const matchProbes = [...matchReceipts].map(([path, bytes]) => {
    const receipt = JSON.parse(bytes) as { result: Record<string, unknown> };
    return { ...receipt.result, evidence: { path, sha256: hash(bytes) } };
  });
  const admission = buildPrintedPlayAdmissionFromScriptQualifications({
    subject,
    catalogs: [entry],
    qualifications: [
      { path: qualificationPath, bytes: qualificationBytes, readEvidence: qualified.readEvidence },
    ],
    matchProbes,
  });
  const readEvidence = (path: string): string => {
    if (path === qualificationPath) return qualificationBytes;
    const match = matchReceipts.get(path);
    if (match !== undefined) return match;
    return qualified.readEvidence(path);
  };

  expect(verifyPrintedLimitedPlayAdmission(json(admission), format, [entry], runtime, readEvidence)).toEqual({
    admitted: true,
    reasons: [],
  });

  const rebuiltBridge = { ...runtime, bridgeSha256: hash('rebuilt-bridge') };
  expect(() =>
    verifyPrintedLimitedPlayAdmission(json(admission), format, [entry], rebuiltBridge, readEvidence),
  ).toThrow(PrintedAdmissionRuntimeMismatchError);
});
