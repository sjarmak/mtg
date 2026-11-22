/** Frozen two-arm diagnostic review. No search, ledger writes, or adoption authority. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseAdvisorWeights, validateAdvisorMetadata } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { admitHumanEvidence, sourceKey } from './human-evidence';
import { advisorModelFingerprint, preparePick, replayCandidate } from './tuning';
import type { selectTuningCandidate } from './tuning';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const runtimeSchema = z.object({ source: sha, node: z.string().min(1).max(128) }).strict();
type Runtime = z.infer<typeof runtimeSchema>;
const weights = z.unknown().transform(parseAdvisorWeights);
const bodySchema = z
  .object({
    version: z.literal('legacy-cube-sealed-proposal/v1'),
    baseline: weights,
    selected: weights,
    catalog: sha,
    model: sha,
    tuningCorpus: sha,
    runtime: runtimeSchema,
    sources: z
      .array(
        z
          .object({
            url: z.string().url().transform(sourceKey),
            session: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
    search: z
      .object({ step: z.number().finite().positive().max(1), candidates: z.number().int().min(1).max(21) })
      .strict(),
  })
  .strict();
const sealedSchema = bodySchema.extend({ sha256: sha }).strict();

/** Sealing records local provenance; hashes do not authenticate human authorship. */
export function sealTuningProposal(result: ReturnType<typeof selectTuningCandidate>, runtime: Runtime) {
  if (result.status === 'insufficient-evidence') throw new Error('Cannot seal insufficient tuning evidence');
  const body = bodySchema.parse({
    version: 'legacy-cube-sealed-proposal/v1',
    baseline: result.search.baseline,
    selected: result.selected,
    catalog: result.provenance.catalog,
    model: result.provenance.model,
    tuningCorpus: result.provenance.tuningCorpus,
    runtime,
    sources: [...result.admission.admitted, ...result.admission.excluded]
      .map(({ source }) => ({ url: sourceKey(source.url), session: source.session }))
      .sort((a, b) => a.url.localeCompare(b.url) || a.session.localeCompare(b.session)),
    search: { step: result.search.step, candidates: result.search.candidates },
  });
  return Object.freeze({
    ...body,
    runtime: Object.freeze(body.runtime),
    search: Object.freeze(body.search),
    sources: Object.freeze(body.sources.map((source) => Object.freeze(source))),
    sha256: hash(body),
  });
}

function readSeal(input: unknown, catalog: PrintedCardCatalog, runtime: Runtime) {
  const { sha256, ...body } = sealedSchema.parse(input);
  if (hash(body) !== sha256) throw new Error('Sealed proposal digest mismatch');
  if (body.catalog !== catalog.contentSha256 || body.model !== advisorModelFingerprint())
    throw new Error('Sealed proposal catalog/model mismatch');
  if (hash(body.runtime) !== hash(runtimeSchema.parse(runtime)))
    throw new Error('Sealed proposal runtime mismatch');
  const errors = validateAdvisorMetadata(catalog).errors;
  if (errors.length) throw new Error(`Stale advisor metadata: ${errors.join('; ')}`);
  return { ...body, sha256 };
}

function pairedDifference(
  baseline: ReturnType<typeof replayCandidate>,
  selected: ReturnType<typeof replayCandidate>,
) {
  const differences = baseline.sessions.map((base, i) => selected.sessions[i]!.agreement - base.agreement);
  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  // Each paired session difference is bounded in [-1, 1]. Conservative two-sided 95% bound.
  const radius = Math.sqrt((2 * Math.log(40)) / differences.length);
  return {
    sessions: differences.length,
    mean,
    interval:
      differences.length < 2 ? null : { low: Math.max(-1, mean - radius), high: Math.min(1, mean + radius) },
    method: '95% Hoeffding bound on independent paired session agreement differences',
  };
}

/** Validate identities and admission without evaluating either arm. */
export function prepareHeldOutReview(
  input: unknown,
  holdout: unknown,
  catalog: PrintedCardCatalog,
  runtime: Runtime,
) {
  const proposal = readSeal(input, catalog, runtime);
  const admission = admitHumanEvidence(holdout, catalog, 'holdout');
  const sources = [...admission.admitted, ...admission.excluded].map(({ source }) => source);
  if (
    sources.some((s) => proposal.sources.some((t) => t.url === sourceKey(s.url) || t.session === s.session))
  )
    throw new Error('Held-out evidence source/session overlaps tuning');
  if (admission.excluded.length) throw new Error('Frozen holdout contains excluded evidence');
  const picks = admission.admitted.filter((c) => c.kind === 'pick').map((c) => preparePick(c, catalog));
  return { proposal, admission, picks, sources };
}

/** Pure replay is reproducible, not proof that this holdout has never been used before. */
export function reviewHeldOutPicks(
  input: unknown,
  holdout: unknown,
  catalog: PrintedCardCatalog,
  runtime: Runtime,
) {
  const { proposal, admission, picks } = prepareHeldOutReview(input, holdout, catalog, runtime);
  const baseline = picks.length ? replayCandidate(picks, proposal.baseline) : null;
  const selected = picks.length ? replayCandidate(picks, proposal.selected) : null;
  return {
    version: 'legacy-cube-held-out-picks/v1',
    status: picks.length ? 'compared' : 'insufficient-evidence',
    proposal: proposal.sha256,
    holdout: admission.corpusSha256,
    admission,
    baseline,
    selected,
    difference: baseline && selected ? pairedDifference(baseline, selected) : null,
    unscoredDecks: admission.admitted.filter((c) => c.kind === 'deck').map((c) => c.id),
    adoptionEligible: false as const,
    unmeasured: [
      'holdout-use-ledger',
      'coherent-castable-decks',
      'observable-explanation-truth',
      'archetype-exploration',
      'regression-gates',
      'competent-bots-if-games-used',
    ],
  };
}
