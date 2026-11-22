import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { PrintedScenarioProbeReceiptSchema } from '../src/scenario-receipt';
import {
  buildPrintedControllerContractReceipt,
  verifyPrintedControllerContractReceipt,
} from '../src/node/controller-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const engineRuntime = {
  forgeVersion: '2.0.14',
  forgeJarSha256: hash('jar'),
  scriptArchiveSha256: hash('scripts'),
  resourcesSha256: hash('resources'),
  protocolVersion: 7,
};
const bridgeSource = [
  'unrelated before',
  '// contract:bounded-targets:begin',
  'chooseOneOfTheEnumeratedLegalTargets();',
  '// contract:bounded-targets:end',
  'unrelated after',
].join('\n');

function scenario(controller: 'local' | 'engine') {
  const id = `bounded-targets-${controller}-v1`;
  return PrintedScenarioProbeReceiptSchema.parse({
    schemaVersion: 1,
    kind: 'printed-scenario-probe-receipt',
    runtime: {
      ...engineRuntime,
      bridgeSha256: hash(`historical-bridge-${controller}`),
      adapterSha256: hash(`historical-adapter-${controller}`),
    },
    result: {
      id,
      scope: 'scenario',
      controller,
      sourceName: 'Test Card',
      sourceSeat: controller === 'local' ? 0 : 1,
      decisionFamilies: ['targets'],
      assertions: [`${controller} chooses a bounded legal target`],
      status: 'passed',
    },
    sourceScript: { path: 't/test_card.txt', sha256: hash('card script') },
    sources: [{ path: `test/${controller}.test.ts`, sha256: hash(`${controller} test`) }],
    cases: [
      {
        testFile: `test/${controller}.test.ts`,
        testIdentity: {
          id: `${controller}-case`,
          ancestorTitles: [],
          title: `${controller} chooses a bounded legal target`,
        },
        formatId: 'format-used-to-produce-evidence',
        stateSha256: hash(`${controller} state`),
        seed: `${controller}-seed`,
        maximumTurns: 4,
      },
    ],
    evidence: {
      report: { path: 'vitest.json', sha256: hash(`${controller} report`) },
      usage: { path: 'snapshot-usage.jsonl', sha256: hash(`${controller} usage`) },
    },
  });
}

function fixture(source = bridgeSource) {
  const receipts = [scenario('local'), scenario('engine')];
  const files = new Map(
    receipts.map((receipt) => [`receipts/${receipt.result.id}.json`, `${JSON.stringify(receipt)}\n`]),
  );
  const receipt = buildPrintedControllerContractReceipt({
    id: 'bounded-enumerated-targets-v1',
    decisionFamilies: ['targets'],
    engineRuntime,
    sourceRegions: [
      {
        path: 'packages/forge-export/bridge/ForgeBridge.java',
        beginMarker: '// contract:bounded-targets:begin',
        endMarker: '// contract:bounded-targets:end',
      },
    ],
    scenarioReceipts: [...files].map(([path, bytes]) => ({ path, bytes })),
    readSource: () => source,
  });
  return { files, receipt };
}

it('builds a format-neutral bilateral controller contract and verifies retained evidence', () => {
  const { files, receipt } = fixture();

  expect(receipt).toMatchObject({
    kind: 'printed-controller-contract-receipt',
    id: 'bounded-enumerated-targets-v1',
    decisionFamilies: ['targets'],
    controllerClaims: [
      { controller: 'local', scenarioReceiptIds: ['bounded-targets-local-v1'] },
      { controller: 'engine', scenarioReceiptIds: ['bounded-targets-engine-v1'] },
    ],
  });
  expect(JSON.stringify(receipt)).not.toContain('format-used-to-produce-evidence');
  expect(
    verifyPrintedControllerContractReceipt({
      body: JSON.stringify(receipt),
      expectedEngineRuntime: engineRuntime,
      readEvidence: (path) => files.get(path)!,
      readSource: () => bridgeSource,
    }),
  ).toEqual(receipt);
});

it('invalidates only a changed contract source region', () => {
  const { files, receipt } = fixture();
  const verify = (source: string) =>
    verifyPrintedControllerContractReceipt({
      body: JSON.stringify(receipt),
      expectedEngineRuntime: engineRuntime,
      readEvidence: (path) => files.get(path)!,
      readSource: () => source,
    });

  expect(verify(`changed outside\n${bridgeSource}`)).toEqual(receipt);
  expect(() => verify(bridgeSource.replace('chooseOneOfTheEnumeratedLegalTargets', 'chooseFirst'))).toThrow(
    'Controller contract source region changed',
  );
});

it('preserves indentation in source-region markers across receipt verification', () => {
  const source = ['before', '        void choose() {', '          decide();', '        void next() {'].join(
    '\n',
  );
  const receipts = [scenario('local'), scenario('engine')];
  const files = new Map(
    receipts.map((receipt) => [`receipts/${receipt.result.id}.json`, `${JSON.stringify(receipt)}\n`]),
  );
  const receipt = buildPrintedControllerContractReceipt({
    id: 'indented-source-region-v1',
    decisionFamilies: ['targets'],
    engineRuntime,
    sourceRegions: [
      {
        path: 'packages/forge-export/bridge/ForgeBridge.java',
        beginMarker: '        void choose() {',
        endMarker: '        void next() {',
      },
    ],
    scenarioReceipts: [...files].map(([path, bytes]) => ({ path, bytes })),
    readSource: () => source,
  });

  expect(
    verifyPrintedControllerContractReceipt({
      body: JSON.stringify(receipt),
      expectedEngineRuntime: engineRuntime,
      readEvidence: (path) => files.get(path)!,
      readSource: () => source,
    }),
  ).toEqual(receipt);
});

it('rejects stale engine evidence and incomplete controller scope', () => {
  const { files, receipt } = fixture();
  expect(() =>
    verifyPrintedControllerContractReceipt({
      body: JSON.stringify(receipt),
      expectedEngineRuntime: { ...engineRuntime, forgeJarSha256: hash('new jar') },
      readEvidence: (path) => files.get(path)!,
      readSource: () => bridgeSource,
    }),
  ).toThrow('Controller contract engine runtime mismatch');

  const localOnly = [...files].filter(([path]) => path.includes('-local-'));
  expect(() =>
    buildPrintedControllerContractReceipt({
      id: 'bounded-enumerated-targets-v1',
      decisionFamilies: ['targets'],
      engineRuntime,
      sourceRegions: [
        {
          path: 'packages/forge-export/bridge/ForgeBridge.java',
          beginMarker: '// contract:bounded-targets:begin',
          endMarker: '// contract:bounded-targets:end',
        },
      ],
      scenarioReceipts: localOnly.map(([path, bytes]) => ({ path, bytes })),
      readSource: () => bridgeSource,
    }),
  ).toThrow('Controller contract requires local and engine evidence');
});
