/** Materializes portable exact-script qualifications from a verified coverage bundle. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  buildPrintedScriptQualificationReceipt,
  verifyPrintedScriptQualificationReceipt,
} from '@mtg/printed-card/node';

const FileSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const InventorySchema = z.object({
  scripts: z.array(
    z.object({
      sourceScript: FileSchema,
      families: z.array(z.string().min(1)).min(1),
    }),
  ),
});
const CoverageSchema = z.object({
  evidenceVerification: z.enum(['scenario-receipts-verified', 'controller-evidence-verified']),
  scripts: z.array(
    z.object({
      sourceScript: FileSchema,
      status: z.enum(['requirements-covered', 'partial', 'missing-review']),
    }),
  ),
});

const { values } = parseArgs({
  options: {
    evidence: { type: 'string' },
    inventory: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.evidence || !values.inventory || !values.out) {
  throw new Error(
    'Usage: build-script-qualification-bundle --evidence <receipt-dir> --inventory <inventory.json> --out <new-dir>',
  );
}

const evidenceRoot = resolve(values.evidence);
const outputRoot = resolve(values.out);
if (existsSync(outputRoot)) throw new Error(`Output already exists: ${outputRoot}`);
const planBytes = readFileSync(join(evidenceRoot, 'coverage-plan.json'));
const reportBytes = readFileSync(join(evidenceRoot, 'script-coverage.json'));
const inventory = InventorySchema.parse(JSON.parse(readFileSync(resolve(values.inventory), 'utf8')));
const coverage = CoverageSchema.parse(JSON.parse(reportBytes.toString('utf8')));
const inventoryByPath = new Map(inventory.scripts.map((entry) => [entry.sourceScript.path, entry]));
const covered = coverage.scripts.filter((entry) => entry.status === 'requirements-covered');
const probeNames = readdirSync(join(evidenceRoot, 'probes'))
  .filter((name) => name.endsWith('.json'))
  .sort();
const scenarioReceipts = probeNames.map((name) => ({
  path: `probes/${name}`,
  bytes: readFileSync(join(evidenceRoot, 'probes', name)),
}));
const contractDirectory = join(evidenceRoot, 'contracts');
const contractNames = existsSync(contractDirectory)
  ? readdirSync(contractDirectory)
      .filter((name) => name.endsWith('.json'))
      .sort()
  : [];
if (coverage.evidenceVerification === 'controller-evidence-verified' && contractNames.length === 0)
  throw new Error('Controller-verified coverage omitted its controller contracts');
const controllerContracts = contractNames.map((name) => ({
  path: `contracts/${name}`,
  bytes: readFileSync(join(contractDirectory, name)),
}));

cpSync(evidenceRoot, outputRoot, { recursive: true, errorOnExist: true, force: false });
mkdirSync(join(outputRoot, 'qualifications'), { recursive: true });

const qualifications = covered.map((entry) => {
  const decision = inventoryByPath.get(entry.sourceScript.path);
  if (decision === undefined || decision.sourceScript.sha256 !== entry.sourceScript.sha256) {
    throw new Error(`Coverage and decision inventory differ: ${entry.sourceScript.path}`);
  }
  const receipt = buildPrintedScriptQualificationReceipt({
    coverageReport: { path: 'script-coverage.json', bytes: reportBytes },
    coveragePlan: { path: 'coverage-plan.json', bytes: planBytes },
    scenarioReceipts,
    controllerContracts,
    sourceScript: entry.sourceScript,
    decisionFamilies: decision.families,
  });
  const path = `qualifications/${entry.sourceScript.sha256}.json`;
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(join(outputRoot, path), bytes, { flag: 'wx' });
  verifyPrintedScriptQualificationReceipt(bytes, (evidencePath) =>
    readFileSync(join(outputRoot, evidencePath)),
  );
  return { sourceScript: entry.sourceScript, path };
});

const manifest = {
  schemaVersion: 1,
  kind: 'printed-script-qualification-bundle',
  evidence: basename(evidenceRoot),
  qualifications,
  residualScripts: coverage.scripts
    .filter((entry) => entry.status !== 'requirements-covered')
    .map((entry) => ({ sourceScript: entry.sourceScript, status: entry.status })),
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'wx',
});
process.stdout.write(
  `${JSON.stringify({ outputRoot, qualified: qualifications.length, residual: manifest.residualScripts.length })}\n`,
);
