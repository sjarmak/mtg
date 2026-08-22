/**
 * The critic's prompt: one card, its design intent, and the rubric it is
 * judged against. One call per entry rather than a batch, because a
 * faithfulness judgment is about one card's relationship to one slot's intent,
 * and batching would let the model's judgment of one card lean on another's —
 * exactly the kind of context the design-critique pass wants and this pass
 * does not.
 */
import { renderOracleText } from '@mtg/dsl';
import type { SetBrief } from '../brief';
import type { RevisionRecord } from '../report';
import type { Entry } from '../validate/index';
import { describeIntent } from './intent';
import { CRITERION_RUBRIC } from './rubric';
import type { FaithfulnessCriterion } from './rubric';

export const CRITIC_SYSTEM =
  'You are a faithfulness auditor for a Magic: the Gathering set generator. You are shown one printed ' +
  "card and the design intent its slot was written against: the slot's structural constraints, the brief " +
  'mechanic(s) it supports, and (where they exist) a required-card direction and a kept critique revision. ' +
  "Every structural fact — the card's mana value, color, keywords, effect kinds and ability kinds against " +
  "its slot's window — has already been checked by a separate, deterministic validator and is not your " +
  "concern; assume it passed. Your job is narrower and harder: does the card's actual, played-out behavior " +
  'mean what the design intent asked for, in prose a validator cannot check? Judge only the criteria you are ' +
  'given, each exactly once, and say nothing about whether the card is well designed, balanced or fun — a ' +
  'separate pass already judges that. A card can be faithful and mediocre, or unfaithful and elegant; you ' +
  'are asked about the first axis only.';

export interface CriticPromptInput {
  readonly entry: Entry;
  readonly brief: SetBrief;
  readonly criteria: readonly FaithfulnessCriterion[];
  readonly revisions?: readonly RevisionRecord[];
}

export function buildCriticPrompt(input: CriticPromptInput): string {
  const intent = describeIntent(input.entry, input.brief, input.revisions ?? []);
  const oracle = renderOracleText(input.entry.card);
  const criteriaBlock = input.criteria
    .map((criterion) => `- ${criterion}: ${CRITERION_RUBRIC[criterion]}`)
    .join('\n');

  return [
    `Design intent for slot ${input.entry.slot.id}:`,
    intent,
    '',
    `Printed card "${input.entry.card.name}":`,
    oracle,
    '',
    'Judge exactly these criteria, each once, plus one overall verdict summarizing them:',
    criteriaBlock,
  ].join('\n');
}
