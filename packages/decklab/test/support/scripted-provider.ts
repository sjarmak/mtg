/**
 * A provider that replays scripted answers and records the prompts it saw.
 *
 * Scripting rather than fixture-recording keeps the repair loop testable: the
 * point is what happens when the model returns a card that fails verification,
 * and a recorded good answer can never exercise that path.
 *
 * Answers are replayed in order and the last one repeats, so a test scripts only
 * the rounds it cares about. A build that asks for a land count spends the first
 * answer on it, which is why every answer shape shares one script — the eval
 * runs both builders and the judge through one provider, so the script covers
 * all four.
 *
 * An `Error` in the script is thrown rather than returned. That is how a test
 * reaches the case where one builder fails and the run has to carry on with the
 * other, which is the shape of a live timeout.
 */
import type { BudgetGuard, CompletionRequest, CompletionResult, LlmProvider } from '@mtg/llm';
import { unlimitedBudget, ZERO_USAGE } from '@mtg/llm';
import type { BaselineDeck } from '../../src/baseline';
import type { Verdict } from '../../src/judge';
import type { LandPlanAnswer } from '../../src/land-plan';
import type { DeckProposal } from '../../src/select';

export type ScriptedAnswer = DeckProposal | LandPlanAnswer | BaselineDeck | Verdict | Error;

export interface ScriptedProvider extends LlmProvider {
  /** Every prompt the provider was given, in order. */
  readonly prompts: string[];
}

export interface ScriptedProviderOptions {
  /**
   * Dollars each answer costs, recorded into the provider's budget guard the way
   * a real provider records what a backend reported. Zero by default, which is
   * what a free test wants; a spend bound is only testable against a non-zero
   * one.
   */
  readonly costUsd?: number;
}

export function scriptedProvider(
  answers: readonly ScriptedAnswer[],
  options: ScriptedProviderOptions = {},
): ScriptedProvider {
  const prompts: string[] = [];
  const costUsd = options.costUsd ?? 0;
  const budget: BudgetGuard = unlimitedBudget();
  let call = 0;
  return {
    name: 'fixture',
    model: 'scripted',
    budget,
    prompts,
    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      prompts.push(request.prompt);
      budget.record({ costUsd, usage: ZERO_USAGE });
      const answer = answers[Math.min(call, answers.length - 1)];
      if (answer === undefined) {
        throw new Error('scriptedProvider was given no answers, so it has nothing to replay');
      }
      call += 1;
      if (answer instanceof Error) throw answer;
      return {
        value: answer as T,
        raw: JSON.stringify(answer),
        meta: {
          provider: 'fixture',
          model: 'scripted',
          attempts: 1,
          usage: ZERO_USAGE,
          costUsd,
          costSource: 'estimated',
          durationMs: 0,
        },
      } satisfies CompletionResult<T>;
    },
  };
}
