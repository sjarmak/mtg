/** Build a complete, checksum-valid admission input without changing the pinned ledger fixture. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

interface FixtureLedgerCard {
  readonly corpus: string;
  cardFamilySafe: boolean;
}

interface FixtureLedger {
  readonly bridgeReview: unknown;
  readonly families: unknown;
  readonly controllerSurface: unknown;
  readonly syntaxReview: unknown;
  readonly syntaxInventory: unknown;
  readonly auditedCards: FixtureLedgerCard[];
  readonly runtimeProbes: unknown;
  contentSha256: string;
}

/**
 * The production stage consumes an admission decision; it never makes one.
 * Tests therefore derive a completed decision document in a temporary file
 * while leaving the repository's read-only admission artifact untouched.
 */
export function writeCompleteLegacyCubeLedgerFixture(source: string, target: string): string {
  const ledger = JSON.parse(readFileSync(source, 'utf8')) as FixtureLedger;
  for (const card of ledger.auditedCards) {
    if (card.corpus === 'official-full-cardlist') card.cardFamilySafe = true;
  }
  const content = {
    bridgeReview: ledger.bridgeReview,
    families: ledger.families,
    controllerSurface: ledger.controllerSurface,
    syntaxReview: ledger.syntaxReview,
    syntaxInventory: ledger.syntaxInventory,
    auditedCards: ledger.auditedCards,
    runtimeProbes: ledger.runtimeProbes,
  };
  ledger.contentSha256 = createHash('sha256')
    .update(`${JSON.stringify(content)}\n`)
    .digest('hex');
  writeFileSync(target, JSON.stringify(ledger));
  return target;
}
