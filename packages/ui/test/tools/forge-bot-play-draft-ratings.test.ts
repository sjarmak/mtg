import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { ObservedBackend } from '@mtg/engine';
import type { ForgeObservedDecisionPolicy, ForgeObservedPolicyGameOptions } from '@mtg/forge-export';
import { metricsConfig } from '@mtg/metrics';
import {
  formatForgeBotPlayDraftRatingsSummary,
  loadPrintedLimitedFormat,
  runForgeBotPlayDraftRatingsCampaign,
} from '../../tools/forge-bot-play-draft-ratings';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory = '';

beforeEach(() => {
  directory = mkdtempSync(`${tmpdir()}/forge-bot-play-draft-ratings-`);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const policy: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'strongest-test',
    policyVersion: 1,
    observationAdapterId: 'observation/v1',
    actionAdapterId: 'action/v1',
    configuration: { objective: 'strongest-play' },
    configSha256: botEvidenceSha256({ objective: 'strongest-play' }),
  },
  choose: () => ({ status: 'unsupported', family: 'test', reason: 'unused' }),
};

const backend: ObservedBackend = {
  id: 'forge-test',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: async () => [],
  open: async () => {
    throw new Error('the injected runner owns games');
  },
};

function fakeDecision(cardName: string) {
  const value = { view: { seats: [{ hand: [{ name: cardName }] }] } };
  return {
    sequence: 0,
    observation: { sha256: botEvidenceSha256(value), value },
    candidates: { status: 'complete' as const, values: [{ id: 'pass', value: null }] },
    choice: { status: 'chosen' as const, candidateId: 'pass' },
  };
}

function fakeReport(configured: ForgeObservedPolicyGameOptions, measuredCardName: string | null) {
  const decisions = measuredCardName === null ? [] : [fakeDecision(measuredCardName)];
  return {
    evidence: {
      schemaVersion: 1 as const,
      episode: {
        id: configured.evidence.id,
        stage: 'gameplay' as const,
        seed: configured.table.seed,
        runtime: { ...configured.evidence.runtime, kind: 'forge' as const },
        subject: configured.evidence.subject,
        features: { schemaId: 'test/v1', schemaSha256: 'a'.repeat(64) },
        behavior: {
          policyId: 'test',
          configSha256: 'b'.repeat(64),
          modelSha256: null,
          dataSha256: null,
          config: {},
        },
        lineage: configured.evidence.lineage,
        splitGroup: configured.evidence.splitGroup,
      },
      decisions,
      outcome: { status: 'completed' as const, value: { winner: configured.candidateSeat } },
    },
    measurement: {
      candidateSeat: configured.candidateSeat,
      completion: 'completed' as const,
      elapsedMs: 1,
      decisions: decisions.length,
      callbackCounts: {},
    },
  };
}

function fakeUnsupportedReport(configured: ForgeObservedPolicyGameOptions) {
  return {
    evidence: {
      schemaVersion: 1 as const,
      episode: {
        id: configured.evidence.id,
        stage: 'gameplay' as const,
        seed: configured.table.seed,
        runtime: { ...configured.evidence.runtime, kind: 'forge' as const },
        subject: configured.evidence.subject,
        features: { schemaId: 'test/v1', schemaSha256: 'a'.repeat(64) },
        behavior: {
          policyId: 'test',
          configSha256: 'b'.repeat(64),
          modelSha256: null,
          dataSha256: null,
          config: {},
        },
        lineage: configured.evidence.lineage,
        splitGroup: configured.evidence.splitGroup,
      },
      decisions: [],
      outcome: { status: 'unsupported' as const, error: 'card outside the audited slice' },
    },
    measurement: {
      candidateSeat: configured.candidateSeat,
      completion: 'unsupported' as const,
      elapsedMs: 1,
      decisions: 0,
      callbackCounts: {},
    },
  };
}

describe('Forge bot-play draft ratings campaign', () => {
  it('resumes accumulated evidence by seed and rates cards over every invocation', async () => {
    const loaded = await loadPrintedLimitedFormat(repoRoot, 'm15');
    const measuredCard = loaded.catalogs[0]!.catalog.cards[0]!;
    const evidencePath = resolve(directory, 'games.jsonl');
    const games: ForgeObservedPolicyGameOptions[] = [];
    const runGame = async (configured: ForgeObservedPolicyGameOptions) => {
      games.push(configured);
      return fakeReport(configured, measuredCard.correctedName);
    };
    const campaign = {
      loaded,
      backend,
      policy,
      runtimeVersion: 'forge/test',
      runtimeBuildSha256: 'c'.repeat(64),
      seed: 'test-resume',
      evidencePath,
      config: metricsConfig({ floors: { card: 16 } }),
    };

    await runForgeBotPlayDraftRatingsCampaign({ ...campaign, drafts: 1 }, runGame);
    appendFileSync(evidencePath, '{"gameSeed":"interrupted');
    const resumed = await runForgeBotPlayDraftRatingsCampaign({ ...campaign, drafts: 2 }, runGame);
    const evidence = readFileSync(evidencePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);

    expect(games).toHaveLength(16);
    expect(resumed.gamesPlayed).toBe(16);
    expect(resumed.gamesCompleted).toBe(16);
    const ratedCard = resumed.artifact.catalogs[0]!.cards.find(
      (card) => card.physicalId === measuredCard.physicalId,
    );
    expect(ratedCard).toMatchObject({ gamesSeen: 16 });
    expect(ratedCard?.quality).not.toBeNull();
    expect(evidence).toHaveLength(16);
    expect(formatForgeBotPlayDraftRatingsSummary(resumed.artifact)).toBe(
      `1/${String(resumed.artifact.catalogs[0]!.cards.length)} cards rated; ` +
        'unrated gamesSeen min/median/max 0/0/0',
    );
  }, 15_000);

  it('loads m15, drafts, builds decks, and measures a smoke campaign into a schema-valid artifact', async () => {
    const loaded = await loadPrintedLimitedFormat(repoRoot, 'm15');
    expect(loaded.catalogs).toHaveLength(1);
    expect(loaded.prepared.format.draft.seats).toBe(8);

    const measuredCard = loaded.catalogs[0]!.catalog.cards[0]!;
    const games: ForgeObservedPolicyGameOptions[] = [];
    const runGame = async (configured: ForgeObservedPolicyGameOptions) => {
      games.push(configured);
      return fakeReport(configured, measuredCard.correctedName);
    };

    const { artifact, gamesPlayed, gamesCompleted } = await runForgeBotPlayDraftRatingsCampaign(
      {
        loaded,
        backend,
        policy,
        runtimeVersion: 'forge/test',
        runtimeBuildSha256: 'c'.repeat(64),
        drafts: 1,
        seed: 'test-smoke',
        evidencePath: resolve(directory, 'games.jsonl'),
        config: metricsConfig({ floors: { card: 1 } }),
      },
      runGame,
    );

    expect(gamesPlayed).toBe(8);
    expect(gamesCompleted).toBe(8);
    expect(games.map((game) => game.candidateSeat)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    // Each of the 8 drafted decks must be the measured (`local`) seat in exactly
    // one game, in draft-seat order — not always the lower seat of each pair,
    // which would mean the higher seat's cards never get a visible hand.
    const measuredSeatIds = games.map((game) => {
      const name = game.table.seats[game.candidateSeat]!.deck.name;
      const match = /^seat-(\d+) \(/.exec(name);
      if (match === null) throw new Error(`unexpected deck name shape: ${name}`);
      return Number(match[1]);
    });
    expect(measuredSeatIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(artifact.source.kind).toBe('forge-bot-play-win-rate');
    if (artifact.source.kind !== 'forge-bot-play-win-rate') throw new Error('unreachable');
    expect(artifact.source.gamesPlayed).toBe(8);
    expect(artifact.source.gamesCompleted).toBe(8);
    expect(artifact.source.cardFloor).toBe(1);
    expect(artifact.source.version).toBe('forge/test');
    expect(artifact.source.bridgeFingerprint).toBe('c'.repeat(64));

    const catalog = artifact.catalogs[0]!;
    expect(catalog.code).toBe('M15');
    expect(catalog.cards).toHaveLength(loaded.catalogs[0]!.catalog.cards.length);
    const ratedCard = catalog.cards.find((card) => card.physicalId === measuredCard.physicalId);
    expect(ratedCard?.quality).not.toBeNull();
    const unratedCard = catalog.cards.find((card) => card.physicalId !== measuredCard.physicalId);
    expect(unratedCard?.quality).toBeNull();
  });

  it('drops a game with no visible hand instead of recording a card row for it', async () => {
    const loaded = await loadPrintedLimitedFormat(repoRoot, 'm15');
    const runGame = async (configured: ForgeObservedPolicyGameOptions) => fakeReport(configured, null);

    const { artifact, gamesPlayed, gamesCompleted } = await runForgeBotPlayDraftRatingsCampaign(
      {
        loaded,
        backend,
        policy,
        runtimeVersion: 'forge/test',
        runtimeBuildSha256: 'c'.repeat(64),
        drafts: 1,
        seed: 'test-no-hand',
        evidencePath: resolve(directory, 'games.jsonl'),
        config: metricsConfig({ floors: { card: 1 } }),
      },
      runGame,
    );

    expect(gamesPlayed).toBe(8);
    expect(gamesCompleted).toBe(8);
    if (artifact.source.kind !== 'forge-bot-play-win-rate') throw new Error('unreachable');
    expect(artifact.source.gamesCompleted).toBe(8);
    expect(artifact.catalogs[0]!.cards.every((card) => card.quality === null)).toBe(true);
  });

  it('throws and reports 0 completed when every game comes back unsupported', async () => {
    const loaded = await loadPrintedLimitedFormat(repoRoot, 'm15');
    const runGame = async (configured: ForgeObservedPolicyGameOptions) => fakeUnsupportedReport(configured);

    await expect(
      runForgeBotPlayDraftRatingsCampaign(
        {
          loaded,
          backend,
          policy,
          runtimeVersion: 'forge/test',
          runtimeBuildSha256: 'c'.repeat(64),
          drafts: 1,
          seed: 'test-all-unsupported',
          evidencePath: resolve(directory, 'games.jsonl'),
          config: metricsConfig({ floors: { card: 1 } }),
        },
        runGame,
      ),
    ).rejects.toThrow('0 of 8 games completed');
  });

  it('does not count a refused game as completed, and excludes it from the rated rows', async () => {
    const loaded = await loadPrintedLimitedFormat(repoRoot, 'm15');
    const measuredCard = loaded.catalogs[0]!.catalog.cards[0]!;
    let gameIndex = 0;
    const runGame = async (configured: ForgeObservedPolicyGameOptions) => {
      gameIndex += 1;
      // Every other game is refused by Forge; the rest complete and reveal a hand.
      return gameIndex % 2 === 0
        ? fakeUnsupportedReport(configured)
        : fakeReport(configured, measuredCard.correctedName);
    };

    const { gamesPlayed, gamesCompleted } = await runForgeBotPlayDraftRatingsCampaign(
      {
        loaded,
        backend,
        policy,
        runtimeVersion: 'forge/test',
        runtimeBuildSha256: 'c'.repeat(64),
        drafts: 1,
        seed: 'test-mixed-refusal',
        evidencePath: resolve(directory, 'games.jsonl'),
        config: metricsConfig({ floors: { card: 1 } }),
      },
      runGame,
    );

    expect(gamesPlayed).toBe(8);
    expect(gamesCompleted).toBe(4);
  });

  it('propagates a thrown game rather than degrading to a synthetic outcome', async () => {
    const loaded = await loadPrintedLimitedFormat(repoRoot, 'm15');
    const runGame = async (): Promise<never> => {
      throw new Error('Forge crashed mid-game');
    };
    await expect(
      runForgeBotPlayDraftRatingsCampaign(
        {
          loaded,
          backend,
          policy,
          runtimeVersion: 'forge/test',
          runtimeBuildSha256: 'c'.repeat(64),
          drafts: 1,
          seed: 'test-throw',
          evidencePath: resolve(directory, 'games.jsonl'),
        },
        runGame,
      ),
    ).rejects.toThrow('Forge crashed mid-game');
  });
});
