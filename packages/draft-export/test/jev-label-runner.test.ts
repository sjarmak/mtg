/**
 * The labeling loop's stop conditions. the playtester's ruling allows one offline run
 * on the free tier and nothing past it, so what these tests pin is mostly what
 * the loop refuses to do: retry a rate limit, continue past a charge, or count a
 * call it did not make. A fake clock stands in for the pacing, so the gap is
 * asserted rather than waited out.
 */
import { describe, expect, it } from 'vitest';
import { JevHttpError, JevRateLimitError } from '../tools/jev-label/jev-client';
import { doneKey, runPlan, workPlan } from '../tools/jev-label/runner';
import type { RunnerOptions, WorkItem } from '../tools/jev-label/runner';
import type { AnswerRecord } from '../tools/jev-label/record';
import { answerBody, decisionsOf, favorFirst, packIdsOf, scriptedClient } from './jev-label-fixture';
import type { Step } from './jev-label-fixture';

const DECISIONS = decisionsOf(5);
const PLAN: readonly WorkItem[] = workPlan(DECISIONS, 0);

interface Harness {
  readonly options: RunnerOptions;
  readonly recorded: AnswerRecord[];
  readonly sleeps: number[];
  readonly messages: string[];
}

function harness(
  script: Step,
  overrides: Partial<RunnerOptions> = {},
): Harness & { client: ReturnType<typeof scriptedClient> } {
  const client = scriptedClient(script);
  const recorded: AnswerRecord[] = [];
  const sleeps: number[] = [];
  const messages: string[] = [];
  let clock = 0;
  return {
    client,
    recorded,
    sleeps,
    messages,
    options: {
      client,
      gapMs: 5000,
      maxRequests: 100,
      done: new Set(),
      onAnswer: (record) => recorded.push(record),
      onProgress: (message) => messages.push(message),
      sleep: (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      cooldownMs: 60_000,
      ...overrides,
    },
  };
}

describe('the work plan', () => {
  it('interleaves evenly spaced repeats after their primary groups', () => {
    const decisions = decisionsOf(10);
    const plan = workPlan(decisions, 2);
    expect(plan.map((item) => [item.decision.key, item.repeat])).toEqual([
      ...decisions.slice(0, 5).map((decision) => [decision.key, 0]),
      [decisions[0]?.key, 1],
      ...decisions.slice(5).map((decision) => [decision.key, 0]),
      [decisions[5]?.key, 1],
    ]);
  });

  it('puts repeat evidence into the first hundred calls of the study plan', () => {
    const [template] = decisionsOf(1);
    const decisions = Array.from({ length: 900 }, (_unused, index) => ({
      ...template!,
      key: `decision-${String(index)}`,
    }));
    const plan = workPlan(decisions, 100);
    expect(plan.slice(0, 100).filter((item) => item.repeat === 1)).toHaveLength(10);
  });

  it('plans no repeats when none are asked for', () => {
    expect(workPlan(DECISIONS, 0)).toHaveLength(DECISIONS.length);
  });

  it('refuses more repeats than there are decisions, and a fractional count', () => {
    expect(() => workPlan(DECISIONS, DECISIONS.length + 1)).toThrow(/repeats/);
    expect(() => workPlan(DECISIONS, 1.5)).toThrow(/repeats/);
    expect(() => workPlan(DECISIONS, -1)).toThrow(/repeats/);
  });
});

describe('running a plan', () => {
  it('records every answer with the request sent and the body received, one gap apart', async () => {
    const run = harness(favorFirst);
    const report = await runPlan(PLAN, run.options);

    expect(report.stop).toMatchObject({ reason: 'done', requests: 5, recorded: 5 });
    expect(run.recorded.map((record) => record.key)).toEqual(DECISIONS.map((decision) => decision.key));
    expect(run.sleeps).toEqual([5000, 5000, 5000, 5000]);
    const first = run.recorded[0];
    expect(first?.packIds).toEqual(packIdsOf(run.client.calls[0]!));
    expect(first?.raw).toEqual(answerBody(first?.packIds ?? []));
    expect(first?.botPickId).toBe(DECISIONS[0]?.botPickId);
  });

  it('never tells the labeler which card the bot took', async () => {
    const run = harness(favorFirst);
    await runPlan(PLAN, run.options);
    for (const [index, request] of run.client.calls.entries()) {
      const text = JSON.stringify(request);
      const decision = DECISIONS[index];
      expect(Object.keys(request.state)).toEqual(['task', 'pickNumber', 'round', 'poolSoFar']);
      expect(text).not.toContain('botPick');
      expect(text).not.toContain(decision?.key ?? 'missing');
    }
  });

  it('skips every answer the record already holds and calls only for the rest', async () => {
    const done = new Set([
      doneKey(DECISIONS[0]!.key, 0),
      doneKey(DECISIONS[1]!.key, 0),
      doneKey(DECISIONS[3]!.key, 0),
    ]);
    const run = harness(favorFirst, { done });
    const report = await runPlan(PLAN, run.options);

    expect(report.skipped).toBe(3);
    expect(report.stop).toMatchObject({ reason: 'done', requests: 2, recorded: 2 });
    expect(run.recorded.map((record) => record.key)).toEqual([DECISIONS[2]!.key, DECISIONS[4]!.key]);
  });

  it('treats a repeat as separate work from its primary label', async () => {
    const plan = workPlan(DECISIONS, 1);
    const done = new Set(DECISIONS.map((decision) => doneKey(decision.key, 0)));
    const run = harness(favorFirst, { done });
    const report = await runPlan(plan, run.options);
    expect(report.stop).toMatchObject({ reason: 'done', requests: 1, recorded: 1 });
    expect(run.recorded[0]).toMatchObject({ key: DECISIONS[0]!.key, repeat: 1 });
  });

  it('stops at the first rate limit and does not retry it', async () => {
    const run = harness((request, call) => {
      if (call === 3) throw new JevRateLimitError('too many requests', 4000);
      return favorFirst(request, call);
    });
    const report = await runPlan(PLAN, run.options);

    expect(report.stop.reason).toBe('rate-limit');
    expect(report.stop).toMatchObject({ requests: 3, recorded: 2 });
    expect(run.client.calls).toHaveLength(3);
    expect(report.stop.detail).toContain(DECISIONS[2]!.key);
    expect(run.sleeps).not.toContain(60_000);
  });

  it('records the answer that reported a charge, then stops before asking again', async () => {
    const run = harness((request, call) =>
      answerBody(packIdsOf(request), { cost: call === 2 ? '0.0004' : '0' }),
    );
    const report = await runPlan(PLAN, run.options);

    expect(report.stop.reason).toBe('spend');
    expect(report.stop).toMatchObject({ requests: 2, recorded: 2 });
    expect(run.recorded).toHaveLength(2);
    expect(run.client.calls).toHaveLength(2);
  });

  it('stops when an answer states no charge at all, since free cannot then be shown', async () => {
    const run = harness((request) => answerBody(packIdsOf(request), { cost: null }));
    const report = await runPlan(PLAN, run.options);
    expect(report.stop).toMatchObject({ reason: 'spend', requests: 1, recorded: 1 });
  });

  it('stops at the request cap, counting the calls it made', async () => {
    const run = harness(favorFirst, { maxRequests: 3 });
    const report = await runPlan(PLAN, run.options);
    expect(report.stop).toMatchObject({ reason: 'cap', requests: 3, recorded: 3 });
    expect(run.client.calls).toHaveLength(3);
  });

  it('reserves a fixed direct-call upper bound before each request and refuses the call that would cross the ceiling', async () => {
    const run = harness(favorFirst, {
      maxUsd: 0.02,
      requestUpperBoundUsd: 0.008,
    });
    const report = await runPlan(PLAN, run.options);

    expect(report.stop).toMatchObject({ reason: 'budget', requests: 2, recorded: 2, spentUsd: 0.016 });
    expect(run.client.calls).toHaveLength(2);
    expect(report.stop.detail).toContain('upper-bound estimate');
  });

  it('does not make a fixed-bound paid request without an explicit ceiling', async () => {
    const run = harness(favorFirst, { requestUpperBoundUsd: 0.008 });

    await expect(runPlan(PLAN, run.options)).rejects.toThrow(/requires maxUsd/);
    expect(run.client.calls).toHaveLength(0);
  });

  it('counts a failed paid request in the upper-bound estimate', async () => {
    const run = harness(
      () => {
        throw new JevRateLimitError('too many requests', null);
      },
      { maxUsd: 1, requestUpperBoundUsd: 0.008 },
    );

    const report = await runPlan(PLAN, run.options);
    expect(report.stop).toMatchObject({ reason: 'rate-limit', requests: 1, spentUsd: 0.008 });
  });

  it('retries a gateway timeout once after the cooldown and then carries on', async () => {
    const run = harness((request, call) => {
      if (call === 2) throw new JevHttpError('gateway answered 504: upstream timed out', 504);
      return favorFirst(request, call);
    });
    const report = await runPlan(PLAN, run.options);

    expect(report.stop).toMatchObject({ reason: 'done', requests: 6, recorded: 5 });
    expect(run.sleeps).toContain(60_000);
    expect(run.recorded.map((record) => record.key)).toEqual(DECISIONS.map((decision) => decision.key));
  });

  it('counts the retry against the cap', async () => {
    const run = harness(
      (request, call) => {
        if (call === 1) throw new JevHttpError('gateway answered 504', 504);
        return favorFirst(request, call);
      },
      { maxRequests: 1 },
    );
    const report = await runPlan(PLAN, run.options);
    expect(report.stop).toMatchObject({ reason: 'cap', requests: 1, recorded: 0 });
  });

  it('gives up on a second timeout for the same call', async () => {
    const run = harness(() => {
      throw new JevHttpError('gateway answered 504', 504);
    });
    const report = await runPlan(PLAN, run.options);
    expect(report.stop.reason).toBe('error');
    expect(report.stop).toMatchObject({ requests: 2, recorded: 0 });
  });

  it('stops on an auth refusal without retrying', async () => {
    for (const status of [401, 403]) {
      const run = harness(() => {
        throw new JevHttpError(`gateway answered ${String(status)}`, status);
      });
      const report = await runPlan(PLAN, run.options);
      expect(report.stop).toMatchObject({ reason: 'auth', requests: 1, recorded: 0 });
      expect(report.stop.detail).toBe(`provider refused the key (${String(status)})`);
    }
  });

  it('stops on a body it cannot use rather than retrying it', async () => {
    const run = harness(() => {
      throw new JevHttpError('gateway answered 200 with a body that is not an evaluation', 200);
    });
    const report = await runPlan(PLAN, run.options);
    expect(report.stop).toMatchObject({ reason: 'error', requests: 1, recorded: 0 });
  });
});
