/** Source-region-bound assembly and verification for atomic controller contracts. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  PrintedControllerContractEngineRuntimeSchema,
  PrintedControllerContractReceiptSchema,
  PrintedScenarioProbeReceiptSchema,
  type PrintedControllerContractReceipt,
} from '../index';

const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const decode = (bytes: string | Uint8Array): string =>
  typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const parse = (bytes: string | Uint8Array): unknown => JSON.parse(decode(bytes));

interface SourceRegionDefinition {
  readonly path: string;
  readonly beginMarker: string;
  readonly endMarker: string;
}

function engineRuntimeOf(input: unknown) {
  const runtime = PrintedScenarioProbeReceiptSchema.shape.runtime.parse(input);
  return PrintedControllerContractEngineRuntimeSchema.parse({
    forgeVersion: runtime.forgeVersion,
    forgeJarSha256: runtime.forgeJarSha256,
    scriptArchiveSha256: runtime.scriptArchiveSha256,
    resourcesSha256: runtime.resourcesSha256,
    protocolVersion: runtime.protocolVersion,
  });
}

function sourceRegion(bytes: string | Uint8Array, definition: SourceRegionDefinition): string {
  const source = decode(bytes);
  const begin = source.indexOf(definition.beginMarker);
  const end = source.indexOf(definition.endMarker, begin + definition.beginMarker.length);
  if (
    begin < 0 ||
    end < 0 ||
    source.indexOf(definition.beginMarker, begin + definition.beginMarker.length) >= 0 ||
    source.indexOf(definition.endMarker, end + definition.endMarker.length) >= 0
  ) {
    throw new Error(`Controller contract markers must occur exactly once: ${definition.path}`);
  }
  return source.slice(begin, end + definition.endMarker.length);
}

export function buildPrintedControllerContractReceipt(input: {
  readonly id: string;
  readonly decisionFamilies: readonly string[];
  readonly engineRuntime: unknown;
  readonly sourceRegions: readonly SourceRegionDefinition[];
  readonly scenarioReceipts: readonly { readonly path: string; readonly bytes: string | Uint8Array }[];
  readonly readSource: (path: string) => string | Uint8Array;
}): PrintedControllerContractReceipt {
  const engineRuntime = PrintedControllerContractEngineRuntimeSchema.parse(input.engineRuntime);
  const decisionFamilies = [...new Set(input.decisionFamilies)].sort();
  if (decisionFamilies.length === 0) throw new Error('Controller contract requires decision families');
  const scenarios = input.scenarioReceipts.map((file) => ({
    file,
    receipt: PrintedScenarioProbeReceiptSchema.parse(parse(file.bytes)),
  }));
  if (new Set(scenarios.map(({ receipt }) => receipt.result.id)).size !== scenarios.length)
    throw new Error('Duplicate controller contract scenario receipt');
  if (scenarios.some(({ receipt }) => !isDeepStrictEqual(engineRuntimeOf(receipt.runtime), engineRuntime)))
    throw new Error('Controller contract scenario engine runtime mismatch');
  const controllerClaims = (['local', 'engine'] as const).map((controller) => {
    const matching = scenarios.filter(({ receipt }) => receipt.result.controller === controller);
    if (matching.length === 0) throw new Error('Controller contract requires local and engine evidence');
    for (const family of decisionFamilies) {
      if (!matching.some(({ receipt }) => receipt.result.decisionFamilies.includes(family)))
        throw new Error(`${controller} controller contract evidence does not cover ${family}`);
    }
    return {
      controller,
      scenarioReceiptIds: matching.map(({ receipt }) => receipt.result.id).sort(),
    };
  });
  return PrintedControllerContractReceiptSchema.parse({
    schemaVersion: 1,
    kind: 'printed-controller-contract-receipt',
    id: input.id,
    engineRuntime,
    decisionFamilies,
    sourceRegions: input.sourceRegions
      .map((region) => ({
        ...region,
        sha256: digest(sourceRegion(input.readSource(region.path), region)),
      }))
      .sort((left, right) =>
        `${left.path}\0${left.beginMarker}`.localeCompare(`${right.path}\0${right.beginMarker}`),
      ),
    controllerClaims,
    evidence: {
      scenarioReceipts: scenarios
        .map(({ file, receipt }) => ({
          receiptId: receipt.result.id,
          file: { path: file.path, sha256: digest(file.bytes) },
        }))
        .sort((left, right) => left.receiptId.localeCompare(right.receiptId)),
    },
  });
}

/** Rebuilds the contract from retained scenarios and only its declared source regions. */
export function verifyPrintedControllerContractReceipt(input: {
  readonly body: string | Uint8Array;
  readonly expectedEngineRuntime: unknown;
  readonly readEvidence: (path: string) => string | Uint8Array;
  readonly readSource: (path: string) => string | Uint8Array;
}): PrintedControllerContractReceipt {
  const expected = PrintedControllerContractReceiptSchema.parse(parse(input.body));
  const runtime = PrintedControllerContractEngineRuntimeSchema.parse(input.expectedEngineRuntime);
  if (!isDeepStrictEqual(expected.engineRuntime, runtime))
    throw new Error('Controller contract engine runtime mismatch');
  for (const region of expected.sourceRegions) {
    if (digest(sourceRegion(input.readSource(region.path), region)) !== region.sha256)
      throw new Error(`Controller contract source region changed: ${region.path}`);
  }
  const scenarios = expected.evidence.scenarioReceipts.map(({ file }) => {
    const bytes = input.readEvidence(file.path);
    if (digest(bytes) !== file.sha256)
      throw new Error(`Controller contract evidence checksum mismatch: ${file.path}`);
    return { path: file.path, bytes };
  });
  const rebuilt = buildPrintedControllerContractReceipt({
    id: expected.id,
    decisionFamilies: expected.decisionFamilies,
    engineRuntime: runtime,
    sourceRegions: expected.sourceRegions.map(({ sha256: _sha256, ...region }) => region),
    scenarioReceipts: scenarios,
    readSource: input.readSource,
  });
  if (!isDeepStrictEqual(rebuilt, expected))
    throw new Error('Controller contract receipt does not match retained evidence');
  return expected;
}
