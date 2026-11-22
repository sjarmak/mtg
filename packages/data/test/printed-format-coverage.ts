import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { buildPrintedScriptCoveragePlan } from '@mtg/printed-card/node';
import { FORGE_TOKEN_SCRIPTS_PATH, readForgeScriptArchive } from '../src/printed-card/forge-install';
import { buildPrintedDecisionInventory } from '../src/printed-card/printed-decision-inventory';
import { buildPrintedCompleteCoveragePlan } from '../src/printed-card/printed-coverage-plan';
import contractTable from '../data/printed-controller-contracts-v1.json';

type ExpectedCoverage = Readonly<{
  physicalCards: number;
  scripts: number;
}>;

export function expectPrintedCoverageClosed(catalogInputs: unknown[], expected?: ExpectedCoverage): void {
  const archive = readForgeScriptArchive();
  const readScript = (path: string) => {
    const bytes = archive.get(path);
    if (bytes === undefined) throw new Error(`Missing Forge script: ${path}`);
    return bytes;
  };
  const inventory = buildPrintedDecisionInventory(catalogInputs, readScript, (name) => {
    try {
      return readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${name}.txt`);
    } catch {
      return undefined;
    }
  });
  expect(inventory.residual).toEqual({
    unknownRootSyntax: [],
    unknownDependencySyntax: [],
    missingGeneratedDependencies: [],
  });
  if (expected !== undefined) {
    expect(inventory.summary).toMatchObject({
      physicalCards: expected.physicalCards,
      rootScripts: expected.scripts,
      qualifiedScripts: 0,
    });
  }

  const contractsByFamily = Object.fromEntries(
    contractTable.contracts.flatMap((contract) =>
      contract.decisionFamilies.map((family) => [family, contract.id] as const),
    ),
  );
  const families = new Set(inventory.scripts.flatMap((script) => script.families));
  expect([...families].filter((family) => contractsByFamily[family] === undefined)).toEqual([]);

  const prior = buildPrintedScriptCoveragePlan(catalogInputs, readScript, []);
  const plan = buildPrintedCompleteCoveragePlan(inventory.scripts, prior, {
    controllerContracts: contractsByFamily,
  });
  if (expected !== undefined) expect(plan.scripts).toHaveLength(expected.scripts);
  expect(plan.scripts.filter((script) => script.review !== 'complete')).toEqual([]);
  expect(plan.scripts.flatMap((script) => script.obligations).some((o) => o.proof === 'scenario')).toBe(true);
}
