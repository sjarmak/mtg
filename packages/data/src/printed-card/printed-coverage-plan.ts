/** Promotes closed syntax discovery into exhaustive, still-unproved coverage requirements. */
import { z } from 'zod';
import { PrintedScriptCoveragePlanSchema } from '@mtg/printed-card';

interface DecisionInventoryScript {
  readonly sourceScript: { readonly path: string; readonly sha256: string };
  readonly candidateProfile: string;
  readonly families: readonly string[];
  readonly generatedDependencies: readonly {
    readonly name: string;
    readonly sha256: string;
  }[];
}

const PROFILE_OBLIGATION = 'controller-capability-profile';
const ReceiptClaimSchema = z.strictObject({
  receiptId: z.string().min(1),
  assertions: z.array(z.string().min(1)).min(1),
});
/** Hand-reviewed scripts a format vouches for outside the generated prior plan. */
export const PrintedReviewedProfilesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-reviewed-profiles'),
  completeBehaviorReviews: z.array(z.string().min(1)),
  profileRepresentatives: z.record(
    z.string().min(1),
    z.strictObject({ local: ReceiptClaimSchema, engine: ReceiptClaimSchema }),
  ),
});
export type PrintedReviewedProfiles = z.infer<typeof PrintedReviewedProfilesSchema>;
const NO_REVIEWED_PROFILES: PrintedReviewedProfiles = {
  schemaVersion: 1,
  kind: 'printed-reviewed-profiles',
  completeBehaviorReviews: [],
  profileRepresentatives: {},
};

export interface PrintedCompleteCoveragePlanOptions {
  readonly controllerContracts?: Readonly<Record<string, string>>;
  readonly reviewedOverrides?: unknown;
  readonly reviewedProfiles?: unknown;
}

/**
 * Retains hand-reviewed card obligations and adds one closed reusable-profile
 * obligation plus every exact generated resource. Empty claims keep coverage red.
 */
export function buildPrintedCompleteCoveragePlan(
  scripts: readonly DecisionInventoryScript[],
  priorInput: unknown,
  options: PrintedCompleteCoveragePlanOptions = {},
) {
  const { controllerContracts, reviewedOverrides: reviewedOverridesInput } = options;
  const reviewedProfiles =
    options.reviewedProfiles === undefined
      ? NO_REVIEWED_PROFILES
      : PrintedReviewedProfilesSchema.parse(options.reviewedProfiles);
  const completeBehaviorReviews = new Set(reviewedProfiles.completeBehaviorReviews);
  const prior = PrintedScriptCoveragePlanSchema.parse(priorInput);
  const priorByPath = new Map(prior.scripts.map((review) => [review.sourceScript.path, review]));
  if (priorByPath.size !== prior.scripts.length)
    throw new Error('Prior plan contains duplicate source scripts');
  if (reviewedOverridesInput !== undefined) {
    const overrides = PrintedScriptCoveragePlanSchema.parse(reviewedOverridesInput);
    const overridePaths = new Set<string>();
    for (const review of overrides.scripts) {
      if (overridePaths.has(review.sourceScript.path))
        throw new Error(`Reviewed overrides contain duplicate source script: ${review.sourceScript.path}`);
      overridePaths.add(review.sourceScript.path);
      const existing = priorByPath.get(review.sourceScript.path);
      if (existing === undefined || existing.sourceScript.sha256 !== review.sourceScript.sha256)
        throw new Error(`Reviewed override does not match prior source: ${review.sourceScript.path}`);
      priorByPath.set(review.sourceScript.path, review);
    }
  }
  if (controllerContracts !== undefined) {
    const reviews = scripts.map((script) => {
      const existing = priorByPath.get(script.sourceScript.path);
      if (existing === undefined || existing.sourceScript.sha256 !== script.sourceScript.sha256)
        throw new Error(`Missing exact prior source account: ${script.sourceScript.path}`);
      const source = existing.obligations.find((obligation) => obligation.proof === 'source');
      if (source === undefined)
        throw new Error(`Missing source declaration account: ${script.sourceScript.path}`);
      const retained = existing.obligations.filter(
        (obligation) =>
          obligation.id !== PROFILE_OBLIGATION && !obligation.id.startsWith('controller-contract-'),
      );
      const controllerObligations = script.families.map((family) => {
        const contractId = controllerContracts[family];
        const base = {
          id: `controller-contract-${family}`,
          description: `Both controllers must satisfy the reviewed ${family} interaction contract.`,
          lines: source.lines,
          dependsOn: [source.id],
          proof: 'scenario' as const,
          requiredControllers: ['local', 'engine'] as const,
          claims: [],
        };
        return contractId === undefined
          ? base
          : {
              ...base,
              controllerContractId: contractId,
              decisionFamilies: [family],
            };
      });
      return {
        sourceScript: script.sourceScript,
        review: script.families.every((family) => controllerContracts[family] !== undefined)
          ? ('complete' as const)
          : ('partial' as const),
        obligations: [...retained, ...controllerObligations],
        dependencies: script.generatedDependencies.map((dependency) => {
          const path = `tokenscripts/${dependency.name}.txt`;
          const priorDependency = existing.dependencies.find((entry) => entry.resource.path === path);
          const retainedIds = new Set(retained.map((obligation) => obligation.id));
          return {
            resource: { path, sha256: dependency.sha256 },
            obligations: [
              ...(priorDependency?.obligations.filter((id) => retainedIds.has(id)) ?? []),
              ...controllerObligations.map((obligation) => obligation.id),
            ].filter((id, index, values) => values.indexOf(id) === index),
          };
        }),
      };
    });
    if (reviews.length !== prior.scripts.length) throw new Error('Decision inventory and prior plan differ');
    return PrintedScriptCoveragePlanSchema.parse({
      schemaVersion: 1,
      kind: 'printed-script-coverage-plan',
      scripts: reviews,
    });
  }
  const claimsByProfile = new Map<
    string,
    readonly {
      readonly controller: 'local' | 'engine';
      readonly receiptId: string;
      readonly assertions: readonly string[];
      readonly decisionFamilies: readonly string[];
      readonly capabilityProfile: string;
    }[]
  >();
  for (const script of scripts) {
    const existing = priorByPath.get(script.sourceScript.path);
    if (existing === undefined) continue;
    const claims = (['local', 'engine'] as const).flatMap((controller) => {
      const matches = existing.obligations
        .filter((obligation) => obligation.proof === 'scenario')
        .flatMap((obligation) => (obligation.proof === 'scenario' ? obligation.claims : []))
        .filter((claim) => claim.controller === controller);
      const receiptId = matches[0]?.receiptId;
      if (receiptId === undefined) return [];
      return [
        {
          controller,
          receiptId,
          assertions: [
            ...new Set(
              matches.filter((claim) => claim.receiptId === receiptId).flatMap((claim) => claim.assertions),
            ),
          ].sort(),
          decisionFamilies: [...script.families].sort(),
          capabilityProfile: script.candidateProfile,
        },
      ];
    });
    if (claims.length === 2 && !claimsByProfile.has(script.candidateProfile))
      claimsByProfile.set(script.candidateProfile, claims);
  }
  for (const script of scripts) {
    const representative = reviewedProfiles.profileRepresentatives[script.sourceScript.path];
    if (representative === undefined) continue;
    claimsByProfile.set(
      script.candidateProfile,
      (['local', 'engine'] as const).map((controller) => ({
        controller,
        receiptId: representative[controller].receiptId,
        assertions: representative[controller].assertions,
        decisionFamilies: [...script.families].sort(),
        capabilityProfile: script.candidateProfile,
      })),
    );
  }
  const reviews = scripts.map((script) => {
    const existing = priorByPath.get(script.sourceScript.path);
    if (existing === undefined || existing.sourceScript.sha256 !== script.sourceScript.sha256)
      throw new Error(`Missing exact prior source account: ${script.sourceScript.path}`);
    const sourceLines = existing.obligations.find((obligation) => obligation.proof === 'source')?.lines;
    if (sourceLines === undefined)
      throw new Error(`Missing source declaration account: ${script.sourceScript.path}`);
    const retained = existing.obligations.filter((obligation) => obligation.id !== PROFILE_OBLIGATION);
    return {
      sourceScript: script.sourceScript,
      capabilityProfile: script.candidateProfile,
      review: completeBehaviorReviews.has(script.sourceScript.path) ? 'complete' : 'partial',
      obligations: [
        ...retained,
        {
          id: PROFILE_OBLIGATION,
          description: `Both controllers must prove the closed ${script.candidateProfile} decision shape.`,
          lines: sourceLines,
          dependsOn: retained.filter((obligation) => obligation.proof === 'source').map((entry) => entry.id),
          proof: 'scenario',
          requiredControllers: ['local', 'engine'],
          claims: claimsByProfile.get(script.candidateProfile) ?? [],
        },
      ],
      dependencies: script.generatedDependencies.map((dependency) => ({
        resource: { path: `tokenscripts/${dependency.name}.txt`, sha256: dependency.sha256 },
        obligations: [PROFILE_OBLIGATION],
      })),
    };
  });
  if (reviews.length !== prior.scripts.length) throw new Error('Decision inventory and prior plan differ');
  return PrintedScriptCoveragePlanSchema.parse({
    schemaVersion: 1,
    kind: 'printed-script-coverage-plan',
    scripts: reviews,
  });
}
