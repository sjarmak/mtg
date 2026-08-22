import { describe, expect, it } from 'vitest';
import type { CompletionRequest, CompletionResult, LlmProvider } from '@mtg/llm';
import { unlimitedBudget, ZERO_USAGE } from '@mtg/llm';
import type { DeckEntry } from '../src/audit';
import { DeckCriteriaSchema } from '../src/criteria';
import { judgeBlind, type Verdict } from '../src/judge';

function judgeProvider(verdict: Verdict): LlmProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: 'fixture',
    model: 'scripted',
    budget: unlimitedBudget(),
    prompts,
    async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      prompts.push(request.prompt);
      return {
        value: verdict as T,
        raw: JSON.stringify(verdict),
        meta: {
          provider: 'fixture',
          model: 'scripted',
          attempts: 1,
          usage: ZERO_USAGE,
          costUsd: 0,
          costSource: 'estimated',
          durationMs: 0,
        },
      } satisfies CompletionResult<T>;
    },
  };
}

const CRITERIA = DeckCriteriaSchema.parse({
  prompt: 'aggressive red deck',
  format: 'modern',
  colors: ['R'],
  archetype: 'aggro',
});

const INFORMED: readonly DeckEntry[] = [{ name: 'Lightning Bolt', count: 4 }];
const BASELINE: readonly DeckEntry[] = [{ name: 'Shock', count: 4 }];

async function judgeWith(seed: string, verdict: Verdict) {
  const provider = judgeProvider(verdict);
  const result = await judgeBlind({
    provider,
    criteria: CRITERIA,
    informed: INFORMED,
    baseline: BASELINE,
    seed,
  });
  return { result, provider };
}

const WINS_A: Verdict = { winner: 'A', reason: 'better', scoreA: 8, scoreB: 4 };

describe('judgeBlind', () => {
  it('maps the winning side back to the builder that occupied it', async () => {
    for (const seed of ['one', 'two', 'three', 'four', 'five']) {
      const { result } = await judgeWith(seed, WINS_A);
      const expected = result.blinding.informed === 'A' ? 'informed' : 'baseline';
      expect(result.winner).toBe(expected);
    }
  });

  it('attributes each score to the right builder', async () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
      const { result } = await judgeWith(seed, WINS_A);
      if (result.blinding.informed === 'A') {
        expect(result.informedScore).toBe(8);
        expect(result.baselineScore).toBe(4);
      } else {
        expect(result.informedScore).toBe(4);
        expect(result.baselineScore).toBe(8);
      }
    }
  });

  it('puts each builder on a different side', async () => {
    const { result } = await judgeWith('seed', WINS_A);
    expect(result.blinding.informed).not.toBe(result.blinding.baseline);
  });

  it('actually varies which builder is shown first', async () => {
    const sides = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { result } = await judgeWith(seed, WINS_A);
      sides.add(result.blinding.informed);
    }
    // A shuffle that always returned the same order would silently reintroduce
    // the position bias the blinding exists to remove.
    expect(sides.size).toBe(2);
  });

  it('is reproducible for a given seed', async () => {
    const first = await judgeWith('fixed-seed', WINS_A);
    const second = await judgeWith('fixed-seed', WINS_A);
    expect(first.result.blinding).toEqual(second.result.blinding);
  });

  it('tells the judge nothing about where either deck came from', async () => {
    const { provider } = await judgeWith('seed', WINS_A);
    const prompt = provider.prompts[0] ?? '';
    for (const tell of ['informed', 'baseline', 'decklab', 'pipeline', 'generic', 'cites']) {
      expect(prompt.toLowerCase()).not.toContain(tell);
    }
  });

  it('passes a tie through without picking a winner', async () => {
    const { result } = await judgeWith('seed', {
      winner: 'tie',
      reason: 'even',
      scoreA: 5,
      scoreB: 5,
    });
    expect(result.winner).toBe('tie');
  });
});
