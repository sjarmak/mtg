/**
 * A decision, put to Jev as one `choice` question.
 *
 * The wording is the parent bead's probe wording (`docs/research/jev-bots.md`),
 * kept so the four probe rows and this study ask the same thing: the task in
 * the state, the pool so far, and one criterion line per card in the pack.
 * Option keys are card ids, so an answer maps back to a card without parsing a
 * name, and a pack never repeats an id.
 */
import type { Card } from '@mtg/dsl';
import { formatManaCost, renderOracleText, typeLineParts } from '@mtg/dsl';
import type { EvaluateRequest } from './jev-client';
import type { LabelDecision } from './decisions';

export const QUESTION_ID = 'pick';

const TASK =
  "Booster draft pick in a custom Magic set. Choose the single card that most improves the drafter's final deck.";
const INSTRUCTIONS = 'Which card should be taken from this pack?';

function typeLine(card: Card): string {
  const { supertypes, types, subtypes } = typeLineParts(card);
  const head = [...supertypes, ...types].join(' ');
  return subtypes.length === 0 ? head : `${head} - ${subtypes.join(' ')}`;
}

function cost(card: Card): string {
  return 'manaCost' in card ? formatManaCost(card.manaCost) : 'no cost';
}

/** The pool is context, not a menu, so a pool card is one short line. */
export function poolLine(card: Card): string {
  return `${card.name} ${cost(card)} [${typeLine(card)}]`;
}

/** A pack card is what the model is choosing between, so it carries its rules text. */
export function optionLine(card: Card): string {
  const colors = card.colors.join('') || 'none';
  return `${card.name} [${typeLine(card)}] ${cost(card)}, ${card.rarity}, colors ${colors}: ${renderOracleText(card)}`;
}

export function decisionRequest(decision: LabelDecision): EvaluateRequest {
  return {
    state: {
      task: TASK,
      pickNumber: decision.pickNumber,
      round: decision.round,
      poolSoFar: decision.pool.length === 0 ? 'empty' : decision.pool.map(poolLine),
    },
    questions: {
      [QUESTION_ID]: {
        type: 'choice',
        instructions: INSTRUCTIONS,
        criteria: Object.fromEntries(decision.pack.map((card) => [card.id, optionLine(card)])),
      },
    },
  };
}
