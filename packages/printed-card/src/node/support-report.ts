import { buildPrintedSupportReport } from '../support-report';
import { verifyPrintedPlayAdmission } from './play-admission';

/** Trusted local tooling: the caller supplies a measured subject and full catalog population. */
export function verifyPrintedSupportReport(
  body: string,
  expectedSubject: unknown,
  requiredCardIds: readonly string[],
  readEvidence: (relativePath: string) => string | Uint8Array,
) {
  // Parse and reject stale/foreign claims before requesting any receipt bytes.
  const report = buildPrintedSupportReport(JSON.parse(body), expectedSubject, requiredCardIds);
  verifyPrintedPlayAdmission(body, expectedSubject, requiredCardIds, readEvidence);
  return { ...report, evidenceVerification: 'verified' as const };
}
