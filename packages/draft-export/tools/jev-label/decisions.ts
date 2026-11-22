/**
 * The pick decisions the labeling study puts to Jev.
 *
 * A decision is one bot pick seen from outside: the pack in front of a seat, the
 * pool that seat had already taken, and the card the bot took. They are read out
 * of `runDraft`'s own evidence rather than re-derived, because the evidence is
 * the record of exactly what a seat could see and the study must ask Jev about
 * the same view the bot had.
 *
 * Every pod is seeded from its index, so the study's decision list is a pure
 * function of (set, seed prefix, seat, pack floor) and two runs ask the same
 * questions in the same order. That is what lets the recorder skip a decision it
 * already holds an answer for.
 */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { BoosterRecipe } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DEFAULT_SEATS, runDraft } from '../../src/index';
import type { DraftEvidenceRequest } from '../../src/index';

export interface LabelDecision {
  /** `<pod seed>/<round>/<pick>`, unique across the study and stable across runs. */
  readonly key: string;
  readonly podSeed: string;
  /** 1-based pack round. */
  readonly round: number;
  /** 1-based pick within the round. */
  readonly pickNumber: number;
  /** The card the bot took: the baseline the labeler is compared against. */
  readonly botPickId: string;
  readonly pack: readonly Card[];
  readonly pool: readonly Card[];
}

export interface PodDecisionOptions {
  /** The seat whose picks are studied. Seat zero opens its own pack first. */
  readonly seat?: number;
  /** A pick from a pack this small tests little: one card is no decision at all. */
  readonly minPackSize?: number;
  /** The pack every seat opens; the set's own default recipe when absent. */
  readonly recipe?: BoosterRecipe;
}

export const DEFAULT_MIN_PACK_SIZE = 4;

const STUDY_DIGEST = botEvidenceSha256({ tool: 'jev-label', purpose: 'mtg-h76gz.2' });

/**
 * The provenance `runDraft` requires before it will record evidence. The
 * digests name this study, not a build: nothing here is compared against another
 * artifact's identity, the request only has to be well formed.
 */
function evidenceRequest(podSeed: string): DraftEvidenceRequest {
  const config = { policy: DEFAULT_NATIVE_DRAFT_BOT_POLICY };
  return {
    id: podSeed,
    runtime: { version: 'jev-label', buildSha256: STUDY_DIGEST },
    subject: { formatId: 'jev-label', formatSha256: STUDY_DIGEST, cardsSha256: STUDY_DIGEST },
    features: { schemaId: 'draft-observation-v1', schemaSha256: STUDY_DIGEST },
    behavior: {
      policyId: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
      config,
      configSha256: botEvidenceSha256(config),
      modelSha256: null,
      dataSha256: null,
    },
    lineage: { setId: 'jev-label', draftId: podSeed },
    splitGroup: { kind: 'draft', id: podSeed },
  };
}

interface ObservationJson {
  readonly seat: number;
  readonly round: number;
  readonly pickNumber: number;
  readonly pack: readonly { readonly id: string }[];
  readonly pool: readonly { readonly id: string }[];
}

function cardsById(cards: readonly Card[]): ReadonlyMap<string, Card> {
  return new Map(cards.map((card) => [card.id, card]));
}

function resolve(byId: ReadonlyMap<string, Card>, refs: readonly { readonly id: string }[]): readonly Card[] {
  return refs.map((ref) => {
    const card = byId.get(ref.id);
    if (card === undefined) throw new Error(`draft evidence names card ${ref.id}, which is not in the set`);
    return card;
  });
}

/** One seeded pod, and every pick the studied seat made from a pack worth labeling. */
export function podDecisions(
  cards: readonly Card[],
  podSeed: string,
  options: PodDecisionOptions = {},
): readonly LabelDecision[] {
  const seat = options.seat ?? 0;
  const minPackSize = options.minPackSize ?? DEFAULT_MIN_PACK_SIZE;
  if (!Number.isInteger(seat) || seat < 0 || seat >= DEFAULT_SEATS) {
    throw new Error(`seat must be an integer in 0-${String(DEFAULT_SEATS - 1)}, received ${String(seat)}`);
  }
  const result = runDraft(cards, {
    seed: podSeed,
    seats: DEFAULT_SEATS,
    botPolicy: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
    evidence: evidenceRequest(podSeed),
    ...(options.recipe === undefined ? {} : { recipe: options.recipe }),
  });
  const evidence = result.evidence;
  if (evidence === undefined) throw new Error(`pod ${podSeed} was asked for evidence and returned none`);

  const byId = cardsById(cards);
  return evidence.decisions.flatMap((decision) => {
    const observation = decision.observation.value as unknown as ObservationJson;
    if (observation.seat !== seat || observation.pack.length < minPackSize) return [];
    if (decision.choice.status !== 'chosen') {
      throw new Error(`pod ${podSeed} seat ${String(seat)} recorded an unchosen pick`);
    }
    return [
      {
        key: `${podSeed}/${String(observation.round)}/${String(observation.pickNumber)}`,
        podSeed,
        round: observation.round,
        pickNumber: observation.pickNumber,
        botPickId: decision.choice.candidateId,
        pack: resolve(byId, observation.pack),
        pool: resolve(byId, observation.pool),
      },
    ];
  });
}

export interface StudyDecisionOptions extends PodDecisionOptions {
  /** Pods are seeded `<prefix>/pod/<index>`. */
  readonly seedPrefix: string;
  /** How many decisions the study wants; pods are drafted until it has them. */
  readonly count: number;
}

/** The first `count` decisions over consecutively seeded pods. */
export function studyDecisions(
  cards: readonly Card[],
  options: StudyDecisionOptions,
): readonly LabelDecision[] {
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new Error(`count must be a positive integer, received ${String(options.count)}`);
  }
  const decisions: LabelDecision[] = [];
  for (let pod = 0; decisions.length < options.count; pod += 1) {
    const podSeed = `${options.seedPrefix}/pod/${String(pod)}`;
    const fromPod = podDecisions(cards, podSeed, options);
    if (fromPod.length === 0) throw new Error(`pod ${podSeed} has no pick from a pack worth labeling`);
    decisions.push(...fromPod);
  }
  return decisions.slice(0, options.count);
}
