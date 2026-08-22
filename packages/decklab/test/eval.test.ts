/**
 * The harness's own reporting: what a run says happened.
 *
 * The tracing clause is measured here but cannot be *broken* here, and that is
 * the point of it. `verifyProposals` refuses a proposal citing nothing or citing
 * an id nobody stated, so no such card can reach an assembled deck through this
 * path. `trace.test.ts` breaks the clause directly, against inclusions built by
 * hand; this file checks that a run measures it and prints the result.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { closeStore, type DataStore } from '@mtg/data';
import type { BaselineDeck } from '../src/baseline';
import { formatEvalReport, runEval, type Scenario } from '../src/eval';
import type { Verdict } from '../src/judge';
import type { DeckProposal } from '../src/select';
import { createFakeStore, fillerSpells, SAMPLE_CARDS } from './support/fake-store';
import { scriptedProvider, type ScriptedAnswer } from './support/scripted-provider';

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

const FILLERS = fillerSpells(9);

function scenario(id: string): Scenario {
  return {
    id,
    criteria: {
      prompt: 'aggressive red deck',
      format: 'modern',
      colors: ['R'],
      archetype: 'aggro',
      size: 60,
      // Stated, so the build spends no call deciding it and the script below is
      // exactly the calls the eval makes.
      landCount: 24,
    },
  };
}

/** Nine four-ofs: the whole 36-spell target in one round, so selection stops there. */
const PROPOSAL: DeckProposal = {
  plan: 'burn them out',
  cards: FILLERS.map((card) => ({
    name: card.name,
    count: 4,
    criteria: ['archetype'],
    reason: 'cheap pressure',
  })),
};

const BASELINE: BaselineDeck = {
  plan: 'burn them out',
  cards: [
    { name: 'Lightning Bolt', count: 4 },
    { name: 'Mountain', count: 56 },
  ],
};

const VERDICT: Verdict = { winner: 'A', reason: 'A curves lower', scoreA: 8, scoreB: 6 };

async function run(scenarios: readonly Scenario[], answers: readonly ScriptedAnswer[]) {
  store = createFakeStore([...FILLERS, ...SAMPLE_CARDS]);
  return runEval({ store, provider: scriptedProvider(answers), scenarios, seed: 'eval-test' });
}

describe('runEval', () => {
  it('measures the tracing clause and reports it beside the conformance table', async () => {
    const result = await run([scenario('red-aggro')], [PROPOSAL, BASELINE, VERDICT]);

    expect(result.summary.tracing).toEqual({
      decks: 1,
      cleanDecks: 1,
      chosenEntries: 9,
      citedEntries: 9,
      findings: 0,
      derivedBasics: 24,
    });

    const report = formatEvalReport(result);
    expect(report).toContain('## Criterion tracing');
    expect(report).toContain('| choices citing a stated criterion | 9/9 |');
    expect(report).toContain('| basic lands derived from those choices | 24 |');
    expect(report).toContain(
      '- informed tracing: 9/9 choices cite a stated criterion (distinct cards); 24 basic-land cards run from them (counted with multiplicity)',
    );
  });

  it('counts a builder that produced no deck, on the side that failed', async () => {
    const timeout = new Error('claude-cli: timed out after 300000ms');
    const result = await run([scenario('red-aggro')], [timeout, BASELINE]);

    expect(result.summary.informedFailures).toBe(1);
    expect(result.summary.baselineFailures).toBe(0);
    expect(result.summary.judgedScenarios).toBe(0);
    // Nothing was built, so there is nothing to trace — and no clean deck to
    // claim either.
    expect(result.summary.tracing.decks).toBe(0);
    expect(result.outcomes[0]?.informedTrace).toBeUndefined();
    expect(result.outcomes[0]?.informedError).toContain('timed out after 300000ms');
  });

  it('puts a failed build in the summary rather than only in the scenario detail', async () => {
    const result = await run([scenario('red-aggro')], [new Error('timed out'), BASELINE]);
    const report = formatEvalReport(result);

    expect(report).toContain('1 informed build produced no deck at all, so 0 of 1 scenarios were judged.');
    expect(report).toContain('| builds that produced no deck | 1 | 0 |');
    expect(report).toContain('No informed deck was built, so the clause was not measured.');
  });

  it('gives the win tally its denominator, so a shrunken comparison cannot read as a full one', async () => {
    // Scenario one is judged; scenario two loses the informed build. The tally
    // that results is over one scenario and says so.
    const result = await run(
      [scenario('red-aggro'), scenario('red-aggro-two')],
      [PROPOSAL, BASELINE, VERDICT, new Error('timed out'), BASELINE],
    );

    expect(result.summary.scenarios).toBe(2);
    expect(result.summary.judgedScenarios).toBe(1);
    // Which side won is the blinding's business; the denominator is this test's.
    expect(formatEvalReport(result)).toContain('over 1 of 2 scenarios: informed ');
  });

  it('keeps both sides errors, so a baseline failure is not hidden behind an informed one', async () => {
    const result = await run(
      [scenario('red-aggro')],
      [new Error('informed exploded'), new Error('baseline exploded')],
    );

    expect(result.outcomes[0]?.informedError).toBe('informed: informed exploded');
    expect(result.outcomes[0]?.baselineError).toBe('baseline: baseline exploded');
    expect(result.summary.informedFailures).toBe(1);
    expect(result.summary.baselineFailures).toBe(1);
  });
});
