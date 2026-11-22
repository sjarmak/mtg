import { createHash } from 'node:crypto';
import type { ObservedBackend } from '@mtg/engine';
import {
  runForgeObservedPolicyGame,
  type ForgeObservedDecisionPolicy,
  type ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import { serializedPrintedConstructedFormatContent, type PrintedConstructedFormat } from '@mtg/printed-card';
import { preparePreconMatch } from '../src/routes/printed/precon-match';

interface ForgeProofResult {
  readonly archetypeId: string;
  readonly status: 'completed' | 'failed';
  readonly decisions: number;
  readonly elapsedMs: number;
  readonly reason?: string;
}

export interface PrintedConstructedForgeReceipt {
  readonly schemaVersion: 1;
  readonly formatId: string;
  readonly formatSha256: string;
  readonly results: readonly ForgeProofResult[];
}

type GameRunner = (options: ForgeObservedPolicyGameOptions) => ReturnType<typeof runForgeObservedPolicyGame>;

export async function runPrintedConstructedForgeProof(options: {
  readonly format: PrintedConstructedFormat;
  readonly backend: ObservedBackend;
  readonly policy: ForgeObservedDecisionPolicy;
  readonly runGame?: GameRunner;
  readonly maximumDecisions?: number;
}): Promise<PrintedConstructedForgeReceipt> {
  if (options.format.decks.length === 0) throw new Error('Forge proof requires at least one deck');
  const actualFormatSha256 = createHash('sha256')
    .update(serializedPrintedConstructedFormatContent(options.format))
    .digest('hex');
  if (actualFormatSha256 !== options.format.contentSha256) {
    throw new Error(`constructed format ${options.format.id} checksum mismatch`);
  }
  const runGame = options.runGame ?? runForgeObservedPolicyGame;
  const cardsSha256 = createHash('sha256')
    .update(options.format.sources.map((source) => source.catalogSha256).join('\n'))
    .digest('hex');
  const results: ForgeProofResult[] = [];
  for (const [index, deck] of options.format.decks.entries()) {
    const opponent = options.format.decks[(index + 1) % options.format.decks.length]!;
    const report = await runGame({
      backend: options.backend,
      table: preparePreconMatch(
        options.format,
        { human: deck, opponent },
        { seed: `${options.format.id}/constructed/${deck.id}/v1`, humanSeat: 0 },
      ),
      candidateSeat: 0,
      policy: options.policy,
      evidence: {
        id: `${options.format.id}/constructed/${deck.id}/v1`,
        runtime: {
          version: options.backend.id,
          buildSha256: options.format.contentSha256,
        },
        subject: {
          formatId: options.format.id,
          formatSha256: options.format.contentSha256,
          cardsSha256,
        },
        modelSha256: null,
        dataSha256: null,
        lineage: { setId: options.format.id, gameId: deck.id },
        splitGroup: { kind: 'game', id: deck.id },
      },
      maximumDecisions: options.maximumDecisions ?? 5_000,
    });
    const status = report.evidence.outcome.status;
    results.push({
      archetypeId: deck.id,
      status: status === 'completed' ? 'completed' : 'failed',
      decisions: report.measurement.decisions,
      elapsedMs: report.measurement.elapsedMs,
      ...(status === 'completed' ? {} : { reason: report.evidence.outcome.error }),
    });
  }
  return {
    schemaVersion: 1,
    formatId: options.format.id,
    formatSha256: options.format.contentSha256,
    results,
  };
}
