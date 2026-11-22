import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createScenarioProbeReceipts } from '../../tools/printed-scenario-receipts';
import { PrintedPlayProbeReceiptSchema } from '@mtg/printed-card';
import exertConfig from '../../data/akh-hou-exert-scenarios-v1.json';
import textlessProfileConfig from '../../data/akh-hou-textless-profile-scenarios-v1.json';
import {
  verifyScenarioProbeReceipts,
  verifyRetainedScenarioProbeReceipts,
} from '../../tools/printed-scenario-verify';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

it('declares the generic controller families exercised by every retained exert scenario', () => {
  for (const probe of exertConfig.probes.filter((entry) => entry.id.includes('exert-scenario'))) {
    expect(probe.decisionFamilies).toEqual(expect.arrayContaining(['priority', 'optional-costs', 'combat']));
    if (probe.sourceName !== 'Gust Walker') expect(probe.decisionFamilies).toContain('targets');
  }
});

it('binds the largest reusable profile to one exact bilateral script scenario', () => {
  expect(textlessProfileConfig.probes).toEqual(
    (['local', 'engine'] as const).map((controller) => ({
      id: `ancient-crab-${controller}-controller-profile-v1`,
      scope: 'scenario',
      controller,
      sourceName: 'Ancient Crab',
      sourceSeat: controller === 'local' ? 0 : 1,
      decisionFamilies: ['priority', 'combat'],
      assertions: [`Ancient Crab ${controller} controller profile`],
      testFile: 'packages/forge-export/test/bridge-textless-controller-profile.integration.test.ts',
    })),
  );
});
const script = 'Name:Gust Walker\nK:Exert\n';
const runtime = {
  forgeVersion: 'fixture',
  forgeJarSha256: hash('jar'),
  scriptArchiveSha256: hash('scripts'),
  resourcesSha256: hash('res'),
  bridgeSha256: hash('bridge'),
  adapterSha256: hash('adapter'),
  protocolVersion: 1,
};
const testFile = 'packages/forge-export/test/probe.test.ts';
const probe = {
  id: 'walker',
  scope: 'scenario' as const,
  controller: 'engine' as const,
  sourceName: 'Gust Walker',
  sourceSeat: 1 as const,
  decisionFamilies: ['combat-exert'],
  assertions: ['native accepts'],
  testFile,
};
const testIdentity = { id: 'case-1', ancestorTitles: ['native'], title: 'accepts' };
const seat = { life: 20, hand: [], library: ['Plains'], battlefield: ['Gust Walker'], graveyard: [] };
const state = { schemaVersion: 1, active: 1, phase: 'MAIN1', seats: [seat, seat] };
function input(workspace = '/workspace') {
  return {
    workspace,
    probes: [probe],
    runtime,
    cards: [
      {
        name: 'Gust Walker',
        correctedName: 'Gust Walker',
        forgeScript: 'g/gust_walker.txt',
        forgeScriptSha256: hash(script),
      },
    ],
    sources: [{ path: `${workspace}/${testFile}`, sha256: hash('test') }],
    reportBytes: JSON.stringify({
      success: true,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: `${workspace}/${testFile}`,
          status: 'passed',
          assertionResults: [
            { ...testIdentity, fullName: 'native accepts', status: 'passed', failureMessages: [] },
          ],
        },
      ],
    }),
    usageBytes:
      JSON.stringify({
        testFile: `${workspace}/${testFile}`,
        testName: 'native > accepts',
        testIdentity,
        runtime,
        formatId: 'akh-hou',
        controllers: ['local', 'engine'],
        scenario: { state, sha256: hash(JSON.stringify(state)), seed: 'fixture', maximumTurns: 8 },
      }) + '\n',
    readScript: (_path: string) => script,
  };
}
it('produces source/script-bound scenario receipts with retained report and usage digests', () => {
  const source = input();
  const [receipt] = createScenarioProbeReceipts(source);
  const { testFile: _file, ...result } = probe;
  expect(receipt).toMatchObject({
    kind: 'printed-scenario-probe-receipt',
    runtime,
    result: { ...result, status: 'passed' },
    sourceScript: { path: 'g/gust_walker.txt', sha256: hash(script) },
    sources: [{ path: testFile, sha256: hash('test') }],
    evidence: {
      report: { path: 'vitest.json', sha256: hash(source.reportBytes) },
      usage: { path: 'snapshot-usage.jsonl', sha256: hash(source.usageBytes) },
    },
  });
  expect(receipt?.cases[0]).toMatchObject({
    testFile,
    testIdentity,
    stateSha256: hash(JSON.stringify(state)),
  });
  expect(PrintedPlayProbeReceiptSchema.safeParse(receipt).success).toBe(false);
});
it('uses portable source identities and shares one script identity across matching reprints', () => {
  const source = input('/another-worktree');
  const first = createScenarioProbeReceipts(input())[0]!;
  const second = createScenarioProbeReceipts({ ...source, cards: [...source.cards, ...source.cards] })[0]!;
  expect(second.sources).toEqual(first.sources);
  expect(second.sourceScript).toEqual(first.sourceScript);
  expect(second.cases).toEqual(first.cases);
});
it.each(['missing', 'changed', 'ambiguous', 'unsafe', 'outside-source'])(
  'refuses %s source bindings before issuing receipts',
  (failure) => {
    const source = input();
    const changed =
      failure === 'missing'
        ? { ...source, cards: [] }
        : failure === 'changed'
          ? { ...source, readScript: () => 'changed bytes' }
          : failure === 'ambiguous'
            ? {
                ...source,
                cards: [...source.cards, { ...source.cards[0]!, forgeScriptSha256: hash('other') }],
              }
            : failure === 'unsafe'
              ? { ...source, cards: [{ ...source.cards[0]!, forgeScript: '../escape.txt' }] }
              : { ...source, sources: [{ path: '/another/test.ts', sha256: hash('test') }] };
    expect(() => createScenarioProbeReceipts(changed)).toThrow();
  },
);

it('independently checks retained receipts against reviewed claims and current bindings', () => {
  const expected = input();
  const receipts = createScenarioProbeReceipts(expected);
  expect(verifyScenarioProbeReceipts({ ...expected, receipts })).toEqual({
    receipts,
    qualification: 'unproven',
  });
});
it.each([
  'runtime',
  'script',
  'source',
  'report',
  'usage',
  'claim',
  'case',
  'missing',
  'duplicate',
  'scope',
] as const)('rejects stale or substituted %s evidence', (failure) => {
  const expected = input();
  const receipt = createScenarioProbeReceipts(expected)[0]!;
  const changed =
    failure === 'runtime'
      ? { ...expected, runtime: { ...runtime, bridgeSha256: hash('new bridge') } }
      : failure === 'script'
        ? { ...expected, readScript: () => 'different script' }
        : failure === 'source'
          ? { ...expected, sources: [{ ...expected.sources[0]!, sha256: hash('new test') }] }
          : failure === 'report'
            ? { ...expected, reportBytes: `${expected.reportBytes}\n` }
            : failure === 'usage'
              ? { ...expected, usageBytes: `${expected.usageBytes}\n` }
              : failure === 'claim'
                ? { ...expected, probes: [{ ...probe, decisionFamilies: ['whole-card'] }] }
                : expected;
  const receipts =
    failure === 'missing'
      ? []
      : failure === 'duplicate'
        ? [receipt, receipt]
        : failure === 'scope'
          ? [{ ...receipt, result: { ...receipt.result, scope: 'card' } }]
          : failure === 'case'
            ? [{ ...receipt, cases: [{ ...receipt.cases[0]!, seed: 'other' }] }]
            : [receipt];
  expect(() => verifyScenarioProbeReceipts({ ...changed, receipts })).toThrow();
});
it('does not let rewritten hashes bless a failed report or a false journal observation', () => {
  const expected = input();
  const receipt = createScenarioProbeReceipts(expected)[0]!;
  const reportBytes = JSON.stringify({ ...JSON.parse(expected.reportBytes), success: false });
  expect(() =>
    verifyScenarioProbeReceipts({
      ...expected,
      reportBytes,
      receipts: [
        {
          ...receipt,
          evidence: { ...receipt.evidence, report: { path: 'vitest.json', sha256: hash(reportBytes) } },
        },
      ],
    }),
  ).toThrow();
  const usageBytes = JSON.stringify({ ...JSON.parse(expected.usageBytes), controllers: ['engine', 'local'] });
  expect(() =>
    verifyScenarioProbeReceipts({
      ...expected,
      usageBytes,
      receipts: [
        {
          ...receipt,
          evidence: {
            ...receipt.evidence,
            usage: { path: 'snapshot-usage.jsonl', sha256: hash(usageBytes) },
          },
        },
      ],
    }),
  ).toThrow();
});

it('consumes retained bytes using only reviewed IDs and fixed evidence names', async () => {
  const expected = input();
  const receipts = createScenarioProbeReceipts(expected);
  const files: Readonly<Record<string, string>> = {
    'vitest.json': expected.reportBytes,
    'snapshot-usage.jsonl': expected.usageBytes,
    'probes/walker.json': JSON.stringify(receipts[0]),
  };
  const readEvidence = vi.fn(async (path: string) => {
    const bytes = files[path];
    if (bytes === undefined) throw new Error(`Missing evidence: ${path}`);
    return bytes;
  });
  expect(await verifyRetainedScenarioProbeReceipts({ ...expected, readEvidence })).toEqual({
    receipts,
    qualification: 'unproven',
  });
  expect(readEvidence.mock.calls.map(([path]) => path).sort()).toEqual(Object.keys(files).sort());
  readEvidence.mockRejectedValue(new Error('Evidence unavailable'));
  await expect(verifyRetainedScenarioProbeReceipts({ ...expected, readEvidence })).rejects.toThrow(
    'Evidence unavailable',
  );
});
it('refuses unsafe reviewed IDs before reading any retained evidence', async () => {
  const expected = input();
  const readEvidence = vi.fn();
  await expect(
    verifyRetainedScenarioProbeReceipts({
      ...expected,
      probes: [{ ...probe, id: '../escape' }],
      readEvidence,
    }),
  ).rejects.toThrow();
  expect(readEvidence).not.toHaveBeenCalled();
});
