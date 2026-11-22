/** Reusable execution evidence, deliberately incompatible with whole-card admission receipts. */
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
  .refine((values) => new Set(values).size === values.length);
export const PrintedScenarioProbeResultSchema = z.strictObject({
  id: Name,
  scope: z.literal('scenario'),
  controller: z.enum(['local', 'engine']),
  sourceName: Name,
  sourceSeat: z.union([z.literal(0), z.literal(1)]),
  /** Seat whose callback path the scenario proves; defaults to the source seat in legacy receipts. */
  decisionSeat: z.union([z.literal(0), z.literal(1)]).optional(),
  decisionFamilies: Names,
  assertions: Names,
  status: z.literal('passed'),
});
export const PrintedScenarioProbeReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-scenario-probe-receipt'),
    runtime: PrintedPlaySubjectSchema.omit({ formatId: true, formatSha256: true, catalogs: true }),
    result: PrintedScenarioProbeResultSchema,
    sourceScript: File.extend({ path: Path.refine((value) => value.endsWith('.txt')) }),
    sources: z.array(File).min(1),
    cases: z
      .array(
        z.strictObject({
          testFile: Path,
          testIdentity: z.strictObject({ id: Name, ancestorTitles: z.array(Name), title: Name }),
          formatId: Name,
          stateSha256: Hash,
          seed: Name,
          maximumTurns: z.number().int().positive(),
        }),
      )
      .min(1),
    evidence: z.strictObject({ report: File, usage: File }),
  })
  .superRefine((receipt, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    const sources = new Set(receipt.sources.map((file) => file.path));
    if (sources.size !== receipt.sources.length) issue('duplicate source path');
    const cases = receipt.cases.map((entry) =>
      [...entry.testIdentity.ancestorTitles, entry.testIdentity.title].join(' '),
    );
    if (
      new Set(cases).size !== cases.length ||
      cases.length !== receipt.result.assertions.length ||
      !cases.every((name) => receipt.result.assertions.includes(name))
    )
      issue('case assertion population mismatch');
    if (receipt.cases.some((entry) => !sources.has(entry.testFile))) issue('case test source is not bound');
  });
export type PrintedScenarioProbeReceipt = z.infer<typeof PrintedScenarioProbeReceiptSchema>;
