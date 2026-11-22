/**
 * The spend ceiling (`mtg-obo8g`). the playtester approved a paid pass capped at two
 * dollars (dec-3nhp), so what these tests pin is that the cap is a hard stop
 * checked before a call, that it counts the whole record and not one attempt,
 * that reaching it is a finished run with a reason rather than a failure, and
 * that leaving the flag off is still the zero-spend abort it always was.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../tools/jev-label/cli';
import type { CliDeps } from '../tools/jev-label/cli';
import { answersOf, appendRecord, readRecords, spendOf } from '../tools/jev-label/record';
import type { AnswerRecord } from '../tools/jev-label/record';
import { runPlan, workPlan } from '../tools/jev-label/runner';
import type { RunnerOptions } from '../tools/jev-label/runner';
import { SET, answerBody, decisionsOf, packIdsOf, recordOf, scriptedClient } from './jev-label-fixture';

const DECISIONS = decisionsOf(6);
const PLAN = workPlan(DECISIONS, 0);

function options(charge: string, overrides: Partial<RunnerOptions> = {}) {
  const client = scriptedClient((request) => answerBody(packIdsOf(request), { cost: charge }));
  const recorded: AnswerRecord[] = [];
  let clock = 0;
  const run: RunnerOptions = {
    client,
    gapMs: 1000,
    maxRequests: 100,
    done: new Set(),
    onAnswer: (record) => recorded.push(record),
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    ...overrides,
  };
  return { client, recorded, run };
}

describe('the runner under a spend ceiling', () => {
  it('without a ceiling still stops at the first non-zero charge', async () => {
    const { client, run } = options('0.25');
    const report = await runPlan(PLAN, run);
    expect(report.stop).toMatchObject({ reason: 'spend', requests: 1, recorded: 1 });
    expect(client.calls).toHaveLength(1);
  });

  it('spends up to the ceiling, then stops before a call that could cross it', async () => {
    const { client, recorded, run } = options('0.25', { maxUsd: 1 });
    const report = await runPlan(PLAN, run);

    expect(report.stop.reason).toBe('budget');
    expect(report.stop).toMatchObject({ requests: 4, recorded: 4 });
    expect(report.stop.spentUsd).toBeCloseTo(1, 10);
    expect(client.calls).toHaveLength(4);
    expect(recorded).toHaveLength(4);
    expect(report.stop.detail).toContain('$1.0000 spent against a $1.0000 ceiling');
  });

  it('stops short of the ceiling when the dearest call so far would cross it', async () => {
    const { client, run } = options('0.4', { maxUsd: 1 });
    const report = await runPlan(PLAN, run);
    // 0.4 + 0.4 = 0.8, and a third call could cost 0.4 more: 1.2 > 1.
    expect(report.stop).toMatchObject({ reason: 'budget', requests: 2 });
    expect(report.stop.spentUsd).toBeCloseTo(0.8, 10);
    expect(client.calls).toHaveLength(2);
  });

  it('carries a prior spend in, so a resume does not get a fresh allowance', async () => {
    const { client, run } = options('0.25', { maxUsd: 1, priorSpendUsd: 0.75, priorPeakUsd: 0.25 });
    const report = await runPlan(PLAN, run);
    expect(report.stop).toMatchObject({ reason: 'budget', requests: 1 });
    expect(report.stop.spentUsd).toBeCloseTo(1, 10);
    expect(client.calls).toHaveLength(1);
  });

  it('makes no call at all when the prior spend already meets the ceiling', async () => {
    const { client, run } = options('0.25', { maxUsd: 1, priorSpendUsd: 1, priorPeakUsd: 0 });
    const report = await runPlan(PLAN, run);
    expect(report.stop).toMatchObject({ reason: 'budget', requests: 0, recorded: 0 });
    expect(client.calls).toHaveLength(0);
  });

  it('reports done, not budget, when the plan finishes under the ceiling', async () => {
    const { run } = options('0.01', { maxUsd: 1 });
    const report = await runPlan(PLAN, run);
    expect(report.stop.reason).toBe('done');
    expect(report.stop.spentUsd).toBeCloseTo(0.06, 10);
  });

  it('still stops when a charge is not stated, since it cannot be counted against the ceiling', async () => {
    const client = scriptedClient((request) => answerBody(packIdsOf(request), { cost: null }));
    const report = await runPlan(PLAN, {
      client,
      gapMs: 1000,
      maxRequests: 100,
      done: new Set(),
      onAnswer: () => undefined,
      sleep: () => Promise.resolve(),
      now: () => 0,
      maxUsd: 1,
    });
    expect(report.stop).toMatchObject({ reason: 'spend', requests: 1 });
  });
});

describe('spend read back out of a record', () => {
  it('sums stated charges, finds the dearest call, and counts the unstated', () => {
    const [a, b, c] = DECISIONS;
    const spend = spendOf([
      recordOf(a!, 0, { cost: '0.10' }),
      recordOf(b!, 0, { cost: '0.30' }),
      recordOf(c!, 0, { cost: null }),
    ]);
    expect(spend.totalUsd).toBeCloseTo(0.4, 10);
    expect(spend.peakUsd).toBeCloseTo(0.3, 10);
    expect(spend.unknown).toBe(1);
  });
});

describe('--max-usd on the command line', () => {
  let directory: string;
  let setFile: string;
  let out: string;
  let text: string[];
  let requests: number;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-jev-budget-'));
    setFile = join(directory, 'set.json');
    out = join(directory, 'labels.jsonl');
    writeFileSync(setFile, JSON.stringify(SET));
    text = [];
    requests = 0;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const gateway =
    (cost: string): typeof fetch =>
    (_input, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as {
        questions: { pick: { criteria: Record<string, string> } };
      };
      const ids = Object.keys(body.questions.pick.criteria);
      return Promise.resolve(new Response(JSON.stringify(answerBody(ids, { cost })), { status: 200 }));
    };

  const deps = (cost = '0'): CliDeps => ({
    env: { AI_GATEWAY_API_KEY: 'sk-test-budget-key' },
    fetchImpl: gateway(cost),
    sleep: () => Promise.resolve(),
    now: () => 0,
    write: (chunk) => text.push(chunk),
  });

  const label = (extra: readonly string[] = []): string[] => [
    'label',
    ...['--set', setFile, '--seed-prefix', 'cli', '--out', out, '--decisions', '6', '--repeats', '0'],
    '--gap-ms',
    '1000',
    ...extra,
  ];

  it('without the flag stops at the first charge and exits 1, as before', async () => {
    expect(await main(label(), deps('0.5'))).toBe(1);
    expect(requests).toBe(1);
    expect(readRecords(out).at(-1)).toMatchObject({ kind: 'stop', reason: 'spend' });
    expect(text.join('')).toContain('no spend allowed');
  });

  it('stops at the ceiling with the actual spend and the reason, exits 0, and records both', async () => {
    expect(await main(label(['--max-usd', '1']), deps('0.5'))).toBe(0);

    expect(requests).toBe(2);
    const stop = readRecords(out).at(-1);
    expect(stop).toMatchObject({ kind: 'stop', reason: 'budget', recorded: 2 });
    expect(stop).toHaveProperty('spentUsd', 1);
    const output = text.join('');
    expect(output).toContain('stopped: budget after 2 requests');
    expect(output).toContain('$1.0000 spent in all');
    expect(output).toContain('spend ceiling $1.00');
  });

  it('counts the record on resume: a second run gets only what the first left', async () => {
    await main(label(['--max-usd', '1.5']), deps('0.5'));
    expect(requests).toBe(3);
    requests = 0;

    // 1.5 spent of 1.5: the resume must refuse, not grant another 1.5.
    await expect(main(label(['--max-usd', '1.5']), deps('0.5'))).rejects.toThrow(/already spent \$1\.5000/);
    expect(requests).toBe(0);

    // A higher ceiling leaves only the difference to spend.
    expect(await main(label(['--max-usd', '2']), deps('0.5'))).toBe(0);
    expect(requests).toBe(1);
    expect(answersOf(readRecords(out))).toHaveLength(4);
  });

  it('refuses a resume whose record already spent the ceiling, before the key is read or any call is made', async () => {
    const [first] = DECISIONS;
    appendRecord(out, recordOf(first!, 0, { cost: '2' }));
    const noKey: CliDeps = { ...deps(), env: {} };

    await expect(main(label(['--max-usd', '2']), noKey)).rejects.toThrow(/meets or exceeds --max-usd 2/);
    expect(requests).toBe(0);
    expect(readRecords(out)).toHaveLength(1);
  });

  it('refuses a resume whose record holds a charge it cannot count', async () => {
    appendRecord(out, recordOf(DECISIONS[0]!, 0, { cost: null }));
    await expect(main(label(['--max-usd', '2']), deps())).rejects.toThrow(/no stated charge/);
    expect(requests).toBe(0);
  });

  it('refuses a ceiling that is not a positive number, before any call', async () => {
    for (const bad of ['0', '-1', 'abc', '']) {
      await expect(main(label(['--max-usd', bad]), deps())).rejects.toThrow(/--max-usd/);
    }
    expect(requests).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it('keeps the key out of the record and the output when it spends', async () => {
    await main(label(['--max-usd', '1']), deps('0.5'));
    expect(readFileSync(out, 'utf8')).not.toContain('sk-test-budget-key');
    expect(text.join('')).not.toContain('sk-test-budget-key');
  });
});
