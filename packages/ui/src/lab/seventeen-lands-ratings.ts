/**
 * The staged 17lands per-card win-rate artifact, mapped onto Draftmancer's
 * [0, 5] band (ADR-0005 rung 1, `mtg-drapv`).
 *
 * `packages/metrics/tools/ingest-17lands-ktk.ts` writes the artifact this
 * reads; it is committed at `packages/metrics/data/17lands-ktk-card-win-rate-v1.json`
 * and imported directly as a JSON module (`resolveJsonModule`), the same way
 * a staged fixture reaches a browser bundle without a fetch and without
 * pulling `@mtg/data`'s `better-sqlite3` into it.
 *
 * The label a set's rail draws under: "17lands measured human play", never
 * "play data" — ADR-0005 reserves `'play-data'` for our own bots' observed
 * win rate, a different rung with a different kind of evidence behind it.
 */
import { mapSeventeenLandsWinRates } from '@mtg/draft-export';
import type { SeventeenLandsCardWinRate, SeventeenLandsRating } from '@mtg/draft-export';
import ktkWinRates from '../../../metrics/data/17lands-ktk-card-win-rate-v1.json';

/** The source label the printed draft rail shows a 17lands-backed rating under. */
export const SEVENTEEN_LANDS_RATING_SOURCE = '17lands measured human play';

interface StagedSeventeenLandsArtifact {
  readonly schemaVersion: 1;
  readonly set: string;
  readonly cards: readonly SeventeenLandsCardWinRate[];
}

/** Printed set code -> fitted 17lands ratings, keyed by physicalId. One set staged today: KTK. */
const STAGED_ARTIFACTS: ReadonlyMap<string, StagedSeventeenLandsArtifact> = new Map([
  [(ktkWinRates as StagedSeventeenLandsArtifact).set, ktkWinRates as StagedSeventeenLandsArtifact],
]);

/**
 * The fitted rating map for a printed set code, or `undefined` when no
 * 17lands artifact is staged for it. A caller falls through to the next rung
 * (ADR-0005 section 2's ladder) on `undefined`, exactly as an absent rung
 * from any other source does.
 */
export function seventeenLandsRatingsFor(
  setCode: string,
): ReadonlyMap<string, SeventeenLandsRating> | undefined {
  const artifact = STAGED_ARTIFACTS.get(setCode);
  if (artifact === undefined) return undefined;
  return mapSeventeenLandsWinRates(artifact.cards);
}
