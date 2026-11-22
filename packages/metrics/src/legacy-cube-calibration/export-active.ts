/** Export a checked local journal snapshot. Digests detect drift, not operator forgery. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { parseAdvisorWeights, readAdvisorCalibration } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readCalibrationJson } from './artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from './io';
import { advisorModelFingerprint } from './tuning';
import { readWeightStore } from './weight-store';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'));
const pathsSchema = z.object({ store: path, decision: path, out: path }).strict();
const decisionSchema = z
  .object({
    version: z.literal('legacy-cube-adoption-decision/v1'),
    status: z.literal('provisional-adopt'),
    identity: z.object({ catalogSha256: sha, modelSha256: sha }).strict(),
    runtimeSha256: sha,
    previousHead: sha.nullable(),
    candidate: z.unknown().transform(parseAdvisorWeights),
    reasons: z.array(z.string()).length(0),
    independentHumanValidation: z.literal(false),
    gameplayEvidenceUsed: z.literal(false),
    sha256: sha,
  })
  .passthrough();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export async function exportAdvisorCalibration(input: unknown, catalog: PrintedCardCatalog) {
  const paths = pathsSchema.parse(input);
  const identity = { catalogSha256: catalog.contentSha256, modelSha256: advisorModelFingerprint() };
  const runtime = await calibrationSourceFingerprint();
  const active = await readWeightStore(paths.store, identity);
  if (active.transitionPending) throw new Error('Weight transition pending; cannot export');
  let install = active.history.at(-1);
  while (install?.action.kind === 'rollback') install = active.history[install.action.toSequence - 1];
  if (!install || install.action.kind !== 'install' || active.head === null)
    throw new Error('No provisional calibration installed; use authored defaults');
  const raw = await readCalibrationJson(paths.decision);
  const decision = decisionSchema.parse(raw);
  const { sha256, ...body } = raw as Record<string, unknown>;
  if (hash(JSON.stringify(body)) !== sha256 || sha256 !== install.action.decisionSha256)
    throw new Error('Modified or unrelated adoption decision');
  if (!isDeepStrictEqual(decision.identity, identity) || decision.runtimeSha256 !== runtime)
    throw new Error('Adoption decision identity or runtime is stale');
  if (!isDeepStrictEqual(decision.candidate, active.weights) || decision.previousHead !== install.parent)
    throw new Error('Adoption decision does not match installed weights');
  const content = {
    version: 'legacy-cube-advisor-calibration/v1',
    identity,
    weights: active.weights,
    provenance: {
      status: 'provisional',
      transitionSha256: active.head,
      decisionSha256: decision.sha256,
      runtimeSha256: runtime,
      independentHumanValidation: false,
      botValidated: false,
    },
  };
  const snapshot = await readAdvisorCalibration(
    { ...content, sha256: hash(JSON.stringify(content)) },
    identity,
    async (text) => hash(text),
  );
  const latest = await readWeightStore(paths.store, identity);
  if (
    latest.head !== active.head ||
    latest.transitionPending ||
    (await calibrationSourceFingerprint()) !== runtime
  )
    throw new Error('Calibration changed during export');
  await writeCalibrationJson(paths.out, snapshot);
  return snapshot;
}
