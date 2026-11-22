/** Portable local snapshot, not an independent validation certificate. No IO or model calls. */
import { z } from 'zod';
import { LEGACY_CUBE_ADVISOR_MODEL } from './legacy';
import { parseAdvisorWeights } from './weights';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z.object({ catalogSha256: sha, modelSha256: sha }).strict();
const schema = z
  .object({
    version: z.literal('legacy-cube-advisor-calibration/v1'),
    identity: identitySchema,
    weights: z.unknown().transform(parseAdvisorWeights),
    provenance: z
      .object({
        status: z.literal('provisional'),
        transitionSha256: sha,
        decisionSha256: sha,
        runtimeSha256: sha,
        independentHumanValidation: z.literal(false),
        botValidated: z.literal(false),
      })
      .strict(),
    sha256: sha,
  })
  .strict();
export type AdvisorCalibration = z.infer<typeof schema>;

/** One serialization for browser and offline fingerprints; weights are versioned separately. */
export function advisorModelIdentityText(): string {
  return JSON.stringify({
    archetypes: LEGACY_CUBE_ADVISOR_MODEL.archetypes,
    profiles: LEGACY_CUBE_ADVISOR_MODEL.profiles,
    packages: LEGACY_CUBE_ADVISOR_MODEL.packages,
  });
}

export async function readAdvisorCalibration(
  input: unknown,
  expectedIdentity: z.infer<typeof identitySchema>,
  hash: (text: string) => Promise<string>,
): Promise<AdvisorCalibration> {
  const parsed = schema.parse(input);
  const expected = identitySchema.parse(expectedIdentity);
  if (
    parsed.identity.catalogSha256 !== expected.catalogSha256 ||
    parsed.identity.modelSha256 !== expected.modelSha256
  )
    throw new Error('Advisor calibration identity is stale');
  const { sha256, ...body } = parsed;
  if ((await hash(JSON.stringify(body))) !== sha256) throw new Error('Advisor calibration checksum mismatch');
  return parsed;
}
