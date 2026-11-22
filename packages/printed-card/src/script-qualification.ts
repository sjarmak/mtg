/** Reusable proof that one exact Forge script is covered by reviewed scenarios. */
import { z } from 'zod';
import { PrintedPlaySubjectSchema } from './play-admission';

const Name = z.string().trim().min(1);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = Name.refine(
  (value) =>
    !value.includes('\\') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes(':')),
  'portable relative path required',
);
const File = z.strictObject({ path: Path, sha256: Hash });
const Names = z
  .array(Name)
  .min(1)
  .refine((values) => new Set(values).size === values.length, 'duplicate identity');
const OptionalNames = z
  .array(Name)
  .refine((values) => new Set(values).size === values.length, 'duplicate identity');
const ControllerClaim = z.strictObject({
  controller: z.enum(['local', 'engine']),
  decisionFamilies: Names,
  scenarioReceiptIds: OptionalNames,
  capabilityProfiles: OptionalNames,
  controllerContractIds: OptionalNames.optional(),
});

export const PrintedScriptQualificationReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-script-qualification-receipt'),
    runtime: PrintedPlaySubjectSchema.omit({ formatId: true, formatSha256: true, catalogs: true }),
    sourceScript: File.extend({ path: Path.refine((value) => value.endsWith('.txt')) }),
    decisionFamilies: Names,
    obligations: Names,
    residualObligations: z.array(Name).max(0),
    controllerClaims: z.array(ControllerClaim).length(2),
    dependencies: z.array(File),
    evidence: z.strictObject({
      coveragePlan: File,
      coverageReport: File,
      scenarioReceipts: z.array(z.strictObject({ receiptId: Name, file: File })),
      controllerContracts: z.array(z.strictObject({ contractId: Name, file: File })).optional(),
    }),
  })
  .superRefine((receipt, context) => {
    const issue = (message: string): void => context.addIssue({ code: 'custom', message });
    const controllers = new Set(receipt.controllerClaims.map((claim) => claim.controller));
    if (controllers.size !== 2) issue('qualification requires distinct local and engine claims');
    const evidenceIds = new Set(receipt.evidence.scenarioReceipts.map((entry) => entry.receiptId));
    if (evidenceIds.size !== receipt.evidence.scenarioReceipts.length)
      issue('duplicate scenario receipt evidence');
    for (const claim of receipt.controllerClaims) {
      for (const family of receipt.decisionFamilies)
        if (!claim.decisionFamilies.includes(family))
          issue(`${claim.controller} claim does not cover ${family}`);
      for (const id of claim.scenarioReceiptIds)
        if (!evidenceIds.has(id)) issue(`unknown scenario receipt ${id}`);
      const contractIds = new Set(
        (receipt.evidence.controllerContracts ?? []).map((entry) => entry.contractId),
      );
      for (const id of claim.controllerContractIds ?? [])
        if (!contractIds.has(id)) issue(`unknown controller contract ${id}`);
    }
    if (
      new Set((receipt.evidence.controllerContracts ?? []).map((entry) => entry.contractId)).size !==
      (receipt.evidence.controllerContracts ?? []).length
    )
      issue('duplicate controller contract evidence');
    const profileSets = receipt.controllerClaims.map((claim) => [...claim.capabilityProfiles].sort());
    if (JSON.stringify(profileSets[0]) !== JSON.stringify(profileSets[1]))
      issue('reusable capability profiles require both local and engine evidence');
    if (new Set(receipt.dependencies.map((entry) => entry.path)).size !== receipt.dependencies.length)
      issue('duplicate dependency');
  });

export type PrintedScriptQualificationReceipt = z.infer<typeof PrintedScriptQualificationReceiptSchema>;
