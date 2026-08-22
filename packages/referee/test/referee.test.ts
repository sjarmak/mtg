/**
 * What the referee does with an answer, and what it does when the answer is
 * unusable.
 *
 * Two failure classes are handled differently on purpose. A model that answers
 * badly (out of range, off-schema, transport died) is a thing the deterministic
 * agent covers, so the game continues and the rejection is recorded. A budget
 * ceiling is a policy stop the run asked for, so it is raised, never absorbed:
 * spending is refused loudly or the ceiling means nothing.
 *
 * The ceiling lives on the provider, because that is where the attempts are.
 * The expensive failure is the model that answers off schema until the retries
 * run out — three paid calls and no `CompletionMeta` — so a ruling is only
 * metered honestly if that ruling's cost is the guard's own delta.
 */
import { describe, expect, it } from 'vitest';
import { createBudgetGuard, LlmBudgetExceededError, LlmTransportError } from '@mtg/llm';
import { simpleAgent, validateAction } from '@mtg/kernel';
import { createReferee } from '@mtg/referee';
import { blockingView } from './positions';
import { offSchemaProvider, steppingClock, stubProvider } from './stub-provider';

const fallback = simpleAgent('fallback');

describe('a referee handed a usable ruling', () => {
  it('applies the option the model indexed and records why', async () => {
    const view = blockingView();
    const provider = stubProvider({
      answers: [{ value: { optionIndex: 1, rationale: 'Trade the guardian for the golem.' } }],
    });
    const referee = createReferee({ provider, fallback });

    const outcome = await referee.rule(view);

    expect(outcome.action).toBe(view.decision.options[1]);
    expect(validateAction(view.state, outcome.action)).toBeNull();
    expect(outcome.record.source).toBe('model');
    expect(outcome.record.chosenIndex).toBe(1);
    expect(outcome.record.rationale).toBe('Trade the guardian for the golem.');
    expect(outcome.record.rejection).toBeNull();
  });

  it('meters the ruling: cost, latency, provider, model, attempts', async () => {
    const view = blockingView();
    const budget = createBudgetGuard({ maxUsd: 1 });
    const provider = stubProvider({
      answers: [{ value: { optionIndex: 0, rationale: 'No blocks.' } }],
      costUsd: 0.0042,
      budget,
    });
    const referee = createReferee({ provider, fallback, now: steppingClock(7) });

    const { record } = await referee.rule(view);

    expect(record.costUsd).toBe(0.0042);
    expect(record.costSource).toBe('estimated');
    expect(record.latencyMs).toBe(7);
    expect(record.provider).toBe('fixture');
    expect(record.model).toBe('stub-referee-model');
    expect(record.attempts).toBe(1);
    expect(referee.records()).toHaveLength(1);
    // The record and the ceiling are two views of one call, not two calls: the
    // referee reports what the provider billed and never bills it a second time.
    expect(budget.snapshot().spentUsd).toBeCloseTo(record.costUsd, 10);
    expect(budget.snapshot().calls).toBe(1);
  });

  it('frames the request from the view it was given', async () => {
    const view = blockingView();
    const provider = stubProvider({ answers: [{ value: { optionIndex: 0, rationale: 'No blocks.' } }] });
    const referee = createReferee({ provider, fallback });

    await referee.rule(view);

    const request = provider.requests[0];
    expect(request).toBeDefined();
    expect(request?.prompt).toContain('0:');
    expect(request?.system).toBe(referee.system);
  });
});

describe('a referee handed an unusable ruling', () => {
  it('falls back to the deterministic agent when the index is out of range', async () => {
    const view = blockingView();
    const past = view.decision.options.length + 5;
    const provider = stubProvider({ answers: [{ value: { optionIndex: past, rationale: 'off the end' } }] });
    const referee = createReferee({ provider, fallback });

    const outcome = await referee.rule(view);

    expect(outcome.record.source).toBe('fallback');
    expect(outcome.record.chosenIndex).toBeNull();
    expect(outcome.record.rejection).toContain(String(past));
    expect(outcome.action).toEqual(fallback.decide(view));
    expect(validateAction(view.state, outcome.action)).toBeNull();
    // The call itself was fine, so its own figures are the ones to report.
    expect(outcome.record.costSource).toBe('estimated');
    expect(outcome.record.attempts).toBe(1);
  });

  it('falls back when the answer does not satisfy the ruling schema', async () => {
    const view = blockingView();
    const provider = stubProvider({ answers: [{ value: { optionIndex: 'the second one' } }] });
    const referee = createReferee({ provider, fallback });

    const outcome = await referee.rule(view);

    expect(outcome.record.source).toBe('fallback');
    expect(outcome.record.rejection).toContain('schema');
    expect(outcome.action).toEqual(fallback.decide(view));
  });

  it('falls back when the transport dies', async () => {
    const view = blockingView();
    const provider = stubProvider({
      answers: [{ error: new LlmTransportError('claude-cli', 'exited with 1', { exitCode: 1 }) }],
    });
    const referee = createReferee({ provider, fallback });

    const outcome = await referee.rule(view);

    expect(outcome.record.source).toBe('fallback');
    expect(outcome.record.rejection).toContain('exited with 1');
    // A call that never answered was never billed, so zero is the true figure
    // and `unknown` is the true source. Nothing was attempted to completion.
    expect(outcome.record.costUsd).toBe(0);
    expect(outcome.record.costSource).toBe('unknown');
    expect(outcome.record.attempts).toBe(0);
  });

  it('never swallows a failure that is not the model failing', async () => {
    const view = blockingView();
    const provider = stubProvider({ answers: [{ error: new TypeError('bug in the caller') }] });
    const referee = createReferee({ provider, fallback });

    await expect(referee.rule(view)).rejects.toThrow('bug in the caller');
  });
});

describe('the budget ceiling', () => {
  it('refuses the call that would cross it', async () => {
    const view = blockingView();
    const provider = stubProvider({
      answers: [
        { value: { optionIndex: 0, rationale: 'first' } },
        { value: { optionIndex: 0, rationale: 'second' } },
      ],
      budget: createBudgetGuard({ maxCalls: 1 }),
    });
    const referee = createReferee({ provider, fallback });

    await referee.rule(view);
    await expect(referee.rule(view)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    // The provider refused before taking the request, and the referee let that
    // through rather than treating it as a model that answered badly: a ceiling
    // absorbed into a fallback record is a ceiling that bought nothing.
    expect(provider.requests).toHaveLength(1);
    expect(referee.records()).toHaveLength(1);
  });

  it('accumulates spend across rulings', async () => {
    const view = blockingView();
    const budget = createBudgetGuard({ maxUsd: 0.015 });
    const provider = stubProvider({
      answers: [
        { value: { optionIndex: 0, rationale: 'first' } },
        { value: { optionIndex: 0, rationale: 'second' } },
        { value: { optionIndex: 0, rationale: 'third' } },
      ],
      costUsd: 0.01,
      budget,
    });
    const referee = createReferee({ provider, fallback });

    await referee.rule(view);
    expect(budget.snapshot().spentUsd).toBeCloseTo(0.01, 10);
    await referee.rule(view);
    expect(budget.snapshot().spentUsd).toBeCloseTo(0.02, 10);
    await expect(referee.rule(view)).rejects.toBeInstanceOf(LlmBudgetExceededError);
  });

  it('charges a ruling for the attempts it burned answering off schema', async () => {
    // The failure the fallback exists for is a model that keeps answering, and
    // it is the one that spends: three billed attempts, one raised error, no
    // meta. A ruling that reported that as free would let a broken model run
    // through any ceiling with the guard still reading zero.
    const view = blockingView();
    const budget = createBudgetGuard({ maxUsd: 0.05 });
    const provider = offSchemaProvider({ budget, costUsd: 0.01 });
    const referee = createReferee({ provider, fallback });

    const { record } = await referee.rule(view);

    expect(record.source).toBe('fallback');
    expect(record.rejection).toContain('schema validation');
    expect(record.attempts).toBe(3);
    expect(record.costUsd).toBeCloseTo(0.03, 10);
    expect(record.costSource).toBe('unknown');
    expect(budget.snapshot().spentUsd).toBeCloseTo(0.03, 10);

    // And the ceiling bites on the next one, mid-retry, rather than never.
    await expect(referee.rule(view)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(budget.snapshot().spentUsd).toBeCloseTo(0.05, 10);
  });
});
