/** Writes exhaustive printed-format source/profile requirements; it does not mark them covered. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { PrintedDecisionInventorySchema } from '../src/printed-card/printed-decision-inventory';
import { buildPrintedCompleteCoveragePlan } from '../src/printed-card/printed-coverage-plan';

const { values } = parseArgs({
  options: {
    inventory: { type: 'string' },
    prior: { type: 'string' },
    overrides: { type: 'string' },
    contracts: { type: 'string' },
    'reviewed-profiles': { type: 'string' },
    output: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.inventory || !values.prior || !values.output) {
  throw new Error(
    'Usage: build-printed-complete-coverage-plan --inventory <inventory.json> --prior <coverage-plan.json> [--overrides <reviewed-coverage-plan.json>] [--contracts <bundle.json>] [--reviewed-profiles <reviewed-profiles.json>] --output <coverage-plan.json>',
  );
}
const output = resolve(values.output);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
const inventory = PrintedDecisionInventorySchema.parse(
  JSON.parse(readFileSync(resolve(values.inventory), 'utf8')),
);
const contractManifest =
  values.contracts === undefined
    ? undefined
    : z
        .strictObject({
          schemaVersion: z.literal(1),
          kind: z.literal('printed-controller-contract-bundle'),
          contracts: z.array(
            z.strictObject({
              id: z.string().min(1),
              path: z.string().min(1),
              decisionFamilies: z.array(z.string().min(1)).min(1),
            }),
          ),
        })
        .parse(JSON.parse(readFileSync(resolve(values.contracts), 'utf8')));
const contractByFamily =
  contractManifest === undefined
    ? undefined
    : Object.fromEntries(
        contractManifest.contracts.flatMap((contract) =>
          contract.decisionFamilies.map((family) => [family, contract.id]),
        ),
      );
if (
  contractManifest !== undefined &&
  Object.keys(contractByFamily ?? {}).length !==
    contractManifest.contracts.reduce((total, contract) => total + contract.decisionFamilies.length, 0)
) {
  throw new Error('Controller contract decision families must be unique');
}
if (
  inventory.residual.unknownRootSyntax.length > 0 ||
  inventory.residual.unknownDependencySyntax.length > 0 ||
  inventory.residual.missingGeneratedDependencies.length > 0
) {
  throw new Error('Decision inventory has residual syntax or generated dependencies');
}
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8'));
const plan = buildPrintedCompleteCoveragePlan(inventory.scripts, readJson(values.prior), {
  ...(contractByFamily === undefined ? {} : { controllerContracts: contractByFamily }),
  ...(values.overrides === undefined ? {} : { reviewedOverrides: readJson(values.overrides) }),
  ...(values['reviewed-profiles'] === undefined
    ? {}
    : { reviewedProfiles: readJson(values['reviewed-profiles']) }),
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({
    output,
    scripts: plan.scripts.length,
    complete: plan.scripts.filter((script) => script.review === 'complete').length,
    scriptsWithScenarioClaims: plan.scripts.filter((script) =>
      script.obligations.some(
        (obligation) => obligation.proof === 'scenario' && obligation.claims.length > 0,
      ),
    ).length,
  })}\n`,
);
