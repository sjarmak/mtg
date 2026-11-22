import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  PrintedControllerContractReceiptSchema,
  PrintedPlayAdmissionSchema,
  PrintedPlaySubjectSchema,
  PrintedScenarioProbeReceiptSchema,
  PrintedScriptCoveragePlanSchema,
  PrintedScriptQualificationReceiptSchema,
  parsePrintedCardCatalog,
  serializedPrintedCardCatalogContent,
  type PrintedScriptQualificationReceipt,
} from '../index';
import { verifyPrintedControllerContractReceipt } from './controller-contract';

const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (bytes: string | Uint8Array): unknown =>
  JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const runtimeSubject = PrintedPlaySubjectSchema.omit({
  formatId: true,
  formatSha256: true,
  catalogs: true,
});
const runtimeOf = (subject: z.infer<typeof PrintedPlaySubjectSchema>) =>
  runtimeSubject.parse({
    forgeVersion: subject.forgeVersion,
    forgeJarSha256: subject.forgeJarSha256,
    scriptArchiveSha256: subject.scriptArchiveSha256,
    resourcesSha256: subject.resourcesSha256,
    bridgeSha256: subject.bridgeSha256,
    adapterSha256: subject.adapterSha256,
    protocolVersion: subject.protocolVersion,
  });
const CoverageReport = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-script-coverage-report'),
  evidenceVerification: z.enum(['scenario-receipts-verified', 'controller-evidence-verified']),
  runtime: runtimeSubject,
  plan: z.strictObject({ path: z.string(), sha256: z.string() }),
  scripts: z.array(
    z.object({
      sourceScript: z.strictObject({ path: z.string(), sha256: z.string() }),
      status: z.enum(['requirements-covered', 'partial', 'missing-review']),
      obligations: z.array(
        z.object({
          id: z.string(),
          covered: z.strictObject({ local: z.boolean(), engine: z.boolean() }),
        }),
      ),
      dependencies: z.array(
        z.strictObject({
          resource: z.strictObject({ path: z.string(), sha256: z.string() }),
          obligations: z.array(z.string()),
        }),
      ),
    }),
  ),
});
type EvidenceFile = { readonly path: string; readonly bytes: string | Uint8Array };
type QualificationFile = EvidenceFile & {
  readonly readEvidence: (path: string) => string | Uint8Array;
};

export function scriptQualificationProbeResult(
  receipt: PrintedScriptQualificationReceipt,
  controller: 'local' | 'engine',
  cardIds: readonly string[],
) {
  const claim = receipt.controllerClaims.find((entry) => entry.controller === controller);
  if (claim === undefined) throw new Error(`Script qualification lacks ${controller} controller claim`);
  const assertions = [...claim.scenarioReceiptIds, ...(claim.controllerContractIds ?? [])].sort();
  return {
    id: `script-${receipt.sourceScript.sha256.slice(0, 16)}-${controller}`,
    scope: 'card' as const,
    controller,
    cardIds: [...cardIds].sort(),
    decisionFamilies: receipt.decisionFamilies,
    status: 'passed' as const,
    assertions,
  };
}

/**
 * Converts independently verified scenario and atomic controller-contract
 * coverage into an immutable, format-neutral qualification for one exact
 * script. The caller must verify the retained evidence before marking the
 * coverage report verified.
 */
export function buildPrintedScriptQualificationReceipt(input: {
  readonly coverageReport: EvidenceFile;
  readonly coveragePlan: EvidenceFile;
  readonly scenarioReceipts: readonly EvidenceFile[];
  readonly controllerContracts?: readonly EvidenceFile[];
  readonly sourceScript: { readonly path: string; readonly sha256: string };
  readonly decisionFamilies: readonly string[];
}): PrintedScriptQualificationReceipt {
  const report = CoverageReport.parse(json(input.coverageReport.bytes));
  const plan = PrintedScriptCoveragePlanSchema.parse(json(input.coveragePlan.bytes));
  if (
    report.plan.path !== input.coveragePlan.path ||
    report.plan.sha256 !== digest(input.coveragePlan.bytes)
  ) {
    throw new Error('Coverage plan evidence mismatch');
  }
  const review = plan.scripts.find((entry) => isDeepStrictEqual(entry.sourceScript, input.sourceScript));
  if (review === undefined || review.review !== 'complete')
    throw new Error(`Missing complete script review: ${input.sourceScript.path}`);
  const covered = report.scripts.find((entry) => isDeepStrictEqual(entry.sourceScript, input.sourceScript));
  if (covered?.status !== 'requirements-covered')
    throw new Error(`Script requirements are not covered: ${input.sourceScript.path}`);
  if (!isDeepStrictEqual(covered.dependencies, review.dependencies))
    throw new Error(`Script dependency account mismatch: ${input.sourceScript.path}`);
  const coveredById = new Map(covered.obligations.map((entry) => [entry.id, entry]));
  const profileOf = (
    candidateReview: (typeof plan.scripts)[number],
    obligation: (typeof plan.scripts)[number]['obligations'][number],
  ) =>
    obligation.proof === 'scenario'
      ? (obligation.capabilityProfile ?? candidateReview.capabilityProfile)
      : undefined;
  for (const obligation of review.obligations) {
    const result = coveredById.get(obligation.id);
    if (result === undefined) throw new Error(`Missing covered obligation: ${obligation.id}`);
    if (
      obligation.proof === 'scenario' &&
      obligation.requiredControllers.some((controller) => !result.covered[controller])
    ) {
      throw new Error(`Uncovered controller for obligation: ${obligation.id}`);
    }
  }
  const receipts = input.scenarioReceipts.map((file) => ({
    file,
    receipt: PrintedScenarioProbeReceiptSchema.parse(json(file.bytes)),
  }));
  if (new Set(receipts.map(({ receipt }) => receipt.result.id)).size !== receipts.length)
    throw new Error('Duplicate scenario receipt');
  if (receipts.some(({ receipt }) => !isDeepStrictEqual(receipt.runtime, report.runtime)))
    throw new Error('Scenario receipt runtime mismatch');
  const contractRuntime = {
    forgeVersion: report.runtime.forgeVersion,
    forgeJarSha256: report.runtime.forgeJarSha256,
    scriptArchiveSha256: report.runtime.scriptArchiveSha256,
    resourcesSha256: report.runtime.resourcesSha256,
    protocolVersion: report.runtime.protocolVersion,
  };
  const contracts = (input.controllerContracts ?? []).map((file) => ({
    file,
    receipt: PrintedControllerContractReceiptSchema.parse(json(file.bytes)),
  }));
  if (new Set(contracts.map(({ receipt }) => receipt.id)).size !== contracts.length)
    throw new Error('Duplicate controller contract');
  if (contracts.some(({ receipt }) => !isDeepStrictEqual(receipt.engineRuntime, contractRuntime)))
    throw new Error('Controller contract runtime mismatch');
  const decisionFamilies = [...new Set(input.decisionFamilies)].sort();
  if (decisionFamilies.length === 0) throw new Error('Script qualification requires decision families');
  const controllerClaims = (['local', 'engine'] as const).map((controller) => {
    const ids = new Set<string>();
    const families = new Set<string>();
    const capabilityProfiles = new Set<string>();
    const controllerContractIds = new Set<string>();
    for (const obligation of review.obligations) {
      if (obligation.proof !== 'scenario') continue;
      if (obligation.controllerContractId !== undefined) {
        const contract = contracts.find(
          ({ receipt }) => receipt.id === obligation.controllerContractId,
        )?.receipt;
        if (
          contract === undefined ||
          !contract.controllerClaims.some((claim) => claim.controller === controller) ||
          obligation.decisionFamilies === undefined ||
          obligation.decisionFamilies.some((family) => !contract.decisionFamilies.includes(family))
        ) {
          throw new Error(`Controller contract evidence mismatch: ${obligation.controllerContractId}`);
        }
        controllerContractIds.add(contract.id);
        for (const family of obligation.decisionFamilies ?? []) families.add(family);
        continue;
      }
      for (const claim of obligation.claims.filter((entry) => entry.controller === controller)) {
        const found = receipts.find(({ receipt }) => receipt.result.id === claim.receiptId)?.receipt;
        if (
          found === undefined ||
          claim.assertions.some((assertion) => !found.result.assertions.includes(assertion)) ||
          claim.decisionFamilies.some((family) => !found.result.decisionFamilies.includes(family))
        ) {
          throw new Error(`Scenario claim evidence mismatch: ${claim.receiptId}`);
        }
        if (
          !isDeepStrictEqual(found.sourceScript, input.sourceScript) &&
          claim.capabilityProfile === undefined
        ) {
          throw new Error(`Cross-script scenario claim lacks capability profile: ${claim.receiptId}`);
        }
        if (claim.capabilityProfile !== undefined) {
          const representative = plan.scripts.find((entry) =>
            isDeepStrictEqual(entry.sourceScript, found.sourceScript),
          );
          const representativeObligation = representative?.obligations.find(
            (entry) => profileOf(representative, entry) === claim.capabilityProfile,
          );
          const representativeCoverage = report.scripts
            .find((entry) => isDeepStrictEqual(entry.sourceScript, found.sourceScript))
            ?.obligations.find((entry) => entry.id === representativeObligation?.id);
          if (
            profileOf(review, obligation) !== claim.capabilityProfile ||
            representative?.review !== 'complete' ||
            representativeObligation?.proof !== 'scenario' ||
            representativeCoverage?.covered[controller] !== true
          ) {
            throw new Error(`Unbound capability profile: ${claim.capabilityProfile}`);
          }
        }
        ids.add(claim.receiptId);
        for (const family of claim.decisionFamilies) families.add(family);
        if (claim.capabilityProfile !== undefined) capabilityProfiles.add(claim.capabilityProfile);
      }
    }
    for (const family of decisionFamilies)
      if (!families.has(family))
        throw new Error(`${controller} controller evidence does not cover ${family}`);
    return {
      controller,
      decisionFamilies: [...families].sort(),
      scenarioReceiptIds: [...ids].sort(),
      capabilityProfiles: [...capabilityProfiles].sort(),
      ...(controllerContractIds.size === 0
        ? {}
        : { controllerContractIds: [...controllerContractIds].sort() }),
    };
  });
  const [localClaim, engineClaim] = controllerClaims;
  if (
    localClaim === undefined ||
    engineClaim === undefined ||
    !isDeepStrictEqual(localClaim.capabilityProfiles, engineClaim.capabilityProfiles)
  ) {
    throw new Error('Reusable capability profiles require both local and engine evidence');
  }
  const usedReceiptIds = new Set(controllerClaims.flatMap((claim) => claim.scenarioReceiptIds));
  const usedContractIds = new Set(controllerClaims.flatMap((claim) => claim.controllerContractIds ?? []));
  return PrintedScriptQualificationReceiptSchema.parse({
    schemaVersion: 1,
    kind: 'printed-script-qualification-receipt',
    runtime: report.runtime,
    sourceScript: input.sourceScript,
    decisionFamilies,
    obligations: review.obligations.map((entry) => entry.id).sort(),
    residualObligations: [],
    controllerClaims,
    dependencies: review.dependencies
      .map((entry) => entry.resource)
      .sort((a, b) => a.path.localeCompare(b.path)),
    evidence: {
      coveragePlan: { path: input.coveragePlan.path, sha256: digest(input.coveragePlan.bytes) },
      coverageReport: {
        path: input.coverageReport.path,
        sha256: digest(input.coverageReport.bytes),
      },
      scenarioReceipts: receipts
        .filter(({ receipt }) => usedReceiptIds.has(receipt.result.id))
        .map(({ file, receipt }) => ({
          receiptId: receipt.result.id,
          file: { path: file.path, sha256: digest(file.bytes) },
        }))
        .sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
      ...(usedContractIds.size === 0
        ? {}
        : {
            controllerContracts: contracts
              .filter(({ receipt }) => usedContractIds.has(receipt.id))
              .map(({ file, receipt }) => ({
                contractId: receipt.id,
                file: { path: file.path, sha256: digest(file.bytes) },
              }))
              .sort((a, b) => a.contractId.localeCompare(b.contractId)),
          }),
    },
  });
}

/** Rebuilds the receipt from its retained evidence and rejects any relabeling. */
export function verifyPrintedScriptQualificationReceipt(
  body: string | Uint8Array,
  readEvidence: (path: string) => string | Uint8Array,
): PrintedScriptQualificationReceipt {
  const expected = PrintedScriptQualificationReceiptSchema.parse(json(body));
  const checked = (file: { readonly path: string; readonly sha256: string }): EvidenceFile => {
    const bytes = readEvidence(file.path);
    if (digest(bytes) !== file.sha256)
      throw new Error(`Script qualification evidence checksum mismatch: ${file.path}`);
    return { path: file.path, bytes };
  };
  let rebuilt: PrintedScriptQualificationReceipt;
  try {
    const contractFiles = (expected.evidence.controllerContracts ?? []).map((entry) => checked(entry.file));
    const expectedEngineRuntime = {
      forgeVersion: expected.runtime.forgeVersion,
      forgeJarSha256: expected.runtime.forgeJarSha256,
      scriptArchiveSha256: expected.runtime.scriptArchiveSha256,
      resourcesSha256: expected.runtime.resourcesSha256,
      protocolVersion: expected.runtime.protocolVersion,
    };
    for (const file of contractFiles)
      verifyPrintedControllerContractReceipt({
        body: file.bytes,
        expectedEngineRuntime,
        readEvidence,
        readSource: readEvidence,
      });
    rebuilt = buildPrintedScriptQualificationReceipt({
      coverageReport: checked(expected.evidence.coverageReport),
      coveragePlan: checked(expected.evidence.coveragePlan),
      scenarioReceipts: expected.evidence.scenarioReceipts.map((entry) => checked(entry.file)),
      controllerContracts: contractFiles,
      sourceScript: expected.sourceScript,
      decisionFamilies: expected.decisionFamilies,
    });
  } catch (cause) {
    throw new Error(
      `Invalid script qualification evidence: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!isDeepStrictEqual(rebuilt, expected))
    throw new Error('Script qualification does not match retained evidence');
  return expected;
}

/** Binds reusable exact-script qualifications to one format's physical IDs. */
export function buildPrintedPlayAdmissionFromScriptQualifications(input: {
  readonly subject: unknown;
  readonly generatedObjectPolicy?: 'forge-momir-global-creatures';
  readonly catalogs: readonly unknown[];
  readonly qualifications: readonly QualificationFile[];
  readonly matchProbes: readonly unknown[];
}) {
  const subject = PrintedPlaySubjectSchema.parse(input.subject);
  const catalogs = input.catalogs.map(parsePrintedCardCatalog);
  if (catalogs.length === 0) throw new Error('Script-qualified admission requires catalogs');
  const actualCatalogHashes = catalogs.map((catalog) => {
    const actual = digest(serializedPrintedCardCatalogContent(catalog));
    if (actual !== catalog.contentSha256) throw new Error(`Catalog checksum mismatch: ${catalog.format}`);
    return actual;
  });
  const subjectCatalogHashes = Object.values(subject.catalogs);
  const sortedActualCatalogHashes = [...actualCatalogHashes].sort();
  const sortedSubjectCatalogHashes = [...subjectCatalogHashes].sort();
  if (
    actualCatalogHashes.length !== subjectCatalogHashes.length ||
    sortedActualCatalogHashes.some((value, index) => value !== sortedSubjectCatalogHashes[index])
  )
    throw new Error('Admission subject catalog mismatch');
  const runtime = runtimeOf(subject);
  const qualifications = input.qualifications.map((file) => ({
    file,
    receipt: verifyPrintedScriptQualificationReceipt(file.bytes, file.readEvidence),
  }));
  if (
    new Set(qualifications.map(({ receipt }) => receipt.sourceScript.path)).size !== qualifications.length
  ) {
    throw new Error('Duplicate script qualification');
  }
  if (qualifications.some(({ receipt }) => !isDeepStrictEqual(receipt.runtime, runtime)))
    throw new Error('Script qualification runtime mismatch');
  const cards = catalogs.flatMap((catalog) => catalog.cards);
  const byScript = new Map(qualifications.map((entry) => [entry.receipt.sourceScript.path, entry]));
  const used = new Set<string>();
  const cardReviews = cards.map((card) => {
    const qualified = byScript.get(card.forgeScript);
    if (qualified === undefined || qualified.receipt.sourceScript.sha256 !== card.forgeScriptSha256) {
      throw new Error(`Missing exact script qualification: ${card.physicalId}`);
    }
    used.add(card.forgeScript);
    const prefix = `script-${card.forgeScriptSha256.slice(0, 16)}`;
    return {
      id: card.physicalId,
      review: 'reviewed' as const,
      decisionFamilies: qualified.receipt.decisionFamilies,
      probeIds: [`${prefix}-local`, `${prefix}-engine`],
      note: `Qualified by exact Forge script ${card.forgeScript}.`,
    };
  });
  if (qualifications.some(({ receipt }) => !used.has(receipt.sourceScript.path)))
    throw new Error('Foreign script qualification');
  const probes = qualifications.flatMap(({ file, receipt }) => {
    const cardIds = cards
      .filter((card) => card.forgeScript === receipt.sourceScript.path)
      .map((card) => card.physicalId)
      .sort();
    return receipt.controllerClaims.map((claim) => ({
      ...scriptQualificationProbeResult(receipt, claim.controller, cardIds),
      evidence: {
        kind: 'script-qualification' as const,
        path: file.path,
        sha256: digest(file.bytes),
      },
    }));
  });
  return PrintedPlayAdmissionSchema.parse({
    schemaVersion: 1,
    kind: 'printed-play-admission',
    subject,
    ...(input.generatedObjectPolicy === undefined
      ? {}
      : { generatedObjectPolicy: input.generatedObjectPolicy }),
    cards: cardReviews,
    matchProbeIds: input.matchProbes.map((probe) => z.object({ id: z.string() }).parse(probe).id),
    probes: [...probes, ...input.matchProbes],
  });
}
