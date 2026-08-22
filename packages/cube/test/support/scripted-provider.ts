/**
 * A provider that replays scripted answers and records the prompts it saw.
 *
 * Scripting rather than replaying a recording keeps the repair loop testable:
 * what matters is what happens when the model names a card that fails the gate,
 * and a recorded good answer can never exercise that path.
 *
 * Answers replay in order and the last one repeats, so a test scripts only the
 * rounds it cares about.
 */
import type { BudgetGuard, CompletionRequest, CompletionResult, LlmProvider } from '@mtg/llm';
import { unlimitedBudget, ZERO_USAGE } from '@mtg/llm';
import type { CubeProposal } from '../../src/propose';

export interface ScriptedProvider extends LlmProvider {
  /** Every prompt the provider was given, in order. */
  readonly prompts: string[];
  /** The standing instructions that came with each of them. */
  readonly systems: string[];
}

export interface ScriptedProviderOptions {
  /**
   * Dollars each answer costs, recorded into the provider's budget guard the
   * way a real provider records what a backend reported. Zero by default, which
   * is what a free test wants; a spend bound is only testable against a
   * non-zero one.
   */
  readonly costUsd?: number;
}

export function scriptedProvider(
  answers: readonly CubeProposal[],
  options: ScriptedProviderOptions = {},
): ScriptedProvider {
  const prompts: string[] = [];
  const systems: string[] = [];
  const costUsd = options.costUsd ?? 0;
  const budget: BudgetGuard = unlimitedBudget();
  let call = 0;
  return {
    name: 'fixture',
    model: 'scripted',
    budget,
    prompts,
    systems,
    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      prompts.push(request.prompt);
      systems.push(request.system ?? '');
      budget.record({ costUsd, usage: ZERO_USAGE });
      const answer = answers[Math.min(call, answers.length - 1)];
      if (answer === undefined) {
        throw new Error('scriptedProvider was given no answers, so it has nothing to replay');
      }
      call += 1;
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
