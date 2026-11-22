import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { z } from 'zod';
import { LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import { buildCalibrationDeck, CALIBRATION_BUILDER_VERSION } from './deck';
import { calibrationSeed, CALIBRATION_VERSION, DRAFT_BOT_VERSION, draftCalibrationPool } from './draft';
import type { CalibrationSplit, DraftPolicy } from './draft';
import { competenceForDeck } from './competence';
import type { BotCompetenceEvidence } from './competence';
import { scheduleCalibrationGames, summarizeCalibrationGames } from './results';
import type { CalibrationGameResult, ScheduledCalibrationGame } from './results';

export interface LegacyCubeCampaignOptions {
  readonly seed: string;
  readonly split: CalibrationSplit;
  readonly pods: number;
  readonly gamesPerOrder: number;
  readonly opponents: number;
  readonly policies: readonly DraftPolicy[];
  readonly opponentPolicies?: readonly DraftPolicy[];
}
const OptionsSchema = z
  .object({
    seed: z.string().trim().min(1).max(256),
    split: z.enum(['tuning', 'holdout']),
    pods: z.number().int().min(1).max(100),
    gamesPerOrder: z.number().int().min(1).max(100),
    opponents: z.number().int().min(1).max(7),
    policies: z
      .array(z.string().min(1))
      .min(1)
      .max(21)
      .refine((v) => new Set(v).size === v.length, 'Duplicate policy'),
    opponentPolicies: z
      .array(z.string().min(1))
      .min(1)
      .max(7)
      .refine((value) => new Set(value).size === value.length, 'Duplicate opponent policy')
      .optional(),
  })
  .refine(
    (options) =>
      options.opponentPolicies === undefined || options.opponentPolicies.length === options.opponents,
    'Opponent policy count must equal opponents',
  )
  .refine(
    (o) => o.pods * o.gamesPerOrder * o.opponents * o.policies.length * 2 <= 10_000,
    'Campaign exceeds 10000 games',
  );

export function planLegacyCubeCampaign(catalog: PrintedCardCatalog, options: LegacyCubeCampaignOptions) {
  OptionsSchema.parse(options);
  const opponentPolicies = options.opponentPolicies?.map(parseDraftPolicy);
  if (
    createHash('sha256').update(serializedPrintedCardCatalogContent(catalog)).digest('hex') !==
    catalog.contentSha256
  ) {
    throw new Error('Catalog content hash does not match its cards');
  }
  const pods = Array.from({ length: options.pods }, (_, pod) => {
    const seed = calibrationSeed(options.seed, options.split, 'draft', pod);
    const baseline = draftCalibrationPool(catalog, seed, 'power');
    // Build opponents independently so a candidate's altered passes cannot change its opposition.
    const opponents = (
      opponentPolicies === undefined
        ? baseline.opponentPools.slice(0, options.opponents).map((opponent) => ({
            policy: `power:${opponent.seatId}`,
            deck: buildCalibrationDeck(opponent.pool, `opponent-${String(pod)}-${opponent.seatId}`),
          }))
        : opponentPolicies.map((policy, opponentIndex) => {
            const draft = draftCalibrationPool(
              catalog,
              calibrationSeed(
                `${options.seed}/opponent/${policy}`,
                options.split,
                'draft',
                pod * options.opponents + opponentIndex,
              ),
              policy,
            );
            return {
              policy,
              deck: buildCalibrationDeck(
                draft.pool,
                `opponent-${String(pod)}-${String(opponentIndex)}-${policy}`,
              ),
            };
          })
    ).map(({ policy, deck }) => ({ ...deck, policy, artifactSha256: botEvidenceSha256(deck.ref) }));
    if (
      opponentPolicies !== undefined &&
      new Set(opponents.map((opponent) => opponent.artifactSha256)).size !== opponents.length
    ) {
      throw new Error(`Opponent strategies produced duplicate decks in pod ${String(pod)}`);
    }
    const candidates = options.policies.map((policy) => {
      const draft = policy === 'power' ? baseline : draftCalibrationPool(catalog, seed, policy);
      return { policy, draft, deck: buildCalibrationDeck(draft.pool, `${policy}-${String(pod)}`) };
    });
    return {
      pod,
      seed,
      candidates,
      opponents,
      games: scheduleCalibrationGames(
        options.seed,
        options.split,
        pod,
        candidates,
        opponents,
        options.gamesPerOrder,
      ),
    };
  });
  const model = LEGACY_CUBE_ADVISOR_MODEL;
  return {
    version: CALIBRATION_VERSION,
    options,
    provenance: {
      catalog: catalog.contentSha256,
      model: createHash('sha256')
        .update(JSON.stringify([model.archetypes, model.profiles, model.packages]))
        .digest('hex'),
      builder: CALIBRATION_BUILDER_VERSION,
      draftBots: DRAFT_BOT_VERSION,
    },
    pods,
    games: pods.flatMap((p) => p.games),
  };
}
export type LegacyCubeCampaignPlan = ReturnType<typeof planLegacyCubeCampaign>;

export interface CalibrationGameplay {
  readonly bot: string;
  /** Trusted, freshly produced probe results; never deserialize unchecked user assertions here. */
  readonly evidence: readonly BotCompetenceEvidence[];
  readonly play: (game: ScheduledCalibrationGame) => Promise<{
    readonly status: 'completed' | 'incomplete';
    readonly winner: 0 | 1 | null;
    readonly artifact: string;
  }>;
}

export async function executeLegacyCubeCampaign(plan: LegacyCubeCampaignPlan, gameplay: CalibrationGameplay) {
  const expectedGames =
    plan.options.pods *
    plan.options.gamesPerOrder *
    plan.options.opponents *
    plan.options.policies.length *
    2;
  if (plan.games.length !== expectedGames || new Set(plan.games.map((g) => g.id)).size !== expectedGames) {
    throw new Error('Incomplete or duplicated calibration schedule');
  }
  for (const game of plan.games) {
    const policies = plan.games
      .filter(
        (other) =>
          other.pod === game.pod && other.seed === game.seed && other.candidateSeat === game.candidateSeat,
      )
      .map((other) => other.policy);
    if (
      policies.length !== plan.options.policies.length ||
      new Set(policies).size !== policies.length ||
      !policies.every((p) => plan.options.policies.includes(p))
    )
      throw new Error('Unmatched calibration schedule');
  }
  const games: (CalibrationGameResult & {
    readonly seed: string;
    readonly candidateSeat: 0 | 1;
    readonly artifact: string;
    readonly missingCompetence: readonly string[];
  })[] = [];
  for (const game of plan.games) {
    const competence = game.decks.map((deck) =>
      competenceForDeck(deck.selected, gameplay.evidence, gameplay.bot),
    );
    const result = await gameplay.play(game);
    if (
      ![0, 1, null].includes(result.winner) ||
      !['completed', 'incomplete'].includes(result.status) ||
      !result.artifact.trim()
    ) {
      throw new Error(`Malformed bot result for ${game.id}`);
    }
    const outcome =
      result.status === 'incomplete'
        ? ('incomplete' as const)
        : result.winner === null
          ? ('draw' as const)
          : result.winner === game.candidateSeat
            ? ('win' as const)
            : ('loss' as const);
    games.push({
      id: game.id,
      pod: game.pod,
      policy: game.policy,
      seed: game.seed,
      candidateSeat: game.candidateSeat,
      eligible: competence.every((c) => c.eligible),
      outcome,
      artifact: result.artifact,
      missingCompetence: [...new Set(competence.flatMap((c) => c.missing))],
    });
  }
  // All arms must have the same complete, eligible matched cohort. No survivor bias.
  const matched = games.map((game) => {
    const cohort = games.filter(
      (other) =>
        other.pod === game.pod && other.seed === game.seed && other.candidateSeat === game.candidateSeat,
    );
    return {
      ...game,
      eligible:
        game.eligible &&
        cohort.length === plan.options.policies.length &&
        cohort.every((other) => other.eligible && other.outcome !== 'incomplete'),
    };
  });
  return {
    ...plan,
    bot: gameplay.bot,
    competence: gameplay.evidence,
    games: matched,
    summary: summarizeCalibrationGames(matched),
    limitations: [
      'Diagnostic bot benchmark, not calibrated human card strength. No automatic weight updates.',
      'Competence probes establish only their tested situations, not every use of every card.',
      'Common two-color curve builder may underbuild combo, ramp, and multicolor pools.',
      'Power arm is the existing printed-cube curve heuristic, not an expert power ranking.',
      'Seat swaps control seating, not necessarily who Forge chooses to play first.',
    ],
  };
}

export function parseLegacyCubeCalibrationArgs(args: readonly string[]) {
  const { values } = parseArgs({
    args: [...args],
    options: {
      out: { type: 'string' },
      seed: { type: 'string' },
      split: { type: 'string' },
      pods: { type: 'string', default: '1' },
      opponents: { type: 'string', default: '1' },
      'games-per-order': { type: 'string', default: '1' },
      policies: { type: 'string', default: 'power,current,flexible' },
      'opponent-policies': { type: 'string' },
      'plan-only': { type: 'boolean', default: false },
      'forge-home': { type: 'string' },
      'timeout-ms': { type: 'string', default: '120000' },
    },
    strict: true,
    allowPositionals: false,
  });
  const parsed = OptionsSchema.parse({
    seed: values.seed,
    split: values.split,
    pods: Number(values.pods),
    opponents: Number(values.opponents),
    gamesPerOrder: Number(values['games-per-order']),
    policies: values.policies.split(','),
    ...(values['opponent-policies'] === undefined
      ? {}
      : { opponentPolicies: values['opponent-policies'].split(',') }),
  });
  const out = z.string().trim().min(1).parse(values.out);
  const timeoutMs = z.number().int().min(1000).max(600000).parse(Number(values['timeout-ms']));
  const policies = parsed.policies.map(parseDraftPolicy);
  const opponentPolicies = parsed.opponentPolicies?.map(parseDraftPolicy);
  return {
    seed: parsed.seed,
    split: parsed.split,
    pods: parsed.pods,
    opponents: parsed.opponents,
    gamesPerOrder: parsed.gamesPerOrder,
    policies,
    ...(opponentPolicies === undefined ? {} : { opponentPolicies }),
    out,
    timeoutMs,
    planOnly: values['plan-only'],
    forgeHome: values['forge-home'],
  };
}

function parseDraftPolicy(policy: string): DraftPolicy {
  if (
    ['power', 'current', 'flexible', 'pivot'].includes(policy) ||
    LEGACY_CUBE_ADVISOR_MODEL.archetypes.some((archetype) => `pin:${archetype.id}` === policy)
  ) {
    return policy as DraftPolicy;
  }
  throw new Error(`Unknown policy ${policy}`);
}
