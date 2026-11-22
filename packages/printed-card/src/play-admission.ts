/** Reviewed compatibility claims, not catalog import success or a runtime capability guess. */
import { z } from 'zod';

const Name = z.string().trim().min(1);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Names = z.array(Name).refine((values) => new Set(values).size === values.length, 'duplicate identity');
export const PrintedPlaySubjectSchema = z.strictObject({
  formatId: Name,
  formatSha256: Hash,
  catalogs: z.record(Name, Hash).refine((value) => Object.keys(value).length > 0),
  forgeVersion: Name,
  forgeJarSha256: Hash,
  scriptArchiveSha256: Hash,
  resourcesSha256: Hash,
  bridgeSha256: Hash,
  /** Hash of the TypeScript adapter source bundle, not just the Java companion. */
  adapterSha256: Hash,
  protocolVersion: z.number().int().positive(),
});
export type PrintedPlaySubject = z.infer<typeof PrintedPlaySubjectSchema>;
const ProbeResult = z.strictObject({
  id: Name,
  scope: z.enum(['card', 'match']),
  controller: z.enum(['local', 'engine']),
  cardIds: Names,
  decisionFamilies: Names.min(1),
  status: z.enum(['passed', 'failed', 'not-run']),
  assertions: z.array(Name).min(1),
});
/** Binds checked evidence to a claim; execution still requires a trusted producer. */
export const PrintedPlayProbeReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-play-probe-receipt'),
  subject: PrintedPlaySubjectSchema,
  result: ProbeResult,
});
const Probe = ProbeResult.extend({
  evidence: z
    .strictObject({
      kind: z.enum(['play-probe', 'script-qualification']).optional(),
      path: Name,
      sha256: Hash,
    })
    .nullable(),
}).refine((probe) => probe.status !== 'passed' || probe.evidence !== null, 'passed probe needs evidence');
const CardReview = z.strictObject({
  id: Name,
  review: z.enum(['pending', 'reviewed', 'excluded']),
  decisionFamilies: Names.min(1),
  probeIds: Names,
  note: Name,
});

export const PrintedPlayAdmissionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-play-admission'),
    subject: PrintedPlaySubjectSchema,
    generatedObjectPolicy: z.literal('forge-momir-global-creatures').optional(),
    cards: z.array(CardReview).min(1),
    matchProbeIds: Names,
    probes: z.array(Probe),
  })
  .superRefine((value, context) => {
    const issue = (message: string): void => context.addIssue({ code: 'custom', message });
    const cards = new Set(value.cards.map((card) => card.id));
    const probes = new Set(value.probes.map((probe) => probe.id));
    if (cards.size !== value.cards.length) issue('duplicate card review');
    if (probes.size !== value.probes.length) issue('duplicate probe');
    for (const id of [...value.matchProbeIds, ...value.cards.flatMap((card) => card.probeIds)]) {
      if (!probes.has(id)) issue(`unknown probe ${id}`);
    }
    for (const probe of value.probes) {
      for (const id of probe.cardIds) if (!cards.has(id)) issue(`probe names unknown card ${id}`);
    }
  });
export type PrintedPlayAdmission = z.infer<typeof PrintedPlayAdmissionSchema>;
export interface PrintedAdmissionReason {
  readonly code:
    | 'subject-mismatch'
    | 'missing-card'
    | 'foreign-card'
    | 'unreviewed-card'
    | 'unproven-family'
    | 'unproven-match';
  readonly subjectField?: keyof PrintedPlaySubject;
  readonly cardId?: string;
  readonly controller?: 'local' | 'engine';
  readonly family?: string;
}

const CONTROLLERS = ['local', 'engine'] as const;
const MATCH_FAMILIES = ['starting-player', 'mulligan', 'priority'] as const;
function sameCatalogs(left: Record<string, string>, right: Record<string, string>): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([code, hash]) => right[code] === hash)
  );
}

/** Pure structural gate. The Node loader must verify evidence bytes before trusting this result. */
export function evaluatePrintedPlayAdmission(
  input: unknown,
  expectedSubject: unknown,
  requiredCardIds: readonly string[],
): { readonly admitted: boolean; readonly reasons: readonly PrintedAdmissionReason[] } {
  const evidence = PrintedPlayAdmissionSchema.parse(input);
  const expected = PrintedPlaySubjectSchema.parse(expectedSubject);
  const required = new Set(Names.min(1).parse(requiredCardIds));
  const reasons: PrintedAdmissionReason[] = [];
  for (const key of Object.keys(expected) as (keyof PrintedPlaySubject)[]) {
    const matches =
      key === 'catalogs'
        ? sameCatalogs(evidence.subject.catalogs, expected.catalogs)
        : evidence.subject[key] === expected[key];
    if (!matches) reasons.push({ code: 'subject-mismatch', subjectField: key });
  }
  const reviewed = new Set(evidence.cards.map((card) => card.id));
  for (const id of required) if (!reviewed.has(id)) reasons.push({ code: 'missing-card', cardId: id });
  for (const card of evidence.cards) {
    if (!required.has(card.id)) reasons.push({ code: 'foreign-card', cardId: card.id });
    if (card.review !== 'reviewed') reasons.push({ code: 'unreviewed-card', cardId: card.id });
    for (const controller of CONTROLLERS) {
      for (const family of card.decisionFamilies) {
        const proved = evidence.probes.some(
          (probe) =>
            card.probeIds.includes(probe.id) &&
            probe.scope === 'card' &&
            probe.status === 'passed' &&
            probe.controller === controller &&
            probe.cardIds.includes(card.id) &&
            probe.decisionFamilies.includes(family),
        );
        if (!proved) reasons.push({ code: 'unproven-family', cardId: card.id, controller, family });
      }
    }
  }
  for (const controller of CONTROLLERS) {
    for (const family of MATCH_FAMILIES) {
      const proved = evidence.probes.some(
        (probe) =>
          evidence.matchProbeIds.includes(probe.id) &&
          probe.scope === 'match' &&
          probe.status === 'passed' &&
          probe.controller === controller &&
          probe.decisionFamilies.includes(family),
      );
      if (!proved) reasons.push({ code: 'unproven-match', controller, family });
    }
  }
  return { admitted: reasons.length === 0, reasons };
}
