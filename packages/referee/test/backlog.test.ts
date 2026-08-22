/**
 * The compile-down backlog, and the true thing it currently says.
 *
 * ADR-0001 §2.4 wants every referee invocation to leave behind a bead that
 * compiles the mechanic down into the DSL. In this checkout there is no
 * mechanic to compile down: the DSL has no unhandled effect, so every decision
 * the kernel poses comes with a deterministic handler and the referee is an
 * alternative policy rather than a gap-filler. The one gap the kernel does
 * report is a capped enumeration — `complete: false` says the option list is a
 * subset of the legal space — so that is what the backlog is built from, and an
 * empty backlog is reported as the true statement it is rather than as silence.
 */
import { describe, expect, it } from 'vitest';
import { simpleAgent } from '@mtg/kernel';
import type { RulingRecord } from '@mtg/referee';
import { compileDownBacklog, createReferee, formatBacklog } from '@mtg/referee';
import { blockingView, cappedTargetingPosition, viewFor } from './positions';
import { stubProvider } from './stub-provider';

function record(overrides: Partial<RulingRecord> = {}): RulingRecord {
  return {
    decision: 'priority',
    player: 0,
    optionCount: 4,
    enumerationComplete: true,
    source: 'model',
    chosenIndex: 0,
    rationale: 'because',
    rejection: null,
    costUsd: 0.002,
    costSource: 'estimated',
    latencyMs: 1200,
    provider: 'fixture',
    model: 'stub',
    attempts: 1,
    ...overrides,
  };
}

describe('the compile-down backlog', () => {
  it('is empty when every decision came with a complete enumeration', () => {
    expect(compileDownBacklog([record(), record({ decision: 'discard' })])).toEqual([]);
  });

  it('says so in words, rather than printing nothing', () => {
    const text = formatBacklog(compileDownBacklog([record()]));
    expect(text).toContain('nothing to compile down');
  });

  it('files one entry per decision kind the kernel could not fully enumerate', () => {
    const entries = compileDownBacklog([
      record({ decision: 'declareBlockers', enumerationComplete: false, optionCount: 512 }),
      record({ decision: 'declareBlockers', enumerationComplete: false, optionCount: 512 }),
      record({ decision: 'declareAttackers', enumerationComplete: false, optionCount: 512 }),
      record({ decision: 'priority', enumerationComplete: true }),
    ]);

    expect(entries.map((entry) => entry.decision)).toEqual(['declareBlockers', 'declareAttackers']);
    expect(entries[0]?.occurrences).toBe(2);
    expect(entries[1]?.occurrences).toBe(1);
  });

  it('gives each entry a title and a body a bead can be filed from', () => {
    const [entry] = compileDownBacklog([
      record({ decision: 'declareBlockers', enumerationComplete: false, optionCount: 512 }),
    ]);

    expect(entry?.title).toContain('declareBlockers');
    expect(entry?.body).toContain('512');
    expect(entry?.body).toContain('mtg-bc2.23');
  });

  it('reports the entries it does have, with counts', () => {
    const text = formatBacklog(
      compileDownBacklog([record({ decision: 'declareBlockers', enumerationComplete: false })]),
    );
    expect(text).toContain('declareBlockers');
    expect(text).toContain('1');
    expect(text).not.toContain('nothing to compile down');
  });
});

/**
 * The whole chain on one real position, because every link in it is a boolean
 * that a hand-built record would satisfy just as well.
 *
 * `Decision.complete` is the kernel's own admission that it enumerated a subset
 * of the legal space, and the backlog is filtered on nothing else. A two-target
 * spell on a crowded board is an ordinary position that trips it, so the gap is
 * a thing this engine reaches rather than a field somebody might set. The other half of
 * the chain — the frame and the prompt that carry the same admission to the
 * model — is pinned on the same position in `frame.test.ts`.
 */
describe('a ruling on a decision the kernel could not fully enumerate', () => {
  it('carries the truncation from the kernel through to a backlog entry', async () => {
    const view = viewFor(cappedTargetingPosition().state);
    expect(view.decision.kind).toBe('priority');
    expect(view.decision.complete).toBe(false);
    expect(view.decision.options.length).toBeGreaterThan(1);

    const provider = stubProvider({
      answers: [{ value: { optionIndex: 0, rationale: 'Chump nothing; take it.' } }],
    });
    const referee = createReferee({ provider, fallback: simpleAgent('fallback') });
    const { record: ruled } = await referee.rule(view);

    expect(ruled.enumerationComplete).toBe(false);
    expect(ruled.optionCount).toBe(view.decision.options.length);

    const [entry, ...rest] = compileDownBacklog(referee.records());
    expect(rest).toEqual([]);
    expect(entry?.decision).toBe('priority');
    expect(entry?.optionCount).toBe(view.decision.options.length);
    expect(formatBacklog(compileDownBacklog(referee.records()))).toContain('priority');
  });

  it('is the only thing that puts an entry in the backlog', async () => {
    // The same referee on a board the kernel *could* enumerate files nothing,
    // which is the claim the empty backlog makes in words. Without this half,
    // a record that reported every enumeration as truncated would read as a
    // backlog that works.
    const view = blockingView();
    expect(view.decision.complete).toBe(true);
    const provider = stubProvider({ answers: [{ value: { optionIndex: 0, rationale: 'No blocks.' } }] });
    const referee = createReferee({ provider, fallback: simpleAgent('fallback') });

    await referee.rule(view);

    expect(compileDownBacklog(referee.records())).toEqual([]);
    expect(formatBacklog(compileDownBacklog(referee.records()))).toContain('nothing to compile down');
  });
});
