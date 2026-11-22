/** A full-population view of admission claims; no script-based semantic inference. */
import {
  PrintedPlayAdmissionSchema,
  evaluatePrintedPlayAdmission,
  type PrintedAdmissionReason,
} from './play-admission';

const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
const orderedReasons = (reasons: readonly PrintedAdmissionReason[]) =>
  [...reasons].sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

/**
 * Structural only, like evaluatePrintedPlayAdmission. The Node verifier must
 * validate referenced receipt bytes before these claims become checked evidence.
 * The population comes from the caller's complete, independently loaded catalogs.
 */
export function buildPrintedSupportReport(
  input: unknown,
  expectedSubject: unknown,
  requiredCardIds: readonly string[],
) {
  const artifact = PrintedPlayAdmissionSchema.parse(input);
  const verdict = evaluatePrintedPlayAdmission(artifact, expectedSubject, requiredCardIds);
  const invalid = verdict.reasons.filter(
    (reason) => reason.code === 'subject-mismatch' || reason.code === 'foreign-card',
  );
  if (invalid.length > 0) throw new Error(`Invalid printed support evidence: ${JSON.stringify(invalid)}`);
  const reviews = new Map(artifact.cards.map((card) => [card.id, card]));
  const cards = sorted(requiredCardIds).map((physicalId) => {
    const review = reviews.get(physicalId);
    const families = (controller: 'local' | 'engine') =>
      sorted(
        artifact.probes.flatMap((probe) =>
          review?.probeIds.includes(probe.id) &&
          probe.scope === 'card' &&
          probe.status === 'passed' &&
          probe.controller === controller &&
          probe.cardIds.includes(physicalId)
            ? probe.decisionFamilies
            : [],
        ),
      );
    return {
      physicalId,
      review: review?.review ?? ('missing' as const),
      note: review?.note ?? null,
      declaredFamilies: sorted(review?.decisionFamilies ?? []),
      claimedPassedFamilies: { local: families('local'), engine: families('engine') },
      gaps: orderedReasons(verdict.reasons.filter((reason) => reason.cardId === physicalId)),
    };
  });
  return {
    schemaVersion: 1 as const,
    kind: 'printed-support-report' as const,
    subject: artifact.subject,
    evidenceVerification: 'not-performed' as const,
    admitted: verdict.admitted,
    cards,
    matchGaps: orderedReasons(verdict.reasons.filter((reason) => reason.code === 'unproven-match')),
  };
}
