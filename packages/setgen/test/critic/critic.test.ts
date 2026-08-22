/**
 * `judgeFaithfulness`: the one model call this bead adds, exercised against a
 * scripted transport rather than a real model. Covers the success path (core
 * criteria and the full five-criterion case), the `schema_validation` failure
 * path, and the criteria-coverage mismatch this module checks that
 * `critiqueSet` has no equivalent of.
 */
import { describe, expect, it } from 'vitest';
import type { LlmProvider, LlmTransport, RawRequest, RawResponse } from '@mtg/llm';
import { createProvider, ZERO_USAGE } from '@mtg/llm';
import type { RevisionRecord, SetBrief } from '@mtg/setgen';
import { parseBrief } from '@mtg/setgen';
import { judgeFaithfulness } from '../../src/critic/critic';
import type { FaithfulnessCriterion } from '../../src/critic/rubric';
import { testEntry } from './support';
import { TEST_BRIEF } from '../helpers';

const brief: SetBrief = parseBrief(TEST_BRIEF);

const USAGE = { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

function verdictResponse(criteria: readonly FaithfulnessCriterion[], overallLabel = 'faithful'): unknown {
  return {
    criteria: criteria.map((criterion) => ({
      criterion,
      label: 'faithful',
      reason: 'because the card says so',
    })),
    overall: { label: overallLabel, reason: 'because the card says so' },
  };
}

function providerReturningText(text: string, maxAttempts = 1): LlmProvider {
  const transport: LlmTransport = {
    name: 'fixture',
    model: 'test-critic-model',
    async send(_request: RawRequest): Promise<RawResponse> {
      return {
        text,
        usage: USAGE,
        costUsd: 0.002,
        costSource: 'estimated',
        model: 'test-critic-model',
      };
    },
  };
  return createProvider(transport, { maxAttempts });
}

function providerReturning(value: unknown, maxAttempts = 1): LlmProvider {
  return providerReturningText(JSON.stringify(value), maxAttempts);
}

describe('judgeFaithfulness', () => {
  it('judges only the core criteria on a plain entry, and returns a usable verdict', async () => {
    const entry = testEntry();
    const provider = providerReturning(verdictResponse(['mechanicIntent', 'roleIntent', 'noInvention']));
    const outcome = await judgeFaithfulness({ provider, brief, entry });

    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.criteria.map((c) => c.criterion)).toStrictEqual([
      'mechanicIntent',
      'roleIntent',
      'noInvention',
    ]);
    expect(outcome.call.error).toBeUndefined();
    expect(outcome.call.slotId).toBe(entry.slot.id);
    expect(outcome.call.cardName).toBe(entry.card.name);
    expect(outcome.call.criteria).toStrictEqual(['mechanicIntent', 'roleIntent', 'noInvention']);
    expect(outcome.call.usage).toStrictEqual(USAGE);
  });

  it('asks all five criteria when the slot has a required card and an applied revision, ignoring reverted ones', async () => {
    const entry = testEntry({
      id: 'CU01',
      requiredCard: {
        name: 'Test Required Card',
        flavorDirection: 'Reads as ice.',
        equipment: false,
        legendary: false,
      },
    });
    const revisions: RevisionRecord[] = [
      { slotId: 'CU01', category: 'cohesion', observation: 'o', instruction: 'i', outcome: 'applied' },
      {
        slotId: 'CU01',
        category: 'flavor',
        observation: 'o2',
        instruction: 'i2',
        outcome: 'reverted',
        reason: 'r',
      },
      { slotId: 'CB02', category: 'flavor', observation: 'o3', instruction: 'i3', outcome: 'applied' },
    ];
    const expectedCriteria: FaithfulnessCriterion[] = [
      'mechanicIntent',
      'roleIntent',
      'noInvention',
      'requiredCardIntent',
      'revisionIntent',
    ];
    const provider = providerReturning(verdictResponse(expectedCriteria));
    const outcome = await judgeFaithfulness({ provider, brief, entry, revisions });

    expect(outcome.verdict).toBeDefined();
    expect(outcome.call.criteria).toStrictEqual(expectedCriteria);
    expect(outcome.call.error).toBeUndefined();
  });

  it('returns an error record, not a throw, when every attempt fails schema validation', async () => {
    const entry = testEntry();
    const provider = providerReturningText('this is not json at all');
    const outcome = await judgeFaithfulness({ provider, brief, entry });

    expect(outcome.verdict).toBeUndefined();
    expect(outcome.call.error).toBeDefined();
    expect(outcome.call.attempts).toBe(0);
    expect(outcome.call.usage).toStrictEqual(ZERO_USAGE);
    expect(outcome.call.costSource).toBe('unknown');
  });

  it('returns an error record when the verdict answers the wrong set of criteria', async () => {
    const entry = testEntry(); // expects mechanicIntent, roleIntent, noInvention
    const provider = providerReturning(verdictResponse(['mechanicIntent', 'roleIntent'])); // missing noInvention
    const outcome = await judgeFaithfulness({ provider, brief, entry });

    expect(outcome.verdict).toBeUndefined();
    expect(outcome.call.error).toContain('mechanicIntent, roleIntent');
    expect(outcome.call.error).toContain('expected exactly {mechanicIntent, roleIntent, noInvention}');
    // Unlike the schema_validation path, the completion itself succeeded, so
    // the real usage/cost from the call is preserved rather than zeroed.
    expect(outcome.call.usage).toStrictEqual(USAGE);
  });

  it('propagates a non-schema error from the provider instead of swallowing it', async () => {
    const entry = testEntry();
    const transport: LlmTransport = {
      name: 'fixture',
      model: 'test-critic-model',
      send(): Promise<RawResponse> {
        return Promise.reject(new Error('the transport itself is down'));
      },
    };
    const provider = createProvider(transport, { maxAttempts: 1 });
    await expect(judgeFaithfulness({ provider, brief, entry })).rejects.toThrow(
      'the transport itself is down',
    );
  });
});
