import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256, type BotEvidenceEpisode, type JsonValue } from '@mtg/bot-evidence';
import type { Card, Color } from '@mtg/dsl';
import { canonicalJson, COLORS } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import {
  StageStrengthCampaignPlanSchema,
  stageStrengthGameEpisodeId,
  validateStageStrengthEpisode,
  type StageStrengthArm,
  type StageStrengthCampaignPlan,
  type StageStrengthOutcomeEvidence,
  type StageStrengthTrial,
} from '@mtg/metrics';
import {
  agentSeed,
  createBot,
  NativeGameplayEvidenceError,
  playSimGame,
  type BotSpec,
  type GameBudget,
} from '@mtg/sim';
import type { BuiltDeck } from './build';
import { completedDeckbuildingEvidence } from './deck-evidence';
import type { SetPool } from './pool';

/** Fingerprint every exact DSL card a set-backed build can resolve for native play. */
export function constructedPoolSha256(pool: SetPool): string {
  return botEvidenceSha256(
    [...pool.playable.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([oracleId, card]) => ({ oracleId, card })),
  );
}

function copies(card: Card, count: number): readonly Card[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`invalid copy count for ${card.name}`);
  return Array.from({ length: count }, () => card);
}

function selectedCards(pool: SetPool, built: BuiltDeck): readonly Card[] {
  return [...built.deck.spells, ...built.deck.lands].flatMap((entry) => {
    const card = pool.playable.get(entry.card.oracleId);
    if (card === undefined) {
      throw new Error(
        `constructed deck references ${entry.card.name}, which is absent from its playable pool`,
      );
    }
    return copies(card, entry.count);
  });
}

function basicFor(pool: SetPool, color: Color): Card {
  const matches = pool.basics.filter(
    (card) => card.kind === 'land' && card.producesMana.length === 1 && card.producesMana[0] === color,
  );
  if (matches.length !== 1) {
    throw new Error(`constructed playable pool must resolve exactly one ${color} basic land`);
  }
  return matches[0]!;
}

function basicCards(pool: SetPool, built: BuiltDeck): readonly Card[] {
  return COLORS.flatMap((color) => copies(basicFor(pool, color), built.deck.manaBase.basics[color]));
}

/** Resolve an evidence-backed Decklab build into the exact cards the native kernel deals. */
export function constructedDeckList(name: string, pool: SetPool, built: BuiltDeck): DeckList {
  const evidence = built.evidence;
  if (evidence === undefined || evidence.outcome.status !== 'completed') {
    throw new Error('constructed runtime requires a completed evidence-backed build');
  }
  const expected = completedDeckbuildingEvidence(evidence.episode, evidence.decisions, built);
  if (!isDeepStrictEqual(evidence, expected)) {
    throw new Error('constructed build evidence does not describe the supplied build');
  }
  if (evidence.episode.subject.cardsSha256 !== constructedPoolSha256(pool)) {
    throw new Error('constructed playable pool SHA-256 differs from the evidence-backed subject');
  }
  if (evidence.episode.subject.formatSha256 !== botEvidenceSha256(built.construction.format)) {
    throw new Error('constructed format SHA-256 differs from the evidence-backed subject');
  }
  if (built.criteria.size !== 60 || built.deck.totalCards !== 60 || built.shortBy !== 0) {
    throw new Error('constructed runtime requires an exact 60-card deck');
  }

  const cards = [...selectedCards(pool, built), ...basicCards(pool, built)];
  if (cards.length !== built.deck.totalCards) {
    throw new Error('constructed runtime resolved a card count that differs from the built deck');
  }
  return { name, cards };
}

export interface ConstructedTrialGameOptions {
  readonly plan: StageStrengthCampaignPlan;
  readonly unitId: string;
  readonly arm: StageStrengthArm;
  readonly pool: SetPool;
  readonly built: BuiltDeck;
  readonly buildElapsedMs: number;
  readonly opponents: ReadonlyMap<string, DeckList>;
  readonly focalBot: BotSpec;
  readonly opponentBot: BotSpec;
  readonly budget?: GameBudget;
}

function verifiedBot(spec: BotSpec, expectedSha256: string, label: string): void {
  if (botEvidenceSha256(spec) !== expectedSha256) {
    throw new Error(`${label} bot differs from the preregistered downstream policy`);
  }
}

function botConfig(spec: BotSpec): JsonValue {
  return JSON.parse(canonicalJson(spec)) as JsonValue;
}

function failedStatus(error: unknown): Exclude<StageStrengthOutcomeEvidence['status'], 'completed'> {
  if (error instanceof NativeGameplayEvidenceError && error.evidence.outcome.status !== 'completed') {
    return error.evidence.outcome.status;
  }
  return 'engine-failure';
}

/** Play every pinned downstream game for one constructed build and retain canonical trial evidence. */
export function runConstructedTrialGames(options: ConstructedTrialGameOptions): StageStrengthTrial {
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  if (plan.stage !== 'constructed-construction' || plan.engine !== 'native') {
    throw new Error('constructed runtime requires a native constructed-construction campaign');
  }
  const row = plan.schedule.find((candidate) => candidate.unitId === options.unitId);
  if (row === undefined) throw new Error(`constructed campaign does not schedule unit ${options.unitId}`);
  const evidence = options.built.evidence;
  if (evidence === undefined) throw new Error('constructed runtime requires build evidence');
  validateStageStrengthEpisode(plan, row.unitId, options.arm, evidence);
  if (!Number.isFinite(options.buildElapsedMs) || options.buildElapsedMs < 0) {
    throw new Error('constructed build elapsed cost must be a nonnegative finite number');
  }

  verifiedBot(options.focalBot, plan.downstream.focalPolicy.configSha256, 'focal');
  verifiedBot(options.opponentBot, plan.downstream.opponentPolicy.configSha256, 'opponent');
  const focalDeck = constructedDeckList(`${row.unitId}-${options.arm}`, options.pool, options.built);
  const registeredOpponents = new Map(plan.downstream.opponents.map((opponent) => [opponent.id, opponent]));
  for (const opponent of plan.downstream.opponents) {
    const deck = options.opponents.get(opponent.id);
    if (deck === undefined || botEvidenceSha256(deck) !== opponent.artifactSha256) {
      throw new Error(`downstream opponent ${opponent.id} differs from its preregistered artifact`);
    }
  }

  const started = Date.now();
  let downstreamDecisions = 0;
  const games: Array<{
    readonly gameId: string;
    readonly seed: string;
    readonly focalSeat: 0 | 1;
    readonly opponentId: string;
    readonly opponent: {
      readonly artifactSha256: string;
      readonly policy: typeof plan.downstream.opponentPolicy;
    };
    readonly result: 'win' | 'loss' | 'draw' | null;
    readonly evidence: BotEvidenceEpisode;
    readonly measurement: { readonly elapsedMs: number; readonly decisions: number };
  }> = [];
  let failure: {
    readonly status: Exclude<StageStrengthOutcomeEvidence['status'], 'completed'>;
    readonly error: string;
  } | null = null;

  for (const [index, game] of row.outcomeSchedule.entries()) {
    const opponent = options.opponents.get(game.opponentId);
    const registeredOpponent = registeredOpponents.get(game.opponentId);
    if (opponent === undefined || registeredOpponent === undefined) {
      throw new Error(`missing preregistered downstream opponent ${game.opponentId}`);
    }
    const opponentEvidence = {
      artifactSha256: registeredOpponent.artifactSha256,
      policy: plan.downstream.opponentPolicy,
    };
    const decks: readonly [DeckList, DeckList] =
      game.focalSeat === 0 ? [focalDeck, opponent] : [opponent, focalDeck];
    const agents = [
      createBot(
        game.focalSeat === 0 ? options.focalBot : options.opponentBot,
        agentSeed(game.seed, index, 0),
        0,
      ),
      createBot(
        game.focalSeat === 1 ? options.focalBot : options.opponentBot,
        agentSeed(game.seed, index, 1),
        1,
      ),
    ] as const;
    const gameStartedAt = Date.now();
    try {
      const outcome = playSimGame({
        index,
        seed: game.seed,
        decks,
        agents,
        startingPlayer: 0,
        ...(options.budget === undefined ? {} : { budget: options.budget }),
        evidence: {
          id: stageStrengthGameEpisodeId(plan.id, row.unitId, options.arm, game.gameId),
          runtime: plan.downstream.runtime,
          subject: evidence.episode.subject,
          features: plan.downstream.features,
          behavior: { ...plan.downstream.focalPolicy, config: botConfig(options.focalBot) },
          lineage: { gameId: game.gameId },
          splitGroup: { kind: 'game', id: game.gameId },
        },
      });
      if (outcome.evidence === undefined) throw new Error('native downstream game did not retain evidence');
      downstreamDecisions += outcome.decisions;
      games.push({
        ...game,
        opponent: opponentEvidence,
        result: outcome.winner === null ? 'draw' : outcome.winner === game.focalSeat ? 'win' : 'loss',
        evidence: outcome.evidence,
        measurement: { elapsedMs: Date.now() - gameStartedAt, decisions: outcome.decisions },
      });
    } catch (error: unknown) {
      const status = failedStatus(error);
      const message = error instanceof Error ? error.message : String(error);
      const failureEvidence: BotEvidenceEpisode =
        error instanceof NativeGameplayEvidenceError
          ? error.evidence
          : {
              schemaVersion: 1,
              episode: {
                id: stageStrengthGameEpisodeId(plan.id, row.unitId, options.arm, game.gameId),
                stage: 'gameplay',
                seed: game.seed,
                runtime: plan.downstream.runtime,
                subject: evidence.episode.subject,
                features: plan.downstream.features,
                behavior: { ...plan.downstream.focalPolicy, config: botConfig(options.focalBot) },
                lineage: { gameId: game.gameId },
                splitGroup: { kind: 'game', id: game.gameId },
              },
              decisions: [],
              outcome: { status, error: message },
            };
      downstreamDecisions += failureEvidence.decisions.length;
      games.push({
        ...game,
        opponent: opponentEvidence,
        result: null,
        evidence: failureEvidence,
        measurement: {
          elapsedMs: Date.now() - gameStartedAt,
          decisions: failureEvidence.decisions.length,
        },
      });
      failure = {
        status,
        error: message,
      };
      break;
    }
  }

  const outcomeEvidence: StageStrengthOutcomeEvidence =
    failure === null
      ? {
          version: 'stage-strength-game-outcome/v1',
          unitId: row.unitId,
          arm: options.arm,
          status: 'completed',
          sourceEpisodeSha256: botEvidenceSha256(evidence),
          games,
        }
      : {
          version: 'stage-strength-game-outcome/v1',
          unitId: row.unitId,
          arm: options.arm,
          status: failure.status,
          sourceEpisodeSha256: botEvidenceSha256(evidence),
          error: failure.error,
          games,
        };
  return {
    unitId: row.unitId,
    arm: options.arm,
    episode: evidence,
    outcomeEvidence,
    outcomeEvidenceSha256: botEvidenceSha256(outcomeEvidence),
    cost: {
      elapsedMs: options.buildElapsedMs + (Date.now() - started),
      decisions: evidence.decisions.length,
      downstreamDecisions,
      spentUsd: options.built.spend.spentUsd,
    },
  };
}
