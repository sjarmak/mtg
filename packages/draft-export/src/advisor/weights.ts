import { z } from 'zod';

// Bounded offline multipliers; structural facts and signal inference are not tunable here.
const coefficient = z.number().finite().min(0).max(4);
const AdvisorWeightsSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9._/-]+$/),
    quality: coefficient,
    pathSupport: coefficient,
    missingPieces: coefficient,
    synergy: coefficient,
    structure: coefficient,
    manaRisk: coefficient,
    dependencyRisk: coefficient,
    commitment: coefficient,
    flexibility: coefficient,
    fixing: coefficient,
  })
  .strict();

export type AdvisorWeights = Readonly<z.infer<typeof AdvisorWeightsSchema>>;

export const DEFAULT_ADVISOR_WEIGHTS: AdvisorWeights = Object.freeze({
  schemaVersion: 1,
  revision: 'legacy-cube-authored/v1',
  quality: 1,
  pathSupport: 1,
  missingPieces: 1,
  synergy: 1,
  structure: 1,
  manaRisk: 1,
  dependencyRisk: 1,
  commitment: 1,
  flexibility: 1,
  fixing: 1,
});

/** Copy and freeze at the boundary so a caller cannot rewrite recorded provenance. */
export function parseAdvisorWeights(input: unknown): AdvisorWeights {
  return Object.freeze(AdvisorWeightsSchema.parse(input));
}
