/** Exact executable inputs for the cross-format native gameplay campaign. */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { buildDeckForPair, COLOR_PAIRS, colorPairKey, type ColorPair } from '@mtg/deckbuild';
import { parseCards, type Card } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import {
  nativeBotPolicyIdentity,
  nativeGameplayFeatureIdentity,
  type BotStrengthCampaignPlan,
  type NativeBotStrengthOpponent,
} from '@mtg/metrics';
import {
  createLearnedModel,
  FIXTURE_DECK_GW,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  greedySpec,
  learnedSpec,
  searchSpec,
  type BotSpec,
  type LearnedModelArtifact,
} from '@mtg/sim';
import { z } from 'zod';
import { buildNativeGameplayPlan, type NativeGameplayMatchup } from './native-gameplay-plan';

const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/u, 'runtime requires a full Git commit');
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const REPLICAS_PER_MATCHUP = 11;
const TrainingReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceSha256: DigestSchema,
  modelSha256: DigestSchema,
});
const SetDocumentSchema = z.object({ cards: z.array(z.unknown()).min(1) });

export interface NativeGameplayCampaignInputs {
  readonly id: string;
  readonly split: 'tuning' | 'holdout';
  readonly runtime: BotStrengthCampaignPlan['runtime'];
  readonly model: LearnedModelArtifact;
  readonly receipt: unknown;
  readonly tideglassDocument: unknown;
  readonly hiddenKingdomDocument: unknown;
}

export interface PreparedNativeGameplayCampaign {
  readonly plan: BotStrengthCampaignPlan;
  readonly policies: Readonly<{ baseline: BotSpec; candidate: BotSpec }>;
  readonly decks: ReadonlyMap<string, DeckList>;
  readonly opponents: ReadonlyMap<string, NativeBotStrengthOpponent>;
}

interface CampaignBuilder {
  readonly decks: Map<string, DeckList>;
  readonly opponents: Map<string, NativeBotStrengthOpponent>;
  readonly opponentIdentities: Array<BotStrengthCampaignPlan['opponents'][number]>;
  readonly matchups: NativeGameplayMatchup[];
}

export function nativeGameplayRuntimeIdentity(commit: string): BotStrengthCampaignPlan['runtime'] {
  const parsed = GitCommitSchema.parse(commit);
  return {
    version: `native-kernel@${parsed}`,
    buildSha256: botEvidenceSha256({ gitCommit: parsed }),
  };
}

function cardsOf(document: unknown): readonly Card[] {
  return parseCards(SetDocumentSchema.parse(document).cards);
}

function pair(key: string): ColorPair {
  const found = COLOR_PAIRS.find((candidate) => colorPairKey(candidate) === key);
  if (found === undefined) throw new Error(`unknown native campaign color pair ${key}`);
  return found;
}

function builtDeck(cards: readonly Card[], formatId: string, pairKey: string): DeckList {
  const result = buildDeckForPair(cards, pair(pairKey));
  return { name: `${formatId}/${pairKey}`, cards: result.deck };
}

function addMatchup(
  builder: CampaignBuilder,
  formatId: string,
  focalDeck: DeckList,
  opponentDeck: DeckList,
  opponentSpec: BotSpec,
  opponentId: string,
): void {
  const focalDeckSha256 = botEvidenceSha256(focalDeck);
  const opponentDeckSha256 = botEvidenceSha256(opponentDeck);
  builder.decks.set(focalDeckSha256, focalDeck);
  builder.opponents.set(opponentId, { spec: opponentSpec, deck: opponentDeck });
  builder.opponentIdentities.push({
    id: opponentId,
    ...nativeBotPolicyIdentity(opponentSpec),
    deckSha256: opponentDeckSha256,
  });
  builder.matchups.push({ formatId, focalDeckSha256, opponentId });
}

function addGeneratedFormatMatchups(
  builder: CampaignBuilder,
  formatId: string,
  cards: readonly Card[],
  greedy: BotSpec,
  search: BotSpec,
): void {
  addMatchup(
    builder,
    formatId,
    builtDeck(cards, formatId, 'WU'),
    builtDeck(cards, formatId, 'UB'),
    greedy,
    `${formatId}/UB/greedy`,
  );
  addMatchup(
    builder,
    formatId,
    builtDeck(cards, formatId, 'BR'),
    builtDeck(cards, formatId, 'WG'),
    search,
    `${formatId}/WG/search`,
  );
}

/** Assemble the preregistered population without playing or writing any game. */
export function prepareNativeGameplayCampaign(
  inputs: NativeGameplayCampaignInputs,
): PreparedNativeGameplayCampaign {
  createLearnedModel(inputs.model);
  const receipt = TrainingReceiptSchema.parse(inputs.receipt);
  if (receipt.modelSha256 !== inputs.model.sha256) {
    throw new Error('training receipt does not belong to the supplied model');
  }
  const tideglassCards = cardsOf(inputs.tideglassDocument);
  const hiddenKingdomCards = cardsOf(inputs.hiddenKingdomDocument);
  const baseline = greedySpec('native-campaign-baseline');
  const candidate = learnedSpec('native-campaign-candidate', inputs.model, receipt.evidenceSha256);
  const greedy = greedySpec('native-campaign-frozen-greedy');
  const search = searchSpec('native-campaign-frozen-search');
  const builder: CampaignBuilder = {
    decks: new Map(),
    opponents: new Map(),
    opponentIdentities: [],
    matchups: [],
  };

  addGeneratedFormatMatchups(builder, 'tideglass-reach', tideglassCards, greedy, search);
  addGeneratedFormatMatchups(builder, 'flagship-set-253', hiddenKingdomCards, greedy, search);
  addMatchup(builder, 'sim-fixtures', FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedy, 'sim-fixtures/UB/greedy');
  addMatchup(builder, 'sim-fixtures', FIXTURE_DECK_GW, FIXTURE_DECK_RW, search, 'sim-fixtures/RW/search');

  const fixtureCards = [FIXTURE_DECK_RW, FIXTURE_DECK_UB, FIXTURE_DECK_GW].flatMap(({ cards }) => cards);
  const features = nativeGameplayFeatureIdentity();
  const plan = buildNativeGameplayPlan({
    id: inputs.id,
    split: inputs.split,
    runtime: inputs.runtime,
    features: { baseline: features, candidate: features },
    policies: {
      baseline: nativeBotPolicyIdentity(baseline),
      candidate: nativeBotPolicyIdentity(candidate),
    },
    formats: [
      {
        id: 'tideglass-reach',
        formatSha256: botEvidenceSha256(inputs.tideglassDocument),
        cardsSha256: botEvidenceSha256(tideglassCards),
      },
      {
        id: 'flagship-set-253',
        formatSha256: botEvidenceSha256(inputs.hiddenKingdomDocument),
        cardsSha256: botEvidenceSha256(hiddenKingdomCards),
      },
      {
        id: 'sim-fixtures',
        formatSha256: botEvidenceSha256([FIXTURE_DECK_RW, FIXTURE_DECK_UB, FIXTURE_DECK_GW]),
        cardsSha256: botEvidenceSha256(fixtureCards),
      },
    ],
    opponents: builder.opponentIdentities,
    matchups: builder.matchups,
    replicasPerMatchup: REPLICAS_PER_MATCHUP,
  });
  return {
    plan,
    policies: { baseline, candidate },
    decks: builder.decks,
    opponents: builder.opponents,
  };
}
