/** Builds portable, source-bound atomic controller contracts from reviewed scenario receipts. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  PrintedScenarioProbeReceiptSchema,
  type PrintedControllerContractEngineRuntime,
} from '@mtg/printed-card';
import {
  buildPrintedControllerContractReceipt,
  verifyPrintedControllerContractReceipt,
} from '@mtg/printed-card/node';

const Path = z.string().trim().min(1);
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const SourceRegion = z.strictObject({
  path: Path,
  beginMarker: z.string().min(1),
  endMarker: z.string().min(1),
});
const Config = z.strictObject({
  schemaVersion: z.literal(1),
  workspace: Path,
  contracts: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u),
        decisionFamilies: z.array(Path).min(1),
        sourceRegions: z.array(SourceRegion).min(1),
        scenarioReceipts: z.array(Path).min(2),
      }),
    )
    .min(1),
});

function confined(root: string, path: string): string {
  const absolute = resolve(root, path);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`))
    throw new Error(`Path escapes its root: ${path}`);
  return absolute;
}

function portable(workspace: string, absolute: string): string {
  const path = relative(workspace, absolute).split(sep).join('/');
  if (path === '' || path === '..' || path.startsWith('../'))
    throw new Error(`Source outside workspace: ${absolute}`);
  return path;
}

function engineRuntimeOf(receipt: z.infer<typeof PrintedScenarioProbeReceiptSchema>) {
  return {
    forgeVersion: receipt.runtime.forgeVersion,
    forgeJarSha256: receipt.runtime.forgeJarSha256,
    scriptArchiveSha256: receipt.runtime.scriptArchiveSha256,
    resourcesSha256: receipt.runtime.resourcesSha256,
    protocolVersion: receipt.runtime.protocolVersion,
  } satisfies PrintedControllerContractEngineRuntime;
}

const { values } = parseArgs({
  options: { config: { type: 'string' }, out: { type: 'string' } },
  strict: true,
  allowPositionals: false,
});
if (!values.config || !values.out)
  throw new Error('Usage: build-controller-contract-bundle --config <json> --out <new-directory>');

const configPath = resolve(values.config);
const configRoot = dirname(configPath);
const config = Config.parse(JSON.parse(readFileSync(configPath, 'utf8')));
const workspace = resolve(configRoot, config.workspace);
const output = resolve(values.out);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
mkdirSync(join(output, 'contracts'), { recursive: true });
mkdirSync(join(output, 'scenarios'), { recursive: true });

const retained = new Map<string, Uint8Array>();
const retain = (path: string, bytes: Uint8Array): void => {
  const prior = retained.get(path);
  if (prior !== undefined && digest(prior) !== digest(bytes))
    throw new Error(`Conflicting retained file: ${path}`);
  retained.set(path, bytes);
};
const retainedFile = (path: string, kind: string): Uint8Array => {
  const bytes = retained.get(path);
  if (bytes === undefined) throw new Error(`Missing ${kind}: ${path}`);
  return bytes;
};
const contracts = config.contracts.map((definition) => {
  const scenarios = definition.scenarioReceipts.map((path) => {
    const absolute = confined(workspace, path);
    const bytes = readFileSync(absolute);
    const receipt = PrintedScenarioProbeReceiptSchema.parse(JSON.parse(bytes.toString('utf8')));
    const retainedPath = `scenarios/${receipt.result.id}.json`;
    retain(retainedPath, bytes);
    return { path: retainedPath, bytes, receipt };
  });
  const first = scenarios[0];
  if (first === undefined) throw new Error(`Controller contract has no scenarios: ${definition.id}`);
  const sourceRegions = definition.sourceRegions.map((region) => {
    const source = confined(workspace, region.path);
    const path = portable(workspace, source);
    retain(path, readFileSync(source));
    return { ...region, path };
  });
  const receipt = buildPrintedControllerContractReceipt({
    id: definition.id,
    decisionFamilies: definition.decisionFamilies,
    engineRuntime: engineRuntimeOf(first.receipt),
    sourceRegions,
    scenarioReceipts: scenarios.map(({ path, bytes }) => ({ path, bytes })),
    readSource: (path) => retainedFile(path, 'source'),
  });
  const path = `contracts/${definition.id}.json`;
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  retain(path, bytes);
  return { id: receipt.id, path, decisionFamilies: receipt.decisionFamilies };
});

for (const [path, bytes] of retained) {
  const destination = confined(output, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: 'wx' });
}
for (const contract of contracts) {
  const body = retainedFile(contract.path, 'retained contract');
  verifyPrintedControllerContractReceipt({
    body,
    expectedEngineRuntime: JSON.parse(body.toString()).engineRuntime,
    readEvidence: (path) => retainedFile(path, 'evidence'),
    readSource: (path) => retainedFile(path, 'source'),
  });
}
writeFileSync(
  join(output, 'manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, kind: 'printed-controller-contract-bundle', contracts }, null, 2)}\n`,
  { flag: 'wx' },
);
process.stdout.write(`${JSON.stringify({ output, contracts: contracts.length })}\n`);
