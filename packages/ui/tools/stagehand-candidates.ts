/**
 * Turns an `observe()` result into one Jev `choice` question and hands back
 * the chosen candidate's own selector/method/arguments, unmodified. Jev picks
 * which candidate; it never re-describes what to do in English for a second
 * model to re-infer, which is the seam decision `docs/research/stagehand-jev-seam.md`
 * settles: Jev attaches downstream of `observe()`, not inside `act`/`observe`
 * via `ClientLLM`.
 */
import type { JevClient } from '../../draft-export/tools/jev-label/jev-client';

/** Structurally the shape of a Stagehand `Action` (`observe()`'s element type), named locally so this module carries no Stagehand import. */
export interface StagehandAction {
  readonly selector: string;
  readonly description: string;
  readonly method?: string;
  readonly arguments?: readonly string[];
}

export class NoCandidatesError extends Error {
  constructor(readonly instruction: string) {
    super(`observe(${JSON.stringify(instruction)}) returned zero candidates`);
    this.name = 'NoCandidatesError';
  }
}

export class UnmatchedJevAnswerError extends Error {
  constructor(
    readonly instruction: string,
    readonly answerId: string,
    readonly candidateIds: readonly string[],
  ) {
    super(
      `Jev answered ${JSON.stringify(answerId)} for ${JSON.stringify(instruction)}, which names no candidate among ${JSON.stringify(candidateIds)}`,
    );
    this.name = 'UnmatchedJevAnswerError';
  }
}

export interface CandidateChoice {
  readonly instruction: string;
  readonly candidates: readonly StagehandAction[];
  readonly chosen: StagehandAction;
  readonly chosenIndex: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

function candidateId(index: number): string {
  return `candidate-${String(index)}`;
}

const QUESTION_ID = 'candidate';

export async function chooseCandidate(
  jev: JevClient,
  state: Readonly<Record<string, unknown>>,
  instruction: string,
  candidates: readonly StagehandAction[],
): Promise<CandidateChoice> {
  if (candidates.length === 0) throw new NoCandidatesError(instruction);

  const criteria: Record<string, string> = {};
  candidates.forEach((candidate, index) => {
    criteria[candidateId(index)] = candidate.description;
  });

  const result = await jev.evaluate({
    state,
    questions: { [QUESTION_ID]: { type: 'choice', instructions: instruction, criteria } },
  });

  const answer = result.response.answers[QUESTION_ID];
  const chosenIndex = candidates.findIndex((_candidate, index) => candidateId(index) === answer?.choice);
  if (answer === undefined || chosenIndex === -1) {
    throw new UnmatchedJevAnswerError(
      instruction,
      answer?.choice ?? '<no answer>',
      candidates.map((_candidate, index) => candidateId(index)),
    );
  }

  return {
    instruction,
    candidates,
    chosen: candidates[chosenIndex] as StagehandAction,
    chosenIndex,
    probabilities: answer.probabilities ?? {},
  };
}
