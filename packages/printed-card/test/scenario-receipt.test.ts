import { expect, it } from 'vitest';
import { PrintedScenarioProbeReceiptSchema, PrintedPlayProbeReceiptSchema } from '../src/index';

const hash = 'a'.repeat(64);
const receipt = {
  schemaVersion: 1,
  kind: 'printed-scenario-probe-receipt',
  runtime: {
    forgeVersion: 'fixture',
    forgeJarSha256: hash,
    scriptArchiveSha256: hash,
    resourcesSha256: hash,
    bridgeSha256: hash,
    adapterSha256: hash,
    protocolVersion: 1,
  },
  result: {
    id: 'exert-native',
    scope: 'scenario',
    controller: 'engine',
    sourceName: 'Gust Walker',
    sourceSeat: 1,
    decisionFamilies: ['combat-exert'],
    assertions: ['native accepts'],
    status: 'passed',
  },
  sourceScript: { path: 'g/gust_walker.txt', sha256: hash },
  sources: [{ path: 'packages/forge-export/test/probe.test.ts', sha256: hash }],
  cases: [
    {
      testFile: 'packages/forge-export/test/probe.test.ts',
      testIdentity: {
        id: 'case-1',
        ancestorTitles: ['native'],
        title: 'accepts',
      },
      formatId: 'akh-hou',
      stateSha256: hash,
      seed: 'fixture',
      maximumTurns: 8,
    },
  ],
  evidence: {
    report: { path: 'vitest.json', sha256: hash },
    usage: { path: 'snapshot-usage.jsonl', sha256: hash },
  },
};
it('represents script-bound case evidence without format admission or physical printing claims', () => {
  expect(PrintedScenarioProbeReceiptSchema.parse(receipt)).toEqual(receipt);
  expect(PrintedPlayProbeReceiptSchema.safeParse(receipt).success).toBe(false);
});
it.each([
  { ...receipt, result: { ...receipt.result, scope: 'card' } },
  { ...receipt, result: { ...receipt.result, cardIds: ['akh:19'] } },
  { ...receipt, result: { ...receipt.result, status: 'failed' } },
  { ...receipt, cases: [] },
  { ...receipt, cases: [...receipt.cases, ...receipt.cases] },
  { ...receipt, sources: [] },
  { ...receipt, sourceScript: { path: '../escape.txt', sha256: hash } },
  { ...receipt, sources: [{ path: '/absolute/test.ts', sha256: hash }] },
  { ...receipt, sources: [{ path: 'packages\\test.ts', sha256: hash }] },
  { ...receipt, sources: [...receipt.sources, ...receipt.sources] },
  { ...receipt, cases: [{ ...receipt.cases[0], testFile: 'packages/foreign.test.ts' }] },
  {
    ...receipt,
    cases: [{ ...receipt.cases[0], testIdentity: { ...receipt.cases[0]!.testIdentity, title: 'foreign' } }],
  },
])('rejects broadened, incomplete or nonportable case evidence %#', (input) => {
  expect(PrintedScenarioProbeReceiptSchema.safeParse(input).success).toBe(false);
});
