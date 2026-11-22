/**
 * The record file: the resume point and the evidence. The refusals matter more
 * than the round trip, because a resume that skipped a damaged line would spend
 * a call to replace an answer it did not know it had lost.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerView, answersOf, appendRecord, readRecords } from '../tools/jev-label/record';
import type { StopRecord } from '../tools/jev-label/record';
import { answerBody, decisionsOf, recordOf } from './jev-label-fixture';

const DECISION = decisionsOf(1)[0]!;
const STOP: StopRecord = {
  kind: 'stop',
  reason: 'rate-limit',
  at: '2026-01-01T00:00:00.000Z',
  detail: 'rate limited at a call',
  requests: 3,
  recorded: 2,
};

describe('the study record', () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-jev-record-'));
    path = join(directory, 'nested', 'labels.jsonl');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads a file that does not exist as an empty record', () => {
    expect(readRecords(path)).toEqual([]);
  });

  it('appends one line per record, creating the directory, and reads them back in order', () => {
    const first = recordOf(DECISION, 0);
    const repeat = recordOf(DECISION, 1, { favor: DECISION.pack[1]!.id });
    appendRecord(path, first);
    appendRecord(path, repeat);
    appendRecord(path, STOP);

    const records = readRecords(path);
    expect(records).toEqual([first, repeat, STOP]);
    expect(answersOf(records)).toEqual([first, repeat]);
  });

  it('ignores blank lines but refuses a line that is not JSON, naming it', () => {
    appendRecord(path, recordOf(DECISION, 0));
    appendFileSync(path, '\n{ truncated');
    expect(() => readRecords(path)).toThrow(/line 3 is not JSON/);
  });

  it('refuses a line that parses but is not a study record', () => {
    writeFileSync(join(directory, 'wrong.jsonl'), `${JSON.stringify({ kind: 'answer', key: 'k' })}\n`);
    expect(() => readRecords(join(directory, 'wrong.jsonl'))).toThrow(/not a study record/);
  });

  it('refuses a record with a field it does not know, so a stray key cannot be smuggled in', () => {
    const record = { ...recordOf(DECISION, 0), apiKey: 'should-not-be-here' };
    writeFileSync(join(directory, 'extra.jsonl'), `${JSON.stringify(record)}\n`);
    expect(() => readRecords(join(directory, 'extra.jsonl'))).toThrow(/not a study record/);
  });
});

describe('reading an answer back out of its raw body', () => {
  const ids = decisionsOf(1)[0]!.pack.map((card) => card.id);

  it('returns the choice, the probabilities, the confidence and the charge', () => {
    const view = answerView(recordOf(DECISION, 0, { favor: ids[2]!, confidence: 0.75 }));
    expect(view.choice).toBe(ids[2]);
    expect(view.probabilities[ids[2]!]).toBe(0.5);
    expect(view.confidence).toBe(0.75);
    expect(view.cost).toBe(0);
  });

  it('reads a numeric string charge as a number, and any real charge as non-zero', () => {
    expect(answerView(recordOf(DECISION, 0, { cost: '0.0012' })).cost).toBeCloseTo(0.0012);
  });

  it('reads an absent or unreadable charge as unknown, never as zero', () => {
    expect(answerView(recordOf(DECISION, 0, { cost: null })).cost).toBeNaN();
    expect(answerView(recordOf(DECISION, 0, { cost: 'free' })).cost).toBeNaN();
    expect(answerView(recordOf(DECISION, 0, { cost: '' })).cost).toBeNaN();
  });

  it('reads a missing confidence as null', () => {
    const record = recordOf(DECISION, 0);
    const raw = answerBody(ids) as { providerMetadata: Record<string, unknown> };
    raw.providerMetadata = { gateway: { cost: '0' } };
    expect(answerView({ ...record, raw }).confidence).toBeNull();
  });

  it('refuses an answer that carries no per-option probabilities', () => {
    const raw = {
      answers: { pick: { type: 'choice', choice: ids[0] } },
      providerMetadata: { gateway: { cost: '0' } },
    };
    expect(() => answerView({ ...recordOf(DECISION, 0), raw })).toThrow(/without per-option probabilities/);
  });

  it('refuses a body that has no answer to the pick question', () => {
    const raw = { answers: {}, providerMetadata: { gateway: { cost: '0' } } };
    expect(() => answerView({ ...recordOf(DECISION, 0), raw })).toThrow(/no pick answer/);
  });
});
