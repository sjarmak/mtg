/** Browser-safe strategic ratings staged beside one authenticated printed format. */
import { z } from 'zod';
import { printedSourceFingerprint } from '@mtg/draft-export';
import { evaluateStructuralPrintedCard, STRUCTURAL_PRINTED_EVALUATION_POLICY } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import { sha256Text } from '../routes/analysis/calibration-read';

const HexSha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const RatingCardSchema = z.strictObject({
  physicalId: z.string().min(1),
  sourceFingerprint: z.number().int().nonnegative(),
  quality: z.number().min(0).max(5).nullable(),
  /** Distinct decided games where this card appeared in the measured hand. */
  gamesSeen: z.number().int().nonnegative().optional(),
});
/**
 * Fields every rung-3-or-better source carries: the Forge build and bridge
 * that produced it, plus a content fingerprint over the catalogs and cards
 * (`printedDraftRatingsFingerprintInput`).
 */
const RatedSourceFields = {
  version: z.string().trim().min(1),
  bridgeFingerprint: HexSha256,
  fingerprint: HexSha256,
};
/** Rung 2 (ADR-0005): Forge's own `DraftRankCache`, human judgment at scale. */
const ForgeLimitedRankingsSource = z.strictObject({
  kind: z.literal('forge-limited-rankings'),
  ...RatedSourceFields,
});
/**
 * Rung 3 for a printed format Forge ranks no other way: our own measured
 * win-rate-when-drawn from Forge bot-play games (`mtg-w0xm8`). `gamesPlayed`,
 * `gamesCompleted` and `cardFloor` are the honest half of the provenance
 * ADR-0005 requires — how much evidence a shown quality actually rests on,
 * and how much of the attempted evidence Forge actually produced (a game
 * Forge refused, aborted or timed out never contributes a win/loss row) —
 * and are not themselves part of the content fingerprint, which covers only
 * the catalogs and cards a reader can re-check.
 */
const ForgeBotPlayWinRateSource = z.strictObject({
  kind: z.literal('forge-bot-play-win-rate'),
  ...RatedSourceFields,
  gamesPlayed: z.number().int().nonnegative(),
  gamesCompleted: z.number().int().nonnegative(),
  cardFloor: z.number().int().positive(),
});
export const PrintedDraftRatingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-draft-ratings'),
  source: z.discriminatedUnion('kind', [ForgeLimitedRankingsSource, ForgeBotPlayWinRateSource]),
  catalogs: z.array(
    z.strictObject({
      code: z.string().regex(/^[A-Z0-9]+$/u),
      catalogSha256: HexSha256,
      cards: z.array(RatingCardSchema),
    }),
  ),
});
export type PrintedDraftRatings = z.infer<typeof PrintedDraftRatingsSchema>;

const [PRINTED_DECK_MODEL_VERSION] = STRUCTURAL_PRINTED_EVALUATION_POLICY.split('/');
if (PRINTED_DECK_MODEL_VERSION === undefined) throw new Error('Printed deck model policy has no version');
const PRINTED_DRAFT_RATINGS_POLICY_PREFIX = `${PRINTED_DECK_MODEL_VERSION}/printed-forge-rank-v3/`;

export function printedDraftRatingsPolicy(ratings: PrintedDraftRatings): string {
  return `${PRINTED_DRAFT_RATINGS_POLICY_PREFIX}${ratings.source.fingerprint}`;
}

export function isPrintedDraftRatingsPolicy(policy: string | undefined): boolean {
  return policy?.startsWith(PRINTED_DRAFT_RATINGS_POLICY_PREFIX) === true;
}

export function printedDraftRatingsFingerprintInput(
  source: Pick<PrintedDraftRatings['source'], 'version' | 'bridgeFingerprint'>,
  catalogs: PrintedDraftRatings['catalogs'],
): string {
  return JSON.stringify(['printed-draft-ratings-v1', source.bridgeFingerprint, source.version, catalogs]);
}

/** Exact catalog coverage makes absence and stale ratings fail before a draft starts. */
export async function validatePrintedDraftRatings(
  input: unknown,
  prepared: Pick<PreparedPrintedLimitedFormat, 'format'>,
  catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[],
): Promise<PrintedDraftRatings> {
  const ratings = PrintedDraftRatingsSchema.parse(input);
  if (
    ratings.catalogs.length !== prepared.format.sources.length ||
    catalogs.length !== ratings.catalogs.length
  )
    throw new Error('Printed draft ratings do not provide complete source coverage');
  for (const source of prepared.format.sources) {
    const catalog = catalogs.find(
      (candidate) =>
        candidate.code === source.code && candidate.catalog.contentSha256 === source.catalogSha256,
    );
    const rated = ratings.catalogs.find(
      (candidate) => candidate.code === source.code && candidate.catalogSha256 === source.catalogSha256,
    );
    if (catalog === undefined || rated === undefined)
      throw new Error(`Printed draft ratings do not match source ${source.code}`);
    if (rated.cards.length !== catalog.catalog.cards.length)
      throw new Error(`Printed draft ratings do not provide complete ${source.code} catalog coverage`);
    const byId = new Map(rated.cards.map((card) => [card.physicalId, card]));
    if (byId.size !== rated.cards.length)
      throw new Error(`Printed draft ratings repeat a ${source.code} physical card id`);
    for (const card of catalog.catalog.cards) {
      const rating = byId.get(card.physicalId);
      if (rating === undefined)
        throw new Error(`Printed draft ratings do not provide complete ${source.code} catalog coverage`);
      if (rating.sourceFingerprint !== printedSourceFingerprint(card))
        throw new Error(`Printed draft rating is stale for ${card.correctedName}`);
    }
  }
  const fingerprint = await sha256Text(printedDraftRatingsFingerprintInput(ratings.source, ratings.catalogs));
  if (fingerprint !== ratings.source.fingerprint)
    throw new Error('Printed draft ratings fingerprint does not match their content');
  return ratings;
}

/**
 * The staged quality for this card, or `null` when the staged catalogs do not
 * carry it. A bot may not run on a card it cannot score, so `printedDraftQuality`
 * still throws; a surface only has a sentence to write, and needs to tell a
 * missing card apart from a missing catalog rather than catching an error.
 */
export function findPrintedDraftQuality(ratings: PrintedDraftRatings, physicalId: string): number | null {
  for (const catalog of ratings.catalogs) {
    const card = catalog.cards.find((candidate) => candidate.physicalId === physicalId);
    if (card !== undefined) return card.quality;
  }
  return null;
}

export function printedDraftQuality(ratings: PrintedDraftRatings, physicalId: string): number {
  const quality = findPrintedDraftQuality(ratings, physicalId);
  if (quality === null) throw new Error(`No staged printed draft rating for ${physicalId}`);
  return quality;
}

/**
 * Combine a set ranking with the transferable structural facts used by draft
 * and construction. A card Forge does not rank keeps its structural quality
 * rather than throwing; `printedDraftQuality` is for callers that have already
 * refused a partial ranking, such as the direct draft campaign, which checks
 * the whole ratings file in `validated()` before it deals a pack.
 */
export function evaluateRankedPrintedCard(
  ratings: PrintedDraftRatings,
  card: PrintedCardCatalogEntry,
  id: string,
) {
  const structural = evaluateStructuralPrintedCard(card, id);
  const quality = findPrintedDraftQuality(ratings, card.physicalId);
  return quality === null ? structural : { ...structural, quality };
}
