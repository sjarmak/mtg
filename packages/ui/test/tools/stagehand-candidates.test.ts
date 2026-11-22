/**
 * `chooseCandidate` turns `observe()`'s candidates into one Jev `choice`
 * question and hands back the chosen candidate's own selector unmodified.
 * Jev picks; nothing here re-infers a selector from English. A fake `JevClient`
 * stands in for the gateway, so this is no-network.
 */
import { describe, expect, it } from 'vitest';
import type {
  JevClient,
  EvaluateRequest,
  EvaluateResult,
} from '../../../draft-export/tools/jev-label/jev-client';
import {
  chooseCandidate,
  NoCandidatesError,
  UnmatchedJevAnswerError,
} from '../../tools/stagehand-candidates';
import type { StagehandAction } from '../../tools/stagehand-candidates';

function fakeJev(
  answer: (request: EvaluateRequest) => EvaluateResult['response']['answers'][string] | undefined,
): JevClient {
  return {
    async evaluate(request) {
      const questionId = Object.keys(request.questions)[0] as string;
      const chosen = answer(request);
      return {
        response: { answers: chosen === undefined ? {} : { [questionId]: chosen } },
        raw: null,
        latencyMs: 0,
      };
    },
  };
}

const CANDIDATES: readonly StagehandAction[] = [
  { selector: 'xpath=//button[1]', description: 'Show the front face' },
  { selector: 'xpath=//button[2]', description: 'Show the back face', method: 'click', arguments: [] },
];

describe('chooseCandidate', () => {
  it('maps the Jev-chosen option to the candidate it named, executed by its own selector', async () => {
    const jev = fakeJev(() => ({
      type: 'choice',
      choice: 'candidate-1',
      probabilities: { 'candidate-1': 0.91 },
    }));
    const choice = await chooseCandidate(jev, { step: 'face-toggle' }, 'flip the card', CANDIDATES);
    expect(choice.chosen).toEqual(CANDIDATES[1]);
    expect(choice.chosenIndex).toBe(1);
    expect(choice.probabilities).toEqual({ 'candidate-1': 0.91 });
  });

  it('fails with zero candidates rather than falling back to anything else', async () => {
    const jev = fakeJev(() => {
      throw new Error('must not be called with zero candidates');
    });
    await expect(chooseCandidate(jev, {}, 'flip the card', [])).rejects.toBeInstanceOf(NoCandidatesError);
  });

  it('fails when Jev answers with an id that names no candidate', async () => {
    const jev = fakeJev(() => ({ type: 'choice', choice: 'candidate-99' }));
    await expect(chooseCandidate(jev, {}, 'flip the card', CANDIDATES)).rejects.toBeInstanceOf(
      UnmatchedJevAnswerError,
    );
  });

  it('fails when Jev answers the wrong question id (no answer for the one asked)', async () => {
    const jev = fakeJev(() => undefined);
    await expect(chooseCandidate(jev, {}, 'flip the card', CANDIDATES)).rejects.toBeInstanceOf(
      UnmatchedJevAnswerError,
    );
  });

  it('sends one criterion per candidate, keyed by position, never English re-description back to Jev', async () => {
    let seenCriteria: Readonly<Record<string, string>> = {};
    const jev = fakeJev((request) => {
      const question = Object.values(request.questions)[0];
      seenCriteria = question?.criteria ?? {};
      return { type: 'choice', choice: 'candidate-0' };
    });
    await chooseCandidate(jev, {}, 'flip the card', CANDIDATES);
    expect(seenCriteria).toEqual({
      'candidate-0': 'Show the front face',
      'candidate-1': 'Show the back face',
    });
  });
});
