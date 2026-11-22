/** Diagnostic model agreement, never a semantic-quality or adoption gate. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseAdvisorWeights } from '@mtg/draft-export';
import type { AdvisorWeights, ObservedDraft } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readModelEvidence } from './model-evidence';
import { advisorModelFingerprint, replayObservablePick } from './tuning';

type Receipt = ReturnType<typeof readModelEvidence>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Exclude session, replica, objective, and pack display order from leakage identity.
function situation(receipt: Receipt) {
  const payload = receipt.task.payload;
  return digest({
    picks: payload.picks,
    observations: payload.observations.map((o) => ({ ...o, cards: [...o.cards].sort() })),
  });
}

function checkPartition(receipts: readonly Receipt[]) {
  const tasks = new Set<string>();
  const sessions = new Map<string, string>();
  const starts = new Map<string, { session: string; split: string }>();
  for (const receipt of receipts) {
    const { session, split } = receipt.task.coordinates;
    if (tasks.has(receipt.task.sha256)) throw new Error('Duplicate model task');
    tasks.add(receipt.task.sha256);
    // A renamed later pick still shares the opening pack. Conservatively keep
    // coincident opening packs together, even when their later trajectories differ.
    const start = digest([...receipt.task.payload.observations[0]!.cards].sort());
    const prior = starts.get(start);
    if ((sessions.has(session) && sessions.get(session) !== split) || (prior && prior.split !== split))
      throw new Error('Model tuning/holdout split leakage');
    if (prior && prior.session !== session)
      throw new Error('Same model situation assigned multiple sessions');
    sessions.set(session, split);
    starts.set(start, { session, split });
  }
}

function replay(catalog: PrintedCardCatalog, receipts: readonly Receipt[], weights: AdvisorWeights) {
  const byId = new Map(catalog.cards.map((c) => [c.physicalId, c]));
  const picks = receipts.map((receipt) => {
    const { task, judgment } = receipt;
    // Receipt reconstruction already proved every physical ID belongs to this catalog.
    const observed: ObservedDraft = {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks: task.payload.picks,
      observations: task.payload.observations.map((o) => ({
        ...o,
        cards: o.cards.map((id) => byId.get(id)!),
      })),
    };
    return {
      receipt: receipt.sha256,
      session: task.coordinates.session,
      decision: digest({ situation: situation(receipt), objective: task.payload.objective }),
      ...replayObservablePick(observed, task.coordinates, judgment.acceptable, weights),
    };
  });
  const sessions = [...new Set(picks.map((p) => p.session))].sort().map((session) => {
    const rows = picks.filter((p) => p.session === session);
    const decisions = [...new Set(rows.map((p) => p.decision))].map((decision) => {
      const replicas = rows.filter((p) => p.decision === decision);
      return replicas.filter((p) => p.agrees).length / replicas.length;
    });
    return {
      session,
      decisions: decisions.length,
      agreement: decisions.reduce((a, b) => a + b, 0) / decisions.length,
    };
  });
  return {
    weights,
    picks,
    sessions,
    agreement: sessions.reduce((sum, s) => sum + s.agreement, 0) / sessions.length,
  };
}

export function compareModelEvidence(
  catalog: PrintedCardCatalog,
  input: unknown,
  splitInput: unknown,
  baselineInput: unknown,
  candidateInput: unknown,
) {
  const split = z.enum(['tuning', 'holdout']).parse(splitInput);
  const baseline = parseAdvisorWeights(baselineInput);
  const candidate = parseAdvisorWeights(candidateInput);
  const all = z
    .array(z.unknown())
    .max(10000)
    .parse(input)
    .map((r) => readModelEvidence(catalog, r));
  checkPartition(all);
  const receipts = all
    .filter((r) => r.task.coordinates.split === split)
    .sort((a, b) => a.sha256.localeCompare(b.sha256));
  if (!receipts.length) throw new Error('Cannot compare an empty model sample');
  return {
    version: 'legacy-cube-model-comparison/v1',
    origin: 'model' as const,
    independentHumanEvidence: false as const,
    adoptionEligible: false as const,
    strategicTruth: 'unmeasured' as const,
    split,
    catalog: catalog.contentSha256,
    model: advisorModelFingerprint(),
    receipts,
    baseline: replay(catalog, receipts, baseline),
    candidate: replay(catalog, receipts, candidate),
    limitations: [
      'model-agreement-is-not-deck-quality',
      'independence-unmeasured',
      'cross-invocation-split-ledger-not-checked',
    ],
  };
}
