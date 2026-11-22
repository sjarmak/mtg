/** Consume retained evidence against independently supplied, reviewed expectations. */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PrintedScenarioProbeReceiptSchema } from '@mtg/printed-card';
import {
  createScenarioProbeReceipts,
  PrintedScenarioProbeDefinitionSchema,
} from './printed-scenario-receipts';

type Expected = Parameters<typeof createScenarioProbeReceipts>[0];

/**
 * Callers must measure the runtime, capture current test/support sources, and
 * select reviewed probes and catalog bindings independently of the receipt.
 * The same report/journal checks serve issuance and consumption; comparing only
 * the stored hashes would accept rewritten evidence with rewritten checksums.
 * No file paths supplied by a receipt are read here. This verifies scoped local
 * evidence, not publisher authenticity or whole-card/format admission.
 */
export function verifyScenarioProbeReceipts(
  input: Expected & {
    readonly receipts: readonly unknown[];
  },
) {
  const receipts = z.array(PrintedScenarioProbeReceiptSchema).min(1).parse(input.receipts);
  const expected = createScenarioProbeReceipts(input);
  if (
    receipts.length !== expected.length ||
    new Set(receipts.map((receipt) => receipt.result.id)).size !== receipts.length
  )
    throw new Error('Scenario receipt population mismatch');
  for (const claim of expected) {
    const receipt = receipts.find((candidate) => candidate.result.id === claim.result.id);
    if (!isDeepStrictEqual(receipt, claim))
      throw new Error(`Scenario receipt differs from current evidence or reviewed claim: ${claim.result.id}`);
  }
  return { receipts, qualification: 'unproven' as const };
}

/** The reader owns confinement to its evidence root, including symbolic-link policy. */
export async function verifyRetainedScenarioProbeReceipts(
  input: Omit<Expected, 'reportBytes' | 'usageBytes'> & {
    readonly readEvidence: (relativePath: string) => Promise<string>;
  },
) {
  const probes = z.array(PrintedScenarioProbeDefinitionSchema).min(1).parse(input.probes);
  const [reportBytes, usageBytes, receipts] = await Promise.all([
    input.readEvidence('vitest.json'),
    input.readEvidence('snapshot-usage.jsonl'),
    Promise.all(
      probes.map(
        async (probe): Promise<unknown> =>
          JSON.parse(await input.readEvidence(`probes/${probe.id}.json`)) as unknown,
      ),
    ),
  ]);
  return verifyScenarioProbeReceipts({ ...input, probes, reportBytes, usageBytes, receipts });
}
