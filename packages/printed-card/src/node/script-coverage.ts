/** Full-population requirement accounting; scenario claims never become play admission here. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  PrintedScriptCoveragePlanSchema,
  PrintedControllerContractReceiptSchema,
  PrintedScenarioProbeReceiptSchema,
  PrintedPlaySubjectSchema,
  type PrintedScriptReview,
  type PrintedScenarioProbeReceipt,
  type PrintedControllerContractReceipt,
} from '../index';
import { buildPrintedScriptInventory } from './script-inventory';

type Script = ReturnType<typeof buildPrintedScriptInventory>['scripts'][number];
type Controller = 'local' | 'engine';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const byId = <T extends { id: string }>(values: readonly T[]) =>
  [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function obligationCoverage(
  review: PrintedScriptReview,
  reviews: readonly PrintedScriptReview[],
  receipts: readonly PrintedScenarioProbeReceipt[],
  contracts: readonly PrintedControllerContractReceipt[],
) {
  const profileOf = (
    candidateReview: PrintedScriptReview,
    obligation: PrintedScriptReview['obligations'][number],
  ) =>
    obligation.proof === 'scenario'
      ? (obligation.capabilityProfile ?? candidateReview.capabilityProfile)
      : undefined;
  const representativeCoversProfile = (
    sourceScript: PrintedScenarioProbeReceipt['sourceScript'],
    profile: string,
    controller: Controller,
  ): boolean => {
    const representative = reviews.find(
      (candidate) =>
        candidate.review === 'complete' && isDeepStrictEqual(candidate.sourceScript, sourceScript),
    );
    if (representative === undefined) return false;
    const matchedLocally = (candidateId: string): boolean => {
      const candidateObligation = representative.obligations.find((entry) => entry.id === candidateId)!;
      if (candidateObligation.proof === 'source') return true;
      if (!candidateObligation.requiredControllers.includes(controller)) return false;
      return candidateObligation.claims.some(
        (candidateClaim) =>
          candidateClaim.controller === controller &&
          receipts.some(
            (candidateReceipt) =>
              candidateReceipt.result.id === candidateClaim.receiptId &&
              candidateReceipt.result.controller === controller &&
              isDeepStrictEqual(candidateReceipt.sourceScript, representative.sourceScript) &&
              candidateClaim.assertions.every((assertion) =>
                candidateReceipt.result.assertions.includes(assertion),
              ) &&
              candidateClaim.decisionFamilies.every((family) =>
                candidateReceipt.result.decisionFamilies.includes(family),
              ),
          ),
      );
    };
    const coveredLocally = (candidateId: string): boolean => {
      const candidateObligation = representative.obligations.find((entry) => entry.id === candidateId)!;
      return (
        matchedLocally(candidateId) &&
        candidateObligation.dependsOn.every((dependency) => coveredLocally(dependency))
      );
    };
    return representative.obligations.some(
      (candidateObligation) =>
        profileOf(representative, candidateObligation) === profile && coveredLocally(candidateObligation.id),
    );
  };
  const matched = (id: string, controller: Controller): boolean => {
    const obligation = review.obligations.find((entry) => entry.id === id)!;
    if (obligation.proof === 'source') return true;
    if (!obligation.requiredControllers.includes(controller)) return false;
    if (obligation.controllerContractId !== undefined) {
      const contract = contracts.find((entry) => entry.id === obligation.controllerContractId);
      return (
        contract !== undefined &&
        obligation.decisionFamilies?.every((family) => contract.decisionFamilies.includes(family)) === true &&
        contract.controllerClaims.some((claim) => claim.controller === controller)
      );
    }
    return obligation.claims.some(
      (claim) =>
        claim.controller === controller &&
        receipts.some(
          (receipt) =>
            receipt.result.id === claim.receiptId &&
            receipt.result.controller === controller &&
            (isDeepStrictEqual(receipt.sourceScript, review.sourceScript) ||
              (claim.capabilityProfile !== undefined &&
                claim.capabilityProfile === profileOf(review, obligation) &&
                representativeCoversProfile(receipt.sourceScript, claim.capabilityProfile, controller))) &&
            claim.assertions.every((assertion) => receipt.result.assertions.includes(assertion)) &&
            claim.decisionFamilies.every((family) => receipt.result.decisionFamilies.includes(family)),
        ),
    );
  };
  // The plan schema rejects cycles and unknown references before this traversal.
  const covered = (id: string, controller: Controller): boolean =>
    matched(id, controller) &&
    review.obligations
      .find((entry) => entry.id === id)!
      .dependsOn.every((dependency) => covered(dependency, controller));
  return byId(review.obligations).map((obligation) => ({
    ...obligation,
    covered: { local: covered(obligation.id, 'local'), engine: covered(obligation.id, 'engine') },
    missingDependencies: {
      local: obligation.dependsOn.filter((id) => !covered(id, 'local')).sort(),
      engine: obligation.dependsOn.filter((id) => !covered(id, 'engine')).sort(),
    },
  }));
}

function obligationIsCovered(obligation: ReturnType<typeof obligationCoverage>[number]): boolean {
  if (obligation.proof === 'source') return true;
  return obligation.requiredControllers.every((controller) => obligation.covered[controller]);
}

function scriptCoverage(
  script: Script,
  review: PrintedScriptReview | undefined,
  reviews: readonly PrintedScriptReview[],
  receipts: readonly PrintedScenarioProbeReceipt[],
  contracts: readonly PrintedControllerContractReceipt[],
  readResource: (path: string) => string | Uint8Array,
) {
  if (review && script.sha256 !== review.sourceScript.sha256)
    throw new Error(`Stale script review: ${script.path}`);
  const lines = new Set(script.lines.map((line) => line.number));
  const mapped = review?.obligations.flatMap((obligation) => obligation.lines) ?? [];
  if (mapped.some((line) => !lines.has(line))) throw new Error(`Unknown script line: ${script.path}`);
  for (const dependency of review?.dependencies ?? [])
    if (digest(readResource(dependency.resource.path)) !== dependency.resource.sha256)
      throw new Error(`Dependency resource checksum mismatch: ${dependency.resource.path}`);
  const obligations = review ? obligationCoverage(review, reviews, receipts, contracts) : [];
  const unmappedLines = [...lines].filter((line) => !mapped.includes(line));
  const status = !review
    ? ('missing-review' as const)
    : review.review === 'complete' && unmappedLines.length === 0 && obligations.every(obligationIsCovered)
      ? ('requirements-covered' as const)
      : ('partial' as const);
  return {
    sourceScript: { path: script.path, sha256: script.sha256 },
    status,
    review: review?.review ?? ('missing' as const),
    lines: script.lines,
    unmappedLines,
    obligations,
    dependencies: review?.dependencies ?? [],
  };
}

/**
 * Catalog/script bytes are checked here. Receipt execution evidence is NOT:
 * callers must use the retained scenario verifier before promoting that field.
 * A reviewed list is a trusted semantic input; line accounting catches omitted
 * declarations, not omitted meanings within a single declaration.
 */
export function buildPrintedScriptCoverageReport(input: {
  readonly catalogs: readonly unknown[];
  readonly plan: unknown;
  readonly receipts: readonly unknown[];
  /** Receipts must already have passed verifyPrintedControllerContractReceipt. */
  readonly verifiedControllerContracts?: readonly unknown[];
  readonly measuredRuntime: unknown;
  readonly readScript: (path: string) => string | Uint8Array;
  readonly readResource: (path: string) => string | Uint8Array;
}) {
  const plan = PrintedScriptCoveragePlanSchema.parse(input.plan);
  const runtime = PrintedPlaySubjectSchema.omit({ formatId: true, formatSha256: true, catalogs: true }).parse(
    input.measuredRuntime,
  );
  const receipts = z.array(PrintedScenarioProbeReceiptSchema).parse(input.receipts);
  const contracts = z
    .array(PrintedControllerContractReceiptSchema)
    .parse(input.verifiedControllerContracts ?? []);
  if (new Set(receipts.map((receipt) => receipt.result.id)).size !== receipts.length)
    throw new Error('Duplicate scenario receipt');
  if (receipts.some((receipt) => !isDeepStrictEqual(receipt.runtime, runtime)))
    throw new Error('Scenario runtime mismatch');
  if (new Set(contracts.map((contract) => contract.id)).size !== contracts.length)
    throw new Error('Duplicate controller contract');
  const engineRuntime = {
    forgeVersion: runtime.forgeVersion,
    forgeJarSha256: runtime.forgeJarSha256,
    scriptArchiveSha256: runtime.scriptArchiveSha256,
    resourcesSha256: runtime.resourcesSha256,
    protocolVersion: runtime.protocolVersion,
  };
  if (contracts.some((contract) => !isDeepStrictEqual(contract.engineRuntime, engineRuntime)))
    throw new Error('Controller contract runtime mismatch');
  const inventory = buildPrintedScriptInventory(input.catalogs, input.readScript);
  const scripts = inventory.scripts.map((script) =>
    scriptCoverage(
      script,
      plan.scripts.find((review) => review.sourceScript.path === script.path),
      plan.scripts,
      receipts,
      contracts,
      input.readResource,
    ),
  );
  const states = new Map(scripts.map((script) => [script.sourceScript.path, script.status]));
  return {
    schemaVersion: 1 as const,
    kind: 'printed-script-coverage-report' as const,
    admitted: false as const,
    evidenceVerification: 'not-performed' as const,
    runtime,
    catalogs: inventory.catalogs,
    cards: inventory.cards.map((card) => ({ ...card, status: states.get(card.forgeScript)! })),
    scripts,
    unusedReviews: plan.scripts
      .filter((review) => !states.has(review.sourceScript.path))
      .map((review) => review.sourceScript.path)
      .sort(),
    summary: {
      printings: inventory.cards.length,
      scripts: scripts.length,
      requirementsCovered: scripts.filter((script) => script.status === 'requirements-covered').length,
      partial: scripts.filter((script) => script.status === 'partial').length,
      missingReview: scripts.filter((script) => script.status === 'missing-review').length,
    },
  };
}
