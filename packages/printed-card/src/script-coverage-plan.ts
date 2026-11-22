/** Reviewed behavior mappings, never semantic classifications inferred from mechanic names. */
import { z } from 'zod';

const Name = z.string().trim().min(1);
const Names = z.array(Name).refine((values) => new Set(values).size === values.length, 'duplicate identity');
const File = z.strictObject({
  path: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*\.txt$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const ObligationBase = z.strictObject({
  id: Name,
  description: Name,
  lines: z
    .array(z.number().int().positive())
    .min(1)
    .refine((lines) => new Set(lines).size === lines.length),
  dependsOn: Names,
});
const Controller = z.enum(['local', 'engine']);
const ScenarioClaim = z.strictObject({
  controller: Controller,
  receiptId: Name,
  assertions: Names.min(1),
  decisionFamilies: Names.min(1),
  /** Required when the scenario proves a reusable controller profile on another exact script. */
  capabilityProfile: Name.optional(),
});
const Obligation = z
  .discriminatedUnion('proof', [
    ObligationBase.extend({ proof: z.literal('source') }),
    ObligationBase.extend({
      proof: z.literal('scenario'),
      /** Reviewed callback-contract identity. Prefer this atomic binding over a whole-script profile. */
      capabilityProfile: Name.optional(),
      /** Source-bound bilateral proof for one atomic controller interaction. */
      controllerContractId: Name.optional(),
      /** Exact inventory families discharged by the atomic contract. */
      decisionFamilies: Names.min(1).optional(),
      requiredControllers: z
        .array(Controller)
        .min(1)
        .refine((values) => new Set(values).size === values.length, 'duplicate controller'),
      claims: z.array(ScenarioClaim),
    }),
  ])
  .superRefine((obligation, context) => {
    if (obligation.proof !== 'scenario') return;
    if (obligation.controllerContractId !== undefined) {
      if (obligation.capabilityProfile !== undefined)
        context.addIssue({ code: 'custom', message: 'controller contract cannot use a capability profile' });
      if (obligation.decisionFamilies === undefined)
        context.addIssue({ code: 'custom', message: 'controller contract requires decision families' });
      if (obligation.claims.length !== 0)
        context.addIssue({ code: 'custom', message: 'controller contract cannot also use scenario claims' });
    } else if (obligation.decisionFamilies !== undefined) {
      context.addIssue({ code: 'custom', message: 'decision families require a controller contract' });
    }
    const claimed = new Set(obligation.claims.map((claim) => claim.controller));
    for (const controller of claimed) {
      if (!obligation.requiredControllers.includes(controller))
        context.addIssue({ code: 'custom', message: `unexpected ${controller} scenario claim` });
    }
  });
const Review = z
  .strictObject({
    sourceScript: File,
    /** Reviewed callback-contract equivalence; never inferred from a mechanic label. */
    capabilityProfile: Name.optional(),
    /** Complete means the reviewed requirement list is exhaustive, not that its tests passed. */
    review: z.enum(['partial', 'complete']),
    obligations: z.array(Obligation).min(1),
    dependencies: z.array(z.strictObject({ resource: File, obligations: Names.min(1) })),
  })
  .superRefine((review, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    const ids = review.obligations.map((obligation) => obligation.id);
    if (new Set(ids).size !== ids.length) issue('duplicate obligation');
    if (
      new Set(review.dependencies.map((dependency) => dependency.resource.path)).size !==
      review.dependencies.length
    )
      issue('duplicate resource dependency');
    const referenced = [
      ...review.obligations.flatMap((obligation) => obligation.dependsOn),
      ...review.dependencies.flatMap((dependency) => dependency.obligations),
    ];
    for (const obligation of review.obligations) {
      if (obligation.proof !== 'scenario') continue;
      const profile = obligation.capabilityProfile ?? review.capabilityProfile;
      for (const claim of obligation.claims) {
        if (claim.capabilityProfile !== undefined && claim.capabilityProfile !== profile)
          issue(`scenario claim profile does not match obligation ${obligation.id}`);
      }
    }
    if (referenced.some((id) => !ids.includes(id))) issue('unknown obligation dependency');
    let resolved: string[] = [];
    while (resolved.length < ids.length) {
      const next = review.obligations.filter(
        (obligation) =>
          !resolved.includes(obligation.id) && obligation.dependsOn.every((id) => resolved.includes(id)),
      );
      if (next.length === 0) {
        issue('cyclic or unresolved obligation dependency');
        break;
      }
      resolved = [...resolved, ...next.map((obligation) => obligation.id)];
    }
  });

export const PrintedScriptCoveragePlanSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-script-coverage-plan'),
    scripts: z.array(Review),
  })
  .superRefine((plan, context) => {
    if (new Set(plan.scripts.map((review) => review.sourceScript.path)).size !== plan.scripts.length)
      context.addIssue({ code: 'custom', message: 'duplicate script review' });
  });
export type PrintedScriptReview = z.infer<typeof Review>;
