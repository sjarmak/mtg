/** Format-neutral proof for one atomic controller interaction contract. */
import { z } from 'zod';

const Name = z.string().trim().min(1);
const Marker = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'source marker required');
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = Name.refine(
  (value) =>
    !value.includes('\\') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes(':')),
  'portable relative path required',
);
const Names = z
  .array(Name)
  .min(1)
  .refine((values) => new Set(values).size === values.length, 'duplicate identity');
const File = z.strictObject({ path: Path, sha256: Hash });

export const PrintedControllerContractEngineRuntimeSchema = z.strictObject({
  forgeVersion: Name,
  forgeJarSha256: Hash,
  scriptArchiveSha256: Hash,
  resourcesSha256: Hash,
  protocolVersion: z.number().int().positive(),
});

export const PrintedControllerContractReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-controller-contract-receipt'),
    id: Name,
    engineRuntime: PrintedControllerContractEngineRuntimeSchema,
    decisionFamilies: Names,
    sourceRegions: z
      .array(
        z.strictObject({
          path: Path,
          beginMarker: Marker,
          endMarker: Marker,
          sha256: Hash,
        }),
      )
      .min(1),
    controllerClaims: z
      .array(
        z.strictObject({
          controller: z.enum(['local', 'engine']),
          scenarioReceiptIds: Names,
        }),
      )
      .length(2),
    evidence: z.strictObject({
      scenarioReceipts: z
        .array(
          z.strictObject({
            receiptId: Name,
            file: File,
          }),
        )
        .min(2),
    }),
  })
  .superRefine((receipt, context) => {
    const issue = (message: string): void => context.addIssue({ code: 'custom', message });
    if (new Set(receipt.controllerClaims.map((claim) => claim.controller)).size !== 2)
      issue('controller contract requires distinct local and engine claims');
    const regionIds = receipt.sourceRegions.map(
      (region) => `${region.path}\0${region.beginMarker}\0${region.endMarker}`,
    );
    if (new Set(regionIds).size !== regionIds.length) issue('duplicate controller contract source region');
    const evidenceIds = receipt.evidence.scenarioReceipts.map((entry) => entry.receiptId);
    if (new Set(evidenceIds).size !== evidenceIds.length)
      issue('duplicate controller contract scenario receipt');
    for (const claim of receipt.controllerClaims) {
      for (const id of claim.scenarioReceiptIds)
        if (!evidenceIds.includes(id)) issue(`unknown controller contract scenario receipt ${id}`);
    }
  });

export type PrintedControllerContractEngineRuntime = z.infer<
  typeof PrintedControllerContractEngineRuntimeSchema
>;
export type PrintedControllerContractReceipt = z.infer<typeof PrintedControllerContractReceiptSchema>;
