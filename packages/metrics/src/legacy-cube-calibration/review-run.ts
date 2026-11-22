/** Reserve held-out evidence before any two-arm evaluation; persist results without overwrite. */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { prepareHeldOutReview, reviewHeldOutPicks } from './holdout';
import { reserveHoldoutReview } from './review-ledger';

export async function runHeldOutPickReview(
  input: unknown,
  holdout: unknown,
  catalog: Parameters<typeof reviewHeldOutPicks>[2],
  runtime: Parameters<typeof reviewHeldOutPicks>[3],
  directory: string,
) {
  // Copy before awaiting IO so callers cannot change the labels or selected weights mid-reservation.
  const proposalSnapshot: unknown = structuredClone(input);
  const holdoutSnapshot: unknown = structuredClone(holdout);
  const runtimeSnapshot = { ...runtime };
  const catalogSnapshot = structuredClone(catalog);
  const prepared = prepareHeldOutReview(proposalSnapshot, holdoutSnapshot, catalogSnapshot, runtimeSnapshot);
  if (!prepared.picks.length)
    return {
      review: reviewHeldOutPicks(proposalSnapshot, holdoutSnapshot, catalogSnapshot, runtimeSnapshot),
      path: null,
    };
  const reservation = await reserveHoldoutReview(directory, {
    proposal: prepared.proposal.sha256,
    holdout: prepared.admission.corpusSha256,
    sources: prepared.sources.map((source) => ({ url: source.url, session: source.session })),
  });
  const comparison = reviewHeldOutPicks(proposalSnapshot, holdoutSnapshot, catalogSnapshot, runtimeSnapshot);
  const review = {
    ...comparison,
    reservation: reservation.id,
    unmeasured: comparison.unmeasured.filter((dimension) => dimension !== 'holdout-use-ledger'),
  };
  const path = join(dirname(reservation.path), `result-${reservation.id}.json`);
  await writeFile(path, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  return { review, path };
}
